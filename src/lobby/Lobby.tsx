// Logged-in landing page. Lets the player open the deck manager,
// create a new game (becoming the host), or join an existing one by
// room code. Once they're in a game, App.tsx hands off to <GameTable />.
//
// Phase 2: deck choice now comes from the user's saved decks (built
// in <DeckBuilder />). The hardcoded TEST_DECKS list still appears as
// a fallback during local dev (import.meta.env.DEV) so the Playwright
// e2e tests don't depend on Scryfall.

import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { generateRoomCode, normaliseRoomCode } from '../lib/roomCode';
import { TEST_DECKS } from '../lib/testDecks';
import {
  initialiseSeatCardsFromDeck,
  initialiseSeatCardsFromTestDeck,
} from '../game/gameActions';
import { listMyDecks } from '../decks/deckActions';
import type { Deck } from '../decks/types';

interface LobbyProps {
  onJoined: (gameId: string) => void;
  onOpenDecks: () => void;
}

// In dev builds, prefix test-deck option values so the choice handler
// knows which initialiser to call. Production builds never see these.
const TEST_PREFIX = 'test:';

export function Lobby({ onJoined, onOpenDecks }: LobbyProps) {
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState('');
  const [decks, setDecks] = useState<Deck[] | null>(null);
  // Default to a test deck synchronously in DEV so Playwright doesn't race
  // the listMyDecks fetch when it immediately clicks Create after sign-up.
  const [selection, setSelection] = useState<string>(() =>
    import.meta.env.DEV && TEST_DECKS.length > 0
      ? TEST_PREFIX + TEST_DECKS[0]!.id
      : ''
  );

  const displayName: string =
    (user?.user_metadata?.display_name as string | undefined) ??
    user?.email?.split('@')[0] ??
    'Player';

  // Load the user's saved decks once. Test decks are appended in DEV.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listMyDecks(user.id)
      .then((d) => {
        if (cancelled) return;
        setDecks(d);
        // Default selection: first real deck, else first test deck in DEV.
        if (d.length > 0) setSelection(d[0]!.id);
        else if (import.meta.env.DEV && TEST_DECKS.length > 0)
          setSelection(TEST_PREFIX + TEST_DECKS[0]!.id);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const hasAnyDeck =
    (decks?.length ?? 0) > 0 || (import.meta.env.DEV && TEST_DECKS.length > 0);

  async function handleCreate() {
    if (!user) return;
    if (!hasAnyDeck) {
      setError('Build a deck first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let game: { id: string; room_code: string } | null = null;
      for (let attempt = 0; attempt < 5 && !game; attempt++) {
        const code = generateRoomCode();
        const { data, error } = await supabase
          .from('games')
          .insert({ room_code: code, host_user_id: user.id })
          .select('id, room_code')
          .single();
        if (!error && data) {
          game = data;
          break;
        }
        if (error && error.code !== '23505') throw error;
      }
      if (!game) throw new Error('Could not generate a unique room code.');

      await joinSeat(game.id, 0);
      onJoined(game.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!user) return;
    if (!hasAnyDeck) {
      setError('Build a deck first.');
      return;
    }
    const code = normaliseRoomCode(joinCode);
    if (!code) {
      setError('Please enter a room code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: game, error: gameErr } = await supabase
        .from('games')
        .select('id, room_code, status')
        .eq('room_code', code)
        .maybeSingle();
      if (gameErr) throw gameErr;
      if (!game) throw new Error('No game found with that code.');

      const { data: seats, error: seatErr } = await supabase
        .from('game_players')
        .select('seat_number, user_id')
        .eq('game_id', game.id);
      if (seatErr) throw seatErr;

      const existing = seats?.find((s) => s.user_id === user.id);
      if (existing) {
        onJoined(game.id);
        return;
      }

      const taken = new Set((seats ?? []).map((s) => s.seat_number));
      let nextSeat = -1;
      for (let i = 0; i < 4; i++) {
        if (!taken.has(i)) {
          nextSeat = i;
          break;
        }
      }
      if (nextSeat === -1) throw new Error('This table is full (4 seats).');

      await joinSeat(game.id, nextSeat);
      onJoined(game.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Insert our row in game_players, then deal out the chosen deck.
  // Routes to the real-deck or test-deck initialiser based on selection.
  async function joinSeat(gameId: string, seatNumber: number) {
    if (!user) return;
    const { error: insErr } = await supabase.from('game_players').insert({
      game_id: gameId,
      user_id: user.id,
      seat_number: seatNumber,
      display_name: displayName,
      life_total: 40,
    });
    if (insErr) throw insErr;

    if (selection.startsWith(TEST_PREFIX)) {
      await initialiseSeatCardsFromTestDeck({
        gameId,
        userId: user.id,
        testDeckId: selection.slice(TEST_PREFIX.length),
      });
    } else {
      await initialiseSeatCardsFromDeck({
        gameId,
        userId: user.id,
        deckId: selection,
      });
    }
  }

  const deckOptions = (
    <>
      {(decks ?? []).map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
      {import.meta.env.DEV &&
        TEST_DECKS.map((d) => (
          <option key={d.id} value={TEST_PREFIX + d.id}>
            (dev) {d.name}
          </option>
        ))}
    </>
  );

  return (
    <div className="lobby">
      <header className="topbar">
        <strong>PodTable</strong>
        <span className="muted">Signed in as {displayName}</span>
        <button type="button" className="ghost" onClick={onOpenDecks}>
          My Decks
        </button>
        <button type="button" className="ghost" onClick={signOut}>
          Sign out
        </button>
      </header>

      <main className="lobby-grid">
        {decks !== null && decks.length === 0 && !import.meta.env.DEV && (
          <section className="card full info">
            You don't have any decks yet.{' '}
            <button type="button" className="link" onClick={onOpenDecks}>
              Build one
            </button>{' '}
            before creating or joining a game.
          </section>
        )}

        <section className="card">
          <h2>Start a new game</h2>
          <p className="muted">
            You'll be the host. Share the room code with friends after the game
            is created.
          </p>
          <label className="field">
            <span>Bring this deck</span>
            <select
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
              disabled={!hasAnyDeck}
              aria-label="Deck for new game"
            >
              {deckOptions}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            onClick={handleCreate}
            disabled={busy || !hasAnyDeck}
          >
            {busy ? 'Working…' : 'Create game'}
          </button>
        </section>

        <section className="card">
          <h2>Join a game</h2>
          <p className="muted">Enter the room code your host shared.</p>
          <label className="field">
            <span>Room code</span>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoCorrect="off"
            />
          </label>
          <label className="field">
            <span>Bring this deck</span>
            <select
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
              disabled={!hasAnyDeck}
              aria-label="Deck when joining"
            >
              {deckOptions}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            onClick={handleJoin}
            disabled={busy || !hasAnyDeck}
          >
            {busy ? 'Working…' : 'Join game'}
          </button>
        </section>

        {error && <div className="error full">{error}</div>}
      </main>
    </div>
  );
}
