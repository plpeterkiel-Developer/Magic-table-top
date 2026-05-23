// Logged-in landing page. Lets the player create a new game (becoming
// the host) or join an existing one by room code. Once they're in a
// game, App.tsx hands off to <GameTable />.
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { generateRoomCode, normaliseRoomCode } from '../lib/roomCode';
import { TEST_DECKS } from '../lib/testDecks';
import { initialiseSeatCards } from '../game/gameActions';

interface LobbyProps {
  onJoined: (gameId: string) => void;
}

export function Lobby({ onJoined }: LobbyProps) {
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState('');
  const [deckId, setDeckId] = useState(TEST_DECKS[0]!.id);

  const displayName: string =
    (user?.user_metadata?.display_name as string | undefined) ??
    user?.email?.split('@')[0] ??
    'Player';

  async function handleCreate() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      // Try a few times in the very unlikely case of a code collision.
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
        // Unique violation? Try again. Anything else? Bail.
        if (error && error.code !== '23505') throw error;
      }
      if (!game) throw new Error('Could not generate a unique room code.');

      // Take seat 0 as the host. Then deal out a test deck.
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

      // Find an empty seat (0..3) at this table.
      const { data: seats, error: seatErr } = await supabase
        .from('game_players')
        .select('seat_number, user_id')
        .eq('game_id', game.id);
      if (seatErr) throw seatErr;

      // If the player is already seated, just rejoin their existing seat.
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

  // Insert our row in game_players, then deal out the chosen test deck.
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

    await initialiseSeatCards({
      gameId,
      userId: user.id,
      deckId,
    });
  }

  return (
    <div className="lobby">
      <header className="topbar">
        <strong>PodTable</strong>
        <span className="muted">Signed in as {displayName}</span>
        <button type="button" className="ghost" onClick={signOut}>
          Sign out
        </button>
      </header>

      <main className="lobby-grid">
        <section className="card">
          <h2>Start a new game</h2>
          <p className="muted">
            You'll be the host. Share the room code with friends after the game
            is created.
          </p>
          <label className="field">
            <span>Bring this deck (Phase 1: test decks only)</span>
            <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
              {TEST_DECKS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            onClick={handleCreate}
            disabled={busy}
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
            <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
              {TEST_DECKS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            onClick={handleJoin}
            disabled={busy}
          >
            {busy ? 'Working…' : 'Join game'}
          </button>
        </section>

        {error && <div className="error full">{error}</div>}
      </main>
    </div>
  );
}
