-- =====================================================================
-- 0003 — REPLICA IDENTITY FULL on game tables
-- =====================================================================
-- Supabase Realtime needs the full pre-image of a row to evaluate RLS
-- on UPDATE/DELETE events. With the Postgres default (REPLICA IDENTITY
-- DEFAULT), the WAL `old` payload contains only the primary key — so
-- our SELECT policies (which check owner_user_id, zone, and
-- is_player_in_game()) can't be evaluated and the events are silently
-- dropped.
--
-- Visible symptom that prompted this: deleting a token on the
-- battlefield doesn't update the UI until a hard refresh, because the
-- DELETE event never reached the client.
--
-- Cost: slightly more WAL volume on UPDATE/DELETE (the full old row is
-- written). For a 4-player tabletop with small rows, negligible.
-- =====================================================================

alter table public.games        replica identity full;
alter table public.game_players replica identity full;
alter table public.game_cards   replica identity full;
