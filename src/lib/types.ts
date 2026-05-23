// Shared TypeScript types. These mirror the database tables in
// supabase/migrations/0001_initial_schema.sql. If you change the
// schema, change these too.

export type Zone =
  | 'library'
  | 'hand'
  | 'battlefield'
  | 'graveyard'
  | 'exile'
  | 'command';

export const SHARED_ZONES: Zone[] = ['battlefield', 'graveyard', 'exile', 'command'];
export const HIDDEN_ZONES: Zone[] = ['library', 'hand'];
export const ALL_ZONES: Zone[] = [...HIDDEN_ZONES, ...SHARED_ZONES];

export type GameStatus = 'waiting' | 'playing' | 'finished';

export interface Game {
  id: string;
  room_code: string;
  host_user_id: string;
  status: GameStatus;
  created_at: string;
}

export interface GamePlayer {
  id: string;
  game_id: string;
  user_id: string;
  seat_number: number;
  display_name: string;
  life_total: number;
  hand_count: number;
  library_count: number;
  joined_at: string;
}

export interface GameCard {
  id: string;
  game_id: string;
  owner_user_id: string;
  zone: Zone;
  position: number;
  scryfall_id: string | null;
  name: string;
  image_url: string | null;
  is_token: boolean;
  tapped: boolean;
  created_at: string;
}

// The full snapshot the client uses to render the table.
// Built up by useGameState from realtime subscriptions.
export interface GameState {
  game: Game;
  players: GamePlayer[];
  cards: GameCard[];
}
