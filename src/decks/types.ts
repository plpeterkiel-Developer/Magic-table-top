// Deck-related types. Mirror the database tables in
// supabase/migrations/0004_decks.sql.

export interface Deck {
  id: string;
  owner_user_id: string;
  name: string;
  commander_card_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeckCard {
  id: string;
  deck_id: string;
  scryfall_id: string | null;
  name: string;
  image_url: string | null;
  type_line: string | null;
  mana_cost: string | null;
  oracle_text: string | null;
  quantity: number;
  created_at: string;
}

// A deck loaded together with its cards. Convenient for the deck-builder
// and for game-start (when we fan out into game_cards).
export interface DeckWithCards {
  deck: Deck;
  cards: DeckCard[];
}
