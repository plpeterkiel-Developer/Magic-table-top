-- =====================================================================
-- 0004 — decks + deck_cards (Phase 2: Scryfall + real deck building)
-- =====================================================================
-- A "deck" is a user-owned named collection of cards. At game-create
-- (or join) time, the chosen deck's cards are copied into game_cards:
--   - the row pointed at by commander_card_id -> command zone
--   - every other row -> library, fanned out by quantity, shuffled
--
-- No Magic-rules enforcement here. The schema does not check
-- 100-card minimums, color identity, or singleton rules. That's
-- deliberate per the project's hard constraint.
-- =====================================================================


-- ---------------------------------------------------------------------
-- decks — one row per saved deck
-- ---------------------------------------------------------------------
-- commander_card_id is nullable so a deck can be drafted before its
-- commander is chosen. The FK is added AFTER deck_cards exists.
create table public.decks (
  id                uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references auth.users (id) on delete cascade,
  name              text not null check (length(trim(name)) > 0),
  commander_card_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index decks_owner_idx on public.decks (owner_user_id);

comment on table public.decks is
  'A player''s saved deck. commander_card_id (if set) points to a row in deck_cards that becomes the command-zone card at game start.';


-- ---------------------------------------------------------------------
-- deck_cards — one row per distinct card in a deck (with a quantity)
-- ---------------------------------------------------------------------
-- We store the Scryfall metadata we need at game-start time so we
-- don't have to re-fetch it. image_url is the Supabase Storage URL
-- after the proxy step (see migration 0005); it can also be a raw
-- Scryfall URL as a fallback.
create table public.deck_cards (
  id           uuid primary key default gen_random_uuid(),
  deck_id      uuid not null references public.decks (id) on delete cascade,
  scryfall_id  text,
  name         text not null,
  image_url    text,
  type_line    text,
  mana_cost    text,
  quantity     int  not null default 1
               check (quantity > 0 and quantity <= 100),
  created_at   timestamptz not null default now()
);

create index deck_cards_deck_idx on public.deck_cards (deck_id);

comment on table public.deck_cards is
  'One row per distinct card in a deck, with a quantity (so 20 Mountains is one row, not 20).';


-- Now that deck_cards exists, attach the commander FK on decks.
-- ON DELETE SET NULL: if the commander row gets deleted from
-- deck_cards, the deck just loses its commander (rather than
-- cascading and nuking the whole deck).
alter table public.decks
  add constraint decks_commander_fk
  foreign key (commander_card_id)
  references public.deck_cards (id)
  on delete set null;


-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function public.tg_decks_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger decks_touch_updated_at
  before update on public.decks
  for each row execute function public.tg_decks_touch_updated_at();


-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
-- Decks are private to their owner. No sharing yet — a future phase
-- can add explicit share rows. Importantly, decks are NOT readable
-- by opponents in a game: at game-start the deck's cards are COPIED
-- into game_cards, where the existing game_cards RLS takes over.
alter table public.decks      enable row level security;
alter table public.deck_cards enable row level security;


-- decks: owner-only CRUD
create policy decks_owner_select
  on public.decks for select
  to authenticated
  using (owner_user_id = auth.uid());

create policy decks_owner_insert
  on public.decks for insert
  to authenticated
  with check (owner_user_id = auth.uid());

create policy decks_owner_update
  on public.decks for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy decks_owner_delete
  on public.decks for delete
  to authenticated
  using (owner_user_id = auth.uid());


-- deck_cards: owner of the parent deck has full access
create policy deck_cards_owner_select
  on public.deck_cards for select
  to authenticated
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_id and d.owner_user_id = auth.uid()
    )
  );

create policy deck_cards_owner_insert
  on public.deck_cards for insert
  to authenticated
  with check (
    exists (
      select 1 from public.decks d
      where d.id = deck_id and d.owner_user_id = auth.uid()
    )
  );

create policy deck_cards_owner_update
  on public.deck_cards for update
  to authenticated
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_id and d.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.decks d
      where d.id = deck_id and d.owner_user_id = auth.uid()
    )
  );

create policy deck_cards_owner_delete
  on public.deck_cards for delete
  to authenticated
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_id and d.owner_user_id = auth.uid()
    )
  );
