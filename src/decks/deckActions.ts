// All database writes for decks live here, in plain functions.
// Same pattern as game/gameActions.ts: components call these, RLS
// in Supabase makes sure you can only touch your own decks.

import { supabase } from '../lib/supabase';
import type { ScryfallCard } from '../lib/scryfall';
import { ensureCardImage, ensureCardImagesBatch } from '../lib/cardImages';
import type { Deck, DeckCard, DeckWithCards } from './types';

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

export async function listMyDecks(userId: string): Promise<Deck[]> {
  const { data, error } = await supabase
    .from('decks')
    .select('*')
    .eq('owner_user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Deck[];
}

export async function loadDeckWithCards(deckId: string): Promise<DeckWithCards> {
  // Two queries instead of a join, because RLS makes the join less
  // ergonomic in PostgREST and the two queries each return very small
  // result sets.
  const [{ data: deck, error: dErr }, { data: cards, error: cErr }] =
    await Promise.all([
      supabase.from('decks').select('*').eq('id', deckId).single(),
      supabase
        .from('deck_cards')
        .select('*')
        .eq('deck_id', deckId)
        .order('name', { ascending: true }),
    ]);
  if (dErr) throw dErr;
  if (cErr) throw cErr;
  return { deck: deck as Deck, cards: (cards ?? []) as DeckCard[] };
}


// ---------------------------------------------------------------------
// Deck-level writes
// ---------------------------------------------------------------------

export async function createDeck(
  userId: string,
  name: string
): Promise<Deck> {
  const { data, error } = await supabase
    .from('decks')
    .insert({ owner_user_id: userId, name: name.trim() })
    .select('*')
    .single();
  if (error) throw error;
  return data as Deck;
}

export async function renameDeck(deckId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('decks')
    .update({ name: name.trim() })
    .eq('id', deckId);
  if (error) throw error;
}

export async function deleteDeck(deckId: string): Promise<void> {
  // FK cascade deletes deck_cards.
  const { error } = await supabase.from('decks').delete().eq('id', deckId);
  if (error) throw error;
}

export async function setCommander(
  deckId: string,
  deckCardId: string | null
): Promise<void> {
  const { error } = await supabase
    .from('decks')
    .update({ commander_card_id: deckCardId })
    .eq('id', deckId);
  if (error) throw error;
}


// ---------------------------------------------------------------------
// Card-level writes
// ---------------------------------------------------------------------

// Add (or bump the quantity of) a Scryfall card in a deck. If the
// same scryfall_id is already in the deck, quantity is increased by 1
// rather than a duplicate row being inserted.
export async function addCardToDeck(
  deckId: string,
  card: ScryfallCard
): Promise<DeckCard> {
  // Cache the image to our bucket first so the deck is resilient.
  const cachedUrl = await ensureCardImage(card.scryfall_id, card.image_url);

  // Is this card already in the deck?
  const { data: existing, error: selErr } = await supabase
    .from('deck_cards')
    .select('*')
    .eq('deck_id', deckId)
    .eq('scryfall_id', card.scryfall_id)
    .maybeSingle();
  if (selErr) throw selErr;

  if (existing) {
    const next = (existing.quantity as number) + 1;
    const { data, error } = await supabase
      .from('deck_cards')
      .update({ quantity: next })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as DeckCard;
  }

  const { data, error } = await supabase
    .from('deck_cards')
    .insert({
      deck_id: deckId,
      scryfall_id: card.scryfall_id,
      name: card.name,
      image_url: cachedUrl,
      type_line: card.type_line,
      mana_cost: card.mana_cost,
      oracle_text: card.oracle_text,
      quantity: 1,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as DeckCard;
}

// Set the quantity directly. Setting to 0 deletes the row.
export async function setCardQuantity(
  deckCardId: string,
  quantity: number
): Promise<void> {
  if (quantity <= 0) {
    const { error } = await supabase
      .from('deck_cards')
      .delete()
      .eq('id', deckCardId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from('deck_cards')
    .update({ quantity })
    .eq('id', deckCardId);
  if (error) throw error;
}

export async function removeCardFromDeck(deckCardId: string): Promise<void> {
  const { error } = await supabase
    .from('deck_cards')
    .delete()
    .eq('id', deckCardId);
  if (error) throw error;
}


// ---------------------------------------------------------------------
// Bulk add — used by paste-decklist import.
// ---------------------------------------------------------------------
// Takes already-resolved Scryfall cards plus the quantity from the
// pasted list. Caches images in parallel, then INSERTs with merging
// against any existing rows for the same scryfall_id in the deck.
export async function addCardsBulk(
  deckId: string,
  rows: { card: ScryfallCard; quantity: number }[]
): Promise<void> {
  if (rows.length === 0) return;

  // Cache images first (capped concurrency lives inside ensureCardImagesBatch).
  const urls = await ensureCardImagesBatch(
    rows.map((r) => ({
      scryfall_id: r.card.scryfall_id,
      scryfall_url: r.card.image_url,
    }))
  );

  // Load the existing deck_cards once so we can merge quantities.
  const { data: existing, error: selErr } = await supabase
    .from('deck_cards')
    .select('id, scryfall_id, quantity')
    .eq('deck_id', deckId);
  if (selErr) throw selErr;

  const byScryfall = new Map<string, { id: string; quantity: number }>();
  for (const row of existing ?? []) {
    if (row.scryfall_id) {
      byScryfall.set(row.scryfall_id, {
        id: row.id as string,
        quantity: row.quantity as number,
      });
    }
  }

  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; quantity: number }[] = [];

  rows.forEach((row, i) => {
    const found = byScryfall.get(row.card.scryfall_id);
    if (found) {
      updates.push({ id: found.id, quantity: found.quantity + row.quantity });
    } else {
      inserts.push({
        deck_id: deckId,
        scryfall_id: row.card.scryfall_id,
        name: row.card.name,
        image_url: urls[i],
        type_line: row.card.type_line,
        mana_cost: row.card.mana_cost,
        oracle_text: row.card.oracle_text,
        quantity: row.quantity,
      });
    }
  });

  if (inserts.length > 0) {
    const { error } = await supabase.from('deck_cards').insert(inserts);
    if (error) throw error;
  }
  // Updates are issued one at a time. With a typical paste of a few
  // dozen merges this is fine; a Postgres function would be faster
  // if it ever became a bottleneck.
  for (const u of updates) {
    const { error } = await supabase
      .from('deck_cards')
      .update({ quantity: u.quantity })
      .eq('id', u.id);
    if (error) throw error;
  }
}
