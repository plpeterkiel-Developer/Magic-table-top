// Thin client for the Scryfall REST API. Used by the deck builder
// (autocomplete + add) and the paste-decklist import (batch resolve).
//
// Scryfall is a free, public API. Their guidelines (paraphrased):
//   - Add a small delay between requests (50-100 ms) to be polite.
//   - Prefer /cards/collection for batch lookups (up to 75 identifiers).
// We follow both. Cards endpoint docs: https://scryfall.com/docs/api
//
// We only return the fields the app actually stores, so consumers
// don't accidentally start depending on the full Scryfall schema.

const SCRYFALL_BASE = 'https://api.scryfall.com';
const POLITE_DELAY_MS = 80;

// The shape we hand back to the rest of the app. Mirrors the columns
// on deck_cards (and the relevant ones on game_cards).
export interface ScryfallCard {
  scryfall_id: string;
  name: string;
  type_line: string;
  mana_cost: string;
  // Plain Magic rules text. For DFCs we use the front face's. May be
  // empty for vanilla creatures and basic lands.
  oracle_text: string;
  // Front-face image at "normal" size (~488×680). For double-faced
  // cards we use the first face. Phase 4 can add a "flip" affordance.
  image_url: string;
}

// Module-level throttle: never fire two Scryfall requests within
// POLITE_DELAY_MS of each other from the same browser tab.
let lastRequestAt = 0;
async function polite(): Promise<void> {
  const wait = lastRequestAt + POLITE_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

// Pull the front-face "normal" image URL from a raw Scryfall card.
// Single-faced cards have image_uris at the top level. Double-faced
// cards (transform, modal-DFC) have card_faces[].image_uris instead.
function pickImageUrl(raw: any): string {
  if (raw?.image_uris?.normal) return raw.image_uris.normal as string;
  const firstFace = raw?.card_faces?.[0];
  if (firstFace?.image_uris?.normal) return firstFace.image_uris.normal as string;
  // Final fallback: the small image. Almost never needed.
  return raw?.image_uris?.small ?? '';
}

function toScryfallCard(raw: any): ScryfallCard {
  return {
    scryfall_id: raw.id,
    name: raw.name,
    type_line: raw.type_line ?? '',
    // mana_cost / oracle_text are on single-faced cards; for DFCs,
    // take the front face's.
    mana_cost: raw.mana_cost ?? raw.card_faces?.[0]?.mana_cost ?? '',
    oracle_text: raw.oracle_text ?? raw.card_faces?.[0]?.oracle_text ?? '',
    image_url: pickImageUrl(raw),
  };
}


// ---------------------------------------------------------------------
// Autocomplete: typeahead in the deck-builder search box.
// Returns up to ~20 card names matching the partial query.
// ---------------------------------------------------------------------
export async function autocompleteNames(query: string): Promise<string[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  await polite();
  const url = `${SCRYFALL_BASE}/cards/autocomplete?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json?.data) ? (json.data as string[]) : [];
}


// ---------------------------------------------------------------------
// Look up one card by exact name.
// Throws if the name doesn't resolve, so the caller can show an error.
// ---------------------------------------------------------------------
export async function getCardByExactName(name: string): Promise<ScryfallCard> {
  await polite();
  const url = `${SCRYFALL_BASE}/cards/named?exact=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Scryfall: no card named "${name}" (${res.status})`);
  }
  return toScryfallCard(await res.json());
}


// ---------------------------------------------------------------------
// Look up one card by Scryfall id (UUID). Used by the oracle-text
// lazy hydrator when an existing deck_cards row pre-dates migration
// 0006 and doesn't have oracle_text stored yet.
// ---------------------------------------------------------------------
export async function getCardById(scryfallId: string): Promise<ScryfallCard> {
  await polite();
  const url = `${SCRYFALL_BASE}/cards/${encodeURIComponent(scryfallId)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Scryfall: id "${scryfallId}" not found (${res.status})`);
  }
  return toScryfallCard(await res.json());
}


// ---------------------------------------------------------------------
// Batch lookup for paste-decklist import. Scryfall's /cards/collection
// endpoint accepts up to 75 identifiers per request. We chunk a long
// list and return whatever resolved plus a list of names that didn't.
// ---------------------------------------------------------------------
export interface BatchLookupResult {
  found: ScryfallCard[];
  notFound: string[];
}

export async function getCardsByNamesBatch(
  names: string[]
): Promise<BatchLookupResult> {
  // De-dup the input (case-insensitive) but preserve original capitalisation
  // for the API request.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of names) {
    const key = raw.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(raw.trim());
  }

  const found: ScryfallCard[] = [];
  const notFound: string[] = [];

  for (let i = 0; i < unique.length; i += 75) {
    const chunk = unique.slice(i, i + 75);
    await polite();
    const res = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identifiers: chunk.map((n) => ({ name: n })),
      }),
    });
    if (!res.ok) {
      // Whole chunk failed: mark every name in this chunk as not-found
      // rather than crashing the whole import.
      notFound.push(...chunk);
      continue;
    }
    const json = await res.json();
    for (const raw of json?.data ?? []) found.push(toScryfallCard(raw));
    for (const miss of json?.not_found ?? []) {
      if (miss?.name) notFound.push(miss.name);
    }
  }

  return { found, notFound };
}


// ---------------------------------------------------------------------
// Decklist parser for the paste-import textarea.
// Accepts the lenient mix of formats real Magic decklists use:
//   "1 Lightning Bolt"
//   "1x Lightning Bolt"
//   "4 Mountain (M11) 149"      -- set + collector # ignored
//   "// Lands"                  -- section header, ignored
//   ""                          -- blank lines ignored
// Returns rows of { name, quantity }. Names duplicated across rows
// are summed (so "1 Forest" twice becomes one row of quantity 2).
// ---------------------------------------------------------------------
export interface ParsedDecklistRow {
  name: string;
  quantity: number;
}

// "1 Name", "1x Name", "1 Name (M11) 149"
const LINE_RE = /^\s*(\d+)\s*x?\s+(.+?)(?:\s*\([^)]+\)\s*\d+\w*)?\s*$/;

export function parseDecklist(text: string): ParsedDecklistRow[] {
  // Real-world decklists arrive in many shapes. We accept anything that
  // could plausibly mean "one card per separator," including the common
  // case where someone pasted from a chat app and the newlines got
  // escaped to literal "\n" sequences.
  const normalised = text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/;/g, '\n');

  const tallies = new Map<string, number>();

  for (const rawLine of normalised.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('#')) continue;
    // Section headers like "Commander:" or "Mainboard"
    if (/^(commander|mainboard|sideboard|deck):?$/i.test(line)) continue;

    const m = LINE_RE.exec(line);
    if (!m) continue;
    const qty = Math.max(1, Math.min(100, parseInt(m[1]!, 10)));
    const name = m[2]!.trim();
    if (!name) continue;
    tallies.set(name, (tallies.get(name) ?? 0) + qty);
  }

  return Array.from(tallies, ([name, quantity]) => ({ name, quantity }));
}
