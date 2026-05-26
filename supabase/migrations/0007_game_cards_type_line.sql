-- =====================================================================
-- 0007 — Add type_line to game_cards (Phase 3)
-- =====================================================================
-- Battlefield is now subdivided into three rows: creatures+planeswalkers,
-- artifacts+enchantments, and lands. The client buckets each card by
-- reading its type_line. Tokens get a synthetic type_line ("Token
-- Creature — 1/1 Soldier" etc.) at creation time so the same bucketing
-- logic applies uniformly.
--
-- Rows pre-dating this migration carry NULL; the client lazily fetches
-- from Scryfall (via cardCache) and falls back to the creatures row in
-- the meantime.
-- =====================================================================

alter table public.game_cards add column type_line text;
