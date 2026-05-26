// The whole shared table. Renders one PlayerBoard per seated player.
//
// Desktop: all boards visible, stacked vertically with the viewer's own
// board at the top.
// Mobile (≤720px, via CSS): only the board matching the selected player
// tab is visible. The tabs row above .boards drives selection.
import { useEffect, useState } from 'react';
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
  const [selectedSeat, setSelectedSeat] = useState(0);

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

  // Clamp selectedSeat to the current player list (in case someone left).
  const safeSeat = Math.min(selectedSeat, Math.max(0, orderedPlayers.length - 1));

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

      {/* Mobile-only player tabs — hidden on desktop via CSS. */}
      {orderedPlayers.length > 0 && (
        <nav className="player-tabs" aria-label="Switch player">
          {orderedPlayers.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`player-tab ${i === safeSeat ? 'active' : ''}`}
              onClick={() => setSelectedSeat(i)}
            >
              {p.display_name}
              {p.user_id === viewerId && ' (you)'}
            </button>
          ))}
        </nav>
      )}

      <main className="boards">
        {orderedPlayers.map((p, i) => (
          <PlayerBoard
            key={p.id}
            player={p}
            cards={state.cards}
            isOwner={p.user_id === viewerId}
            dataActive={i === safeSeat}
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
