// Image proxy / cache helper for Scryfall art.
//
// At deck-build time we want to:
//   1. Store the card image in our own Supabase Storage bucket
//      ("card-images"), keyed by scryfall_id.
//   2. Reuse images across decks and across users (the cache is shared).
//   3. Survive Scryfall outages once a card is cached.
//
// Flow per card:
//   - Check if scryfall/<id>.jpg already exists in our bucket
//     (cheap HEAD on the public URL). If yes, return that URL.
//   - Otherwise, fetch the bytes from Scryfall and upload.
//
// Concurrency is capped at MAX_CONCURRENT to be polite to Scryfall and
// to keep the browser from queuing hundreds of fetches on a big import.

import { supabase } from './supabase';

const BUCKET = 'card-images';
const MAX_CONCURRENT = 5;
// Card art on Scryfall is immutable per id, so we can ask the CDN to
// cache it for a year. 31536000 seconds = 365 days.
const ONE_YEAR_S = '31536000';

// The Supabase public URL for an object in this bucket.
// We compute it ourselves rather than calling getPublicUrl in a loop
// (one fewer client-side allocation per card).
function publicUrlFor(path: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) throw new Error('VITE_SUPABASE_URL is not set');
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

// Cheap existence check that doesn't log noise to the browser console.
// (A HEAD on the public URL would return 400 for missing files — that's
// a Supabase Storage quirk, not a real error, but the browser logs it.)
// list() returns 200 with an empty array when nothing matches.
async function alreadyCached(fileName: string): Promise<boolean> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list('scryfall', { limit: 1, search: fileName });
  if (error) return false;
  return (data ?? []).some((f) => f.name === fileName);
}

// Upload the bytes at scryfallUrl to our bucket at the given path.
// upsert: true so a concurrent uploader of the same card just
// harmlessly overwrites with identical bytes.
async function fetchAndUpload(
  scryfallUrl: string,
  path: string,
  contentType: string
): Promise<void> {
  const imgRes = await fetch(scryfallUrl);
  if (!imgRes.ok) {
    throw new Error(`Scryfall image fetch failed: ${imgRes.status}`);
  }
  const blob = await imgRes.blob();

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    cacheControl: ONE_YEAR_S,
    contentType,
    upsert: true,
  });
  if (error) throw error;
}

// Ensure one card's image lives in our bucket; return the public URL.
// If anything goes wrong, fall back to the original Scryfall URL —
// the deck still works, we just lose the outage-resilience for this card.
export async function ensureCardImage(
  scryfallId: string,
  scryfallUrl: string
): Promise<string> {
  // Scryfall serves .jpg for normal-size images. If a card ever
  // returns .png or .webp we'd want to detect from the URL, but
  // for the "normal" size every card is jpg today.
  const ext = scryfallUrl.includes('.png') ? 'png' : 'jpg';
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const fileName = `${scryfallId}.${ext}`;
  const path = `scryfall/${fileName}`;
  const cachedUrl = publicUrlFor(path);

  if (await alreadyCached(fileName)) return cachedUrl;

  try {
    await fetchAndUpload(scryfallUrl, path, contentType);
    return cachedUrl;
  } catch (err) {
    console.warn('ensureCardImage fallback to Scryfall URL:', err);
    return scryfallUrl;
  }
}


// ---------------------------------------------------------------------
// Batch helper for deck imports — caps concurrency at MAX_CONCURRENT.
// Returns a parallel array of resolved URLs in the same order as input.
// ---------------------------------------------------------------------
export async function ensureCardImagesBatch(
  cards: { scryfall_id: string; scryfall_url: string }[]
): Promise<string[]> {
  const out: string[] = new Array(cards.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= cards.length) return;
      const card = cards[i]!;
      out[i] = await ensureCardImage(card.scryfall_id, card.scryfall_url);
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT, cards.length) },
    worker
  );
  await Promise.all(workers);
  return out;
}
