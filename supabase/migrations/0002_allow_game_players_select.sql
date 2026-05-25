-- =====================================================================
-- 0002 — Allow any authenticated user to SELECT game_players
-- =====================================================================
-- The original policy game_players_select_seated only let *already
-- seated* players read the seats table. That blocks the join flow:
-- a new joiner needs to read seats to find an empty one. The query
-- returns zero rows (RLS filters silently), the client guesses seat 0,
-- and the INSERT fails with a unique-constraint violation when seat 0
-- is already taken.
--
-- Widening SELECT to any authenticated user is consistent with
-- games_select_anyone_logged_in, which already lets any authenticated
-- user enumerate games. The hidden-information boundary in this app
-- is game_cards (hands/libraries), which is not affected.
-- =====================================================================

drop policy if exists game_players_select_seated on public.game_players;

create policy game_players_select_any_authenticated
  on public.game_players for select
  to authenticated
  using (true);
