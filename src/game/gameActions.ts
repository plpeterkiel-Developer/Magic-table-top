// All write actions to the live board live here, in plain functions.
// Components call these; the database broadcasts the result via
// Realtime; every player's useGameState re-renders.
//
// IMPORTANT: every action is an UPDATE/INSERT/DELETE against the
// database. We never mutate local state directly. The database is
// the single source of truth.

import { supabase } from '../lib/supabase';
import type { GameCard, Zone } from '../lib/types';
import { getTestDeck } from '../lib/testDecks';

// ---------------------------------------------------------------------
// Deck initialisation (called when a player takes a seat)
// ---------------------------------------------------------------------
// Builds rows in game_cards for the player's chosen deck:
//   - commander -> command zone
//   - the rest, shuffled, into the library
// The DB trigger updates hand_count / library_count automatically.
export async function initialiseSeatCards({
  gameId,
  userId,
  deckId,
}: {
  gameId: string;
  userId: string;
  deckId: string;
}): Promise<void> {
  const deck = getTestDeck(deckId);
  if (!deck) throw new Error(`Unknown test deck: ${deckId}`);

  // Shuffle a copy of the library (Fisher–Yates).
  const library = [...deck.cards];
  for (let i = library.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [library[i], library[j]] = [library[j]!, library[i]!];
  }

  const rows = [
    {
      game_id: gameId,
      owner_user_id: userId,
      zone: 'command' as Zone,
      position: 0,
      name: deck.commander.name,
      image_url: null,
      is_token: false,
    },
    ...library.map((card, idx) => ({
      game_id: gameId,
      owner_user_id: userId,
      zone: 'library' as Zone,
      position: idx,
      name: card.name,
      image_url: null,
      is_token: false,
    })),
  ];

  const { error } = await supabase.from('game_cards').insert(rows);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Card movement & state changes
// ---------------------------------------------------------------------

// Move a single card to a target zone. The new position is "end of zone"
// unless explicitly specified.
export async function moveCard(
  card: GameCard,
  targetZone: Zone,
  targetPosition?: number
): Promise<void> {
  // If position isn't given, find max(position)+1 in the target zone.
  let position = targetPosition;
  if (position === undefined) {
    const { data } = await supabase
      .from('game_cards')
      .select('position')
      .eq('game_id', card.game_id)
      .eq('owner_user_id', card.owner_user_id)
      .eq('zone', targetZone)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    position = data ? data.position + 1 : 0;
  }

  // Untap when leaving the battlefield — a small UX nicety that
  // matches physical play (you don't drag a tapped card to your hand).
  const tapped = targetZone === 'battlefield' ? card.tapped : false;

  const { error } = await supabase
    .from('game_cards')
    .update({ zone: targetZone, position, tapped })
    .eq('id', card.id);
  if (error) throw error;
}

// Tap or untap a card on the battlefield.
export async function setTapped(cardId: string, tapped: boolean): Promise<void> {
  const { error } = await supabase
    .from('game_cards')
    .update({ tapped })
    .eq('id', cardId);
  if (error) throw error;
}

// Draw the top N cards from the player's library into their hand.
// "Top" = lowest position in zone=library.
export async function drawCards(
  gameId: string,
  userId: string,
  count = 1
): Promise<void> {
  const { data: topCards, error: selErr } = await supabase
    .from('game_cards')
    .select('*')
    .eq('game_id', gameId)
    .eq('owner_user_id', userId)
    .eq('zone', 'library')
    .order('position', { ascending: true })
    .limit(count);
  if (selErr) throw selErr;
  if (!topCards || topCards.length === 0) return;

  // Find current end-of-hand position.
  const { data: lastInHand } = await supabase
    .from('game_cards')
    .select('position')
    .eq('game_id', gameId)
    .eq('owner_user_id', userId)
    .eq('zone', 'hand')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextPos = lastInHand ? lastInHand.position + 1 : 0;

  // Update each drawn card to zone='hand' with sequential positions.
  // We update one-at-a-time for simplicity; for v1 this is plenty fast.
  for (const c of topCards) {
    const { error } = await supabase
      .from('game_cards')
      .update({ zone: 'hand', position: nextPos++ })
      .eq('id', c.id);
    if (error) throw error;
  }
}

// Mill = move the top card of the library to the graveyard.
export async function millOne(gameId: string, userId: string): Promise<void> {
  const { data: top, error } = await supabase
    .from('game_cards')
    .select('*')
    .eq('game_id', gameId)
    .eq('owner_user_id', userId)
    .eq('zone', 'library')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!top) return;
  await moveCard(top as GameCard, 'graveyard');
}

// Shuffle the library: read all library card ids in order, randomise,
// and write the new positions back.
export async function shuffleLibrary(gameId: string, userId: string): Promise<void> {
  const { data: lib, error } = await supabase
    .from('game_cards')
    .select('id')
    .eq('game_id', gameId)
    .eq('owner_user_id', userId)
    .eq('zone', 'library');
  if (error) throw error;
  if (!lib || lib.length === 0) return;

  const ids = lib.map((r) => r.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }

  // Write new positions one by one. Slow for huge decks but fine for ~100.
  for (let pos = 0; pos < ids.length; pos++) {
    const { error: upErr } = await supabase
      .from('game_cards')
      .update({ position: pos })
      .eq('id', ids[pos]!);
    if (upErr) throw upErr;
  }
}

// ---------------------------------------------------------------------
// Life total
// ---------------------------------------------------------------------
export async function adjustLife(
  playerRowId: string,
  currentLife: number,
  delta: number
): Promise<void> {
  const { error } = await supabase
    .from('game_players')
    .update({ life_total: currentLife + delta })
    .eq('id', playerRowId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------
export async function createToken({
  gameId,
  userId,
  name,
}: {
  gameId: string;
  userId: string;
  name: string;
}): Promise<void> {
  // Place on battlefield at end-of-row.
  const { data: last } = await supabase
    .from('game_cards')
    .select('position')
    .eq('game_id', gameId)
    .eq('owner_user_id', userId)
    .eq('zone', 'battlefield')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = last ? last.position + 1 : 0;

  const { error } = await supabase.from('game_cards').insert({
    game_id: gameId,
    owner_user_id: userId,
    zone: 'battlefield',
    position,
    name: name || 'Token',
    is_token: true,
    image_url: null,
  });
  if (error) throw error;
}

// Tokens are deleted outright — they cease to exist. Non-token cards
// must NEVER be deleted this way; they get moved to graveyard/exile.
export async function deleteToken(cardId: string): Promise<void> {
  const { error } = await supabase
    .from('game_cards')
    .delete()
    .eq('id', cardId)
    .eq('is_token', true);
  if (error) throw error;
}
