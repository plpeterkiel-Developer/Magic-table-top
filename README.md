# PodTable

A manual digital tabletop for multiplayer Magic: The Gathering (Commander).
The app is a synchronised shared playmat — it **never** validates or enforces
Magic rules. Players move cards, tap permanents, track life, and play the game
themselves, exactly as they would around a physical table.

The app's only job is the **table itself**: whose cards are whose, that a game
has 2–4 seats, and that the board state is shared correctly across browsers.

---

## What's built so far

This is the **Phase 0 + Phase 1** build, per the spec.

**Phase 0 — Skeleton + login** ✅
- React + Vite + TypeScript scaffold
- Supabase Auth (email + password). The app never sees a raw password.

**Phase 1 — 2-player real-time shared board with hardcoded test decks** ✅
- Create / join a game by short room code
- Up to 4 seats per game (Phase 1 acceptance is for 2; the seat code already supports up to 4)
- Hardcoded test decks (mono-red, mono-blue) — Scryfall card search comes in Phase 2
- Six zones per player: command, library, hand, battlefield, graveyard, exile
- Move any owned card from any zone to any zone (no Magic-rules validation)
- Tap / untap cards on the battlefield (visual 90° rotate)
- Adjust own life total ± 1
- Draw, mill, shuffle (click Draw seven times for an opening hand)
- Create and delete labelled tokens
- Hidden information enforced at the **database level** (row-level security): nobody — not even via raw network inspection — can read another player's hand or library
- Live sync via Supabase Realtime (~1s end-to-end)
- Reconnect-safe: closing and reopening a browser mid-game re-fetches the current state

**Not yet built (deliberately deferred per the spec's phase order):**
- Scryfall integration & real deck building (Phase 2)
- Manual mana pool, attaching auras/equipment, named counters on cards (Phase 2)
- Mobile-first responsive layout (one player at a time) (Phase 3)
- Untap-all, board reset, dice, hover-preview, commander damage (Phase 4)

---

## Setting it up locally

You need:
- Node.js 20 (`.nvmrc` is in the repo)
- A free Supabase project at https://supabase.com

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

1. Sign up / log in at https://supabase.com.
2. Create a new project. Choose any region close to your friend group.
3. Once it's ready, go to **Project Settings → API** and copy:
   - **Project URL** (looks like `https://xxxxxxxxxx.supabase.co`)
   - **`anon` public key** (the long `ey…` string)

### 3. Apply the database schema

Open **SQL Editor** in the Supabase dashboard, paste the entire contents of
`supabase/migrations/0001_initial_schema.sql`, and run it. This creates three
tables (`games`, `game_players`, `game_cards`), the row-level security policies
that protect hidden information, and enables Realtime.

> If you have the Supabase CLI installed and the project linked, you can
> instead run `supabase db push`.

### 4. Turn off email confirmation (for easy local testing)

By default Supabase asks new users to confirm their email. To make local
testing easier, go to **Authentication → Providers → Email** and toggle
**"Confirm email"** off. (Re-enable it before you deploy publicly.)

### 5. Create your env file

```bash
cp .env.example .env.local
```

Open `.env.local` and paste in the URL and anon key from step 2.

### 6. Run the dev server

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

---

## How to test 2-player sync (the Phase 1 acceptance test)

1. Open the app in two browser windows. Use a normal window and an
   incognito window so each has its own session.
2. In window A: Sign up as **player-a**. Click **Create game**. Note the room code.
3. In window B: Sign up as **player-b**. Enter the room code. Click **Join game**.
4. Verify in both windows:
   - Both players' boards are visible.
   - Click **Draw** seven times in window A. Window B should see A's hand
     count rise to 7 within ~1 second, but the contents stay hidden.
   - Move a card in A's hand to the battlefield (click the card → choose
     "→ Battlefield"). Window B should see the card appear on A's battlefield.
   - Tap it. Window B should see it rotated.
   - Click **+ Token** in A, type "1/1 Soldier", press Create. Window B should
     see the token appear. Delete it. Window B should see it disappear.
   - Adjust A's life total. Window B should see the change.
   - Close window B and reopen it. The current board state should reload correctly.

If any of the above doesn't work, **do not move on to Phase 2**. The spec is
explicit: prove Phase 1 first.

---

## Architecture (in plain language)

There is **one source of truth for the live game**: rows in the Supabase
database. Browsers never trust their own copy as authoritative.

- A player clicks "tap this card" → the browser sends an `UPDATE game_cards SET
  tapped = true WHERE id = …` to Supabase.
- Supabase Realtime watches `game_cards` and broadcasts the new row to every
  browser subscribed to that game.
- Every browser's `useGameState` hook applies the change to its local React
  state, and the card re-renders rotated.

This is what keeps four browsers consistent. Peer-to-peer state would fall
apart the moment two people act at once or someone reconnects.

Privacy (hands, libraries) is enforced by **row-level security** in the
database — not in the UI. A curious player inspecting network traffic cannot
fetch rows the database refuses to return. Counts (hand size, library size)
are exposed via columns on `game_players` that a Postgres trigger keeps in
sync, so opponents can see "they have 7 in hand" without ever seeing the
contents.

### File layout

```
src/
  main.tsx               # Entry point. Mounts <App />.
  App.tsx                # Top-level state machine: logged-out / lobby / in-game.
  index.css              # All styles. One file, vanilla CSS, no framework.
  vite-env.d.ts          # TS types for import.meta.env.

  lib/
    supabase.ts          # The one shared Supabase client.
    types.ts             # TS types mirroring the DB schema.
    roomCode.ts          # Short, unambiguous room-code generator.
    testDecks.ts         # Hardcoded decks for Phase 1 (replaced in Phase 2).

  auth/
    AuthProvider.tsx     # React context for the current session.
    AuthForm.tsx         # Sign-in / sign-up form.

  lobby/
    Lobby.tsx            # Create or join a game.

  game/
    gameActions.ts       # Plain functions: moveCard, tap, draw, mill, etc.
                         # Every action is an INSERT/UPDATE/DELETE to the DB.
    useGameState.ts      # Realtime hook: fetch + subscribe + patch local state.
    GameTable.tsx        # The whole table.
    PlayerBoard.tsx      # One seated player's full board.
    Card.tsx             # One card + its click-to-act menu.

supabase/
  migrations/
    0001_initial_schema.sql   # The DB schema, RLS, trigger, realtime pub.
```

### Why click-to-act and not drag-and-drop?

Phase 1 uses click → menu → choose target zone. It's much easier to make
reliable across desktop and mobile than drag-and-drop, and it works equally
well with a finger or a mouse. Drag-and-drop is a P1 polish, not a P0.

---

## Hard constraints (do not violate)

1. **Never implement Magic rules logic.** If a feature requires the app to
   "know what a card does," it is out of scope.
2. **Build phases in order; prove Phase 1 before anything else.**
3. **One source of truth for game state, in the database.** No peer-to-peer
   state. No per-browser authoritative state.
4. **Never handle raw passwords.** Auth is delegated to Supabase.
5. **Comment the code in plain language** and keep the structure simple,
   because the author is learning.
