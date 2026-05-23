// The whole shared table. Renders one PlayerBoard per seated player.
//
// Phase 3 will make this responsive (desktop = all boards, mobile = one
// player at a time with tabs). For Phase 1 we just stack them vertically
// with the viewer's own board at the top — readable on any screen.
import { useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useGameState } from './useGameState';
import { PlayerBoard } from './PlayerBoard';

interface GameTableProps {
  gameId: string;
  onLeave: () => void;
}

export function GameTable({ gameId, onLeave }: GameTableProps) {
  const { user } = useAuth();
  const { state, error, loading } = useGameState(gameId);

  // Friendly tab title — handy when you have multiple browser windows
  // open for testing 2-player sync.
  useEffect(() => {
    if (state?.game?.room_code) {
      document.title = `PodTable · ${state.game.room_code}`;
    } else {
      document.title = 'PodTable';
    }
    return () => {
      document.title = 'PodTable';
    };
  }, [state?.game?.room_code]);

  if (loading || !state) {
    return (
      <div className="centered">
        {error ? <div className="error">{error}</div> : <p>Loading game…</p>}
        <button type="button" className="ghost" onClick={onLeave}>
          Back to lobby
        </button>
      </div>
    );
  }

  // Put the viewer's own board first; opponents after.
  const viewerId = user?.id;
  const orderedPlayers = [
    ...state.players.filter((p) => p.user_id === viewerId),
    ...state.players.filter((p) => p.user_id !== viewerId),
  ];

  return (
    <div className="game">
      <header className="topbar">
        <strong>PodTable</strong>
        <span>
          Room code:{' '}
          <code className="room-code" onClick={() => copy(state.game.room_code)}>
            {state.game.room_code}
          </code>
        </span>
        <span className="muted">{state.players.length} seated</span>
        <button type="button" className="ghost" onClick={onLeave}>
          Leave
        </button>
      </header>

      {error && <div className="error">{error}</div>}

      <main className="boards">
        {orderedPlayers.map((p) => (
          <PlayerBoard
            key={p.id}
            player={p}
            cards={state.cards}
            isOwner={p.user_id === viewerId}
          />
        ))}
        {state.players.length < 2 && (
          <div className="hint">
            Waiting for at least one more player. Share the room code{' '}
            <strong>{state.game.room_code}</strong>.
          </div>
        )}
      </main>
    </div>
  );
}

function copy(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => undefined);
  }
}
