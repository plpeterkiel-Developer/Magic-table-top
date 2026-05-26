-- =====================================================================
-- 0006 — Add oracle_text to deck_cards and game_cards (Phase 2 polish)
-- =====================================================================
-- Plain Magic rules text for a card, as returned by Scryfall.
-- Used by the Card component to render a hover/long-press overlay so
-- a player can read what any card does without trying to squint at
-- the printed text on the (tiny) thumbnail.
--
-- Nullable: existing rows from before this migration carry NULL.
-- The client lazily fetches from Scryfall on first hover for those
-- rows and caches in-memory (see src/lib/oracleCache.ts).
-- =====================================================================

alter table public.deck_cards add column oracle_text text;
alter table public.game_cards add column oracle_text text;
