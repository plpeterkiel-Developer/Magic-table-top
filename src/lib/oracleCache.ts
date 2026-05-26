// Lazy in-memory cache for Scryfall oracle_text.
//
// Why this exists: deck_cards / game_cards rows inserted before
// migration 0006 don't have oracle_text. Rather than backfilling the
// database, the Card component fetches missing oracle text on first
// hover/long-press. Calls for the same scryfall_id are deduplicated
// (in-flight promise sharing) and the result is kept for the rest
// of the browser session.

import { getCardById } from './scryfall';

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

export function getCachedOracleText(scryfallId: string): string | undefined {
  return cache.get(scryfallId);
}

export async function fetchOracleText(scryfallId: string): Promise<string> {
  const hit = cache.get(scryfallId);
  if (hit !== undefined) return hit;

  const existing = inflight.get(scryfallId);
  if (existing) return existing;

  const p = getCardById(scryfallId)
    .then((c) => {
      cache.set(scryfallId, c.oracle_text);
      inflight.delete(scryfallId);
      return c.oracle_text;
    })
    .catch((err) => {
      inflight.delete(scryfallId);
      throw err;
    });

  inflight.set(scryfallId, p);
  return p;
}
