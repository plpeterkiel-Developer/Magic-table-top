-- =====================================================================
-- PodTable — initial schema (Phase 0 + Phase 1)
-- =====================================================================
--
-- This file is the *single source of truth* for the database shape.
-- Apply it in your Supabase project by either:
--   (a) Pasting it into the SQL editor in the Supabase dashboard, OR
--   (b) Using the Supabase CLI: `supabase db push`
--
-- The most important architectural rule of this app:
--   The database holds the live game state. Browsers never trust their
--   own copy as authoritative — they update rows in `game_cards`, and
--   Supabase Realtime broadcasts the new rows to every other player.
--
-- The second most important rule:
--   Privacy of hidden information (a player's hand, a library's
--   contents) is enforced HERE in the database via row-level security
--   (RLS) — not in the UI. A curious player inspecting network traffic
--   cannot fetch rows the database refuses to return.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Games — one row per game/pod
-- ---------------------------------------------------------------------
create table public.games (
  id           uuid primary key default gen_random_uuid(),
  room_code    text not null unique,
  host_user_id uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'waiting'
               check (status in ('waiting', 'playing', 'finished')),
  created_at   timestamptz not null default now()
);

comment on table public.games is
  'One row per game/pod. Players join by room_code.';


-- ---------------------------------------------------------------------
-- 2. Game players — the seats at a table
-- ---------------------------------------------------------------------
-- Up to 4 seats per game. seat_number is 0..3. Each seat picks a deck
-- (Phase 2) and has a life total that all players can see.
--
-- hand_count and library_count are denormalised summaries kept in sync
-- by a trigger on game_cards. They let other players see "how many
-- cards are in their hand" without the database ever revealing what
-- those cards are.
create table public.game_players (
  id              uuid primary key default gen_random_uuid(),
  game_id         uuid not null references public.games (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  seat_number     int  not null check (seat_number between 0 and 3),
  display_name    text not null,
  life_total      int  not null default 40,
  hand_count      int  not null default 0,
  library_count   int  not null default 0,
  joined_at       timestamptz not null default now(),
  unique (game_id, seat_number),
  unique (game_id, user_id)
);

comment on table public.game_players is
  'One row per seated player. Up to 4 per game.';


-- ---------------------------------------------------------------------
-- 3. Game cards — the live board (every card in the game)
-- ---------------------------------------------------------------------
-- Every card in every zone of every player is a row here. Moving a
-- card from hand to battlefield is an UPDATE of `zone` and `position`.
-- Tapping is an UPDATE of `tapped`. Creating a token is an INSERT
-- with is_token = true. Realtime watches this table.
--
-- `position` orders cards within a zone (so a library has a top, and
-- a hand has a left-to-right order). Lower = earlier; the top of the
-- library is the row with the smallest position in the library zone.
create table public.game_cards (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references public.games (id) on delete cascade,
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  zone           text not null
                 check (zone in ('library', 'hand', 'battlefield',
                                 'graveyard', 'exile', 'command')),
  position       int  not null default 0,
  scryfall_id    text,                  -- nullable: tokens have no Scryfall id
  name           text not null,
  image_url      text,                  -- nullable: tokens may have no image
  is_token       boolean not null default false,
  tapped         boolean not null default false,
  -- Phase 2 will add: counters jsonb, attached_to uuid
  created_at     timestamptz not null default now()
);

create index game_cards_game_zone_idx
  on public.game_cards (game_id, owner_user_id, zone, position);

comment on table public.game_cards is
  'Every card in the game, in whatever zone it currently occupies. The live board.';


-- ---------------------------------------------------------------------
-- 4. Trigger: keep hand_count and library_count in sync
-- ---------------------------------------------------------------------
-- This is what lets opponents see "they have 7 cards in hand" without
-- the database ever revealing the contents. SECURITY DEFINER lets the
-- trigger update game_players even when the acting user only owns
-- the card (not the row in game_players being updated).
create or replace function public.refresh_player_zone_counts(
  p_game_id uuid,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.game_players
  set hand_count = (
        select count(*) from public.game_cards
        where game_id = p_game_id and owner_user_id = p_user_id and zone = 'hand'
      ),
      library_count = (
        select count(*) from public.game_cards
        where game_id = p_game_id and owner_user_id = p_user_id and zone = 'library'
      )
  where game_id = p_game_id and user_id = p_user_id;
end;
$$;

create or replace function public.tg_game_cards_refresh_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE') then
    perform public.refresh_player_zone_counts(old.game_id, old.owner_user_id);
    return old;
  else
    perform public.refresh_player_zone_counts(new.game_id, new.owner_user_id);
    -- If a card somehow changes owner, refresh the previous owner too.
    if (tg_op = 'UPDATE' and old.owner_user_id <> new.owner_user_id) then
      perform public.refresh_player_zone_counts(old.game_id, old.owner_user_id);
    end if;
    return new;
  end if;
end;
$$;

create trigger game_cards_refresh_counts
  after insert or update or delete on public.game_cards
  for each row execute function public.tg_game_cards_refresh_counts();


-- ---------------------------------------------------------------------
-- 5. Row-level security (RLS)
-- ---------------------------------------------------------------------
-- RLS is what makes privacy real. With RLS enabled, every SELECT/
-- INSERT/UPDATE/DELETE the client makes is filtered by a policy:
-- the client never sees rows it isn't allowed to see, even via the
-- raw REST or Realtime APIs.
alter table public.games         enable row level security;
alter table public.game_players  enable row level security;
alter table public.game_cards    enable row level security;


-- Helper: is the current user seated at this game?
create or replace function public.is_player_in_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.game_players
    where game_id = p_game_id and user_id = auth.uid()
  );
$$;


-- ----- games -----
-- A logged-in user may look up a game by code (to join). The room code
-- is the access secret. Once seated, they can update the status if
-- they are the host.
create policy games_select_anyone_logged_in
  on public.games for select
  to authenticated
  using (true);

create policy games_insert_self_as_host
  on public.games for insert
  to authenticated
  with check (host_user_id = auth.uid());

create policy games_update_host_only
  on public.games for update
  to authenticated
  using (host_user_id = auth.uid())
  with check (host_user_id = auth.uid());

create policy games_delete_host_only
  on public.games for delete
  to authenticated
  using (host_user_id = auth.uid());


-- ----- game_players -----
-- Seated players can see the seats at their own table.
create policy game_players_select_seated
  on public.game_players for select
  to authenticated
  using (public.is_player_in_game(game_id));

-- A logged-in user inserts their own seat to join. We don't try to
-- enforce "table not full" here (it's a table rule, not Magic); the
-- unique constraint on (game_id, seat_number) plus app logic handles
-- it. We do enforce that you only insert YOUR OWN user_id.
create policy game_players_insert_self
  on public.game_players for insert
  to authenticated
  with check (user_id = auth.uid());

-- A seated player may update their own row (life, deck choice, etc.).
create policy game_players_update_self
  on public.game_players for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy game_players_delete_self
  on public.game_players for delete
  to authenticated
  using (user_id = auth.uid());


-- ----- game_cards -----
-- This is where hidden information lives. Three select policies:
--   1. Anyone seated at the game can read cards in SHARED zones.
--   2. The OWNER can additionally read their own hand and library.
-- A non-owner therefore cannot see another player's hand or library
-- contents at all. Counts come from game_players (kept by the trigger),
-- which is readable by all seated players.
create policy game_cards_select_shared_zones
  on public.game_cards for select
  to authenticated
  using (
    zone in ('battlefield', 'graveyard', 'exile', 'command')
    and public.is_player_in_game(game_id)
  );

create policy game_cards_select_own_hidden_zones
  on public.game_cards for select
  to authenticated
  using (
    owner_user_id = auth.uid()
    and public.is_player_in_game(game_id)
  );

-- A player may only touch their own cards. (If a future card effect
-- requires moving another player's permanent, the owner does it.
-- This matches the spec's Phase 1 acceptance criteria.)
create policy game_cards_insert_own
  on public.game_cards for insert
  to authenticated
  with check (
    owner_user_id = auth.uid()
    and public.is_player_in_game(game_id)
  );

create policy game_cards_update_own
  on public.game_cards for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy game_cards_delete_own
  on public.game_cards for delete
  to authenticated
  using (owner_user_id = auth.uid());


-- ---------------------------------------------------------------------
-- 6. Realtime — broadcast row changes to seated players
-- ---------------------------------------------------------------------
-- Supabase Realtime watches publications. We add our three tables to
-- the default `supabase_realtime` publication so the JS client can
-- subscribe to changes filtered by game_id.
--
-- RLS still applies to realtime payloads: a client only receives
-- change events for rows it would be allowed to SELECT.
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_players;
alter publication supabase_realtime add table public.game_cards;
