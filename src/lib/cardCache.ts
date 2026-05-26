// Lazy in-memory cache for Scryfall card data (oracle_text, type_line,
// and friends). Backs the hover overlay in Card.tsx and the battlefield
// bucketing in Battlefield.tsx for cards whose DB rows pre-date the
// migrations that added those columns.
//
// One source of truth per scryfall_id; in-flight requests for the same
// id are deduplicated.

import { getCardById, type ScryfallCard } from './scryfall';

const cache = new Map<string, ScryfallCard>();
const inflight = new Map<string, Promise<ScryfallCard>>();

export function getCachedCardData(scryfallId: string): ScryfallCard | undefined {
  return cache.get(scryfallId);
}

export async function fetchCardData(scryfallId: string): Promise<ScryfallCard> {
  const hit = cache.get(scryfallId);
  if (hit !== undefined) return hit;

  const existing = inflight.get(scryfallId);
  if (existing) return existing;

  const p = getCardById(scryfallId)
    .then((card) => {
      cache.set(scryfallId, card);
      inflight.delete(scryfallId);
      return card;
    })
    .catch((err) => {
      inflight.delete(scryfallId);
      throw err;
    });

  inflight.set(scryfallId, p);
  return p;
}

// ---------------------------------------------------------------------
// Backwards-compatible oracle-text helpers — Card.tsx imports these.
// ---------------------------------------------------------------------

export function getCachedOracleText(scryfallId: string): string | undefined {
  return cache.get(scryfallId)?.oracle_text;
}

export async function fetchOracleText(scryfallId: string): Promise<string> {
  const card = await fetchCardData(scryfallId);
  return card.oracle_text;
}
