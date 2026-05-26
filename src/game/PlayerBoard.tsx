// One seated player's whole board: command + library + hand +
// battlefield + graveyard + exile, plus life total.
//
// We render the same component for the viewer and for each opponent;
// `isOwner` controls what's interactive and what's hidden. On mobile
// the parent GameTable hides all boards except the one matching the
// active player tab via the `dataActive` prop.
import type { GameCard, GamePlayer } from '../lib/types';
import { Card } from './Card';
import { Battlefield } from './Battlefield';
import {
  drawCards,
  millOne,
  shuffleLibrary,
  adjustLife,
  createToken,
  type TokenCategory,
} from './gameActions';

interface PlayerBoardProps {
  player: GamePlayer;
  cards: GameCard[];     // all cards in the game (we filter to this player)
  isOwner: boolean;       // is the viewer this player?
  dataActive?: boolean;   // mobile-only flag toggled by GameTable's player tabs
}

function pickZone(cards: GameCard[], ownerId: string, zone: GameCard['zone']) {
  return cards
    .filter((c) => c.owner_user_id === ownerId && c.zone === zone)
    .sort((a, b) => a.position - b.position);
}

export function PlayerBoard({ player, cards, isOwner, dataActive = true }: PlayerBoardProps) {
  const battlefield = pickZone(cards, player.user_id, 'battlefield');
  const graveyard = pickZone(cards, player.user_id, 'graveyard');
  const exile = pickZone(cards, player.user_id, 'exile');
  const command = pickZone(cards, player.user_id, 'command');
  const hand = pickZone(cards, player.user_id, 'hand');
  // We will only HAVE library rows in `cards` if we're the owner
  // (RLS blocks others from selecting them). Same for opponents' hands.

  async function handleDraw() {
    await drawCards(player.game_id, player.user_id, 1);
  }
  async function handleMill() {
    await millOne(player.game_id, player.user_id);
  }
  async function handleShuffle() {
    await shuffleLibrary(player.game_id, player.user_id);
  }
  async function handleLife(delta: number) {
    await adjustLife(player.id, player.life_total, delta);
  }
  async function handleCreateToken(name: string, category: TokenCategory) {
    const trimmed = name.trim();
    if (!trimmed) return;
    await createToken({
      gameId: player.game_id,
      userId: player.user_id,
      name: trimmed,
      category,
    });
  }

  return (
    <section
      className={`player-board ${isOwner ? 'own' : 'opponent'}`}
      data-active={dataActive ? 'true' : 'false'}
    >
      <header className="player-header">
        <div className="player-id">
          <span className="seat-badge">Seat {player.seat_number + 1}</span>
          <strong>{player.display_name}</strong>
          {isOwner && <span className="muted">(you)</span>}
        </div>
        <div className="life">
          {isOwner && (
            <button type="button" onClick={() => handleLife(-1)} aria-label="Life -1">
              −
            </button>
          )}
          <span className="life-total">{player.life_total}</span>
          {isOwner && (
            <button type="button" onClick={() => handleLife(+1)} aria-label="Life +1">
              +
            </button>
          )}
        </div>
      </header>

      <div className="zones">
        <Zone label="Battlefield" count={battlefield.length} kind="widest">
          <Battlefield
            cards={battlefield}
            isOwner={isOwner}
            onCreateToken={isOwner ? handleCreateToken : undefined}
          />
        </Zone>

        <Zone label="Hand" count={player.hand_count} kind="wide">
          {/* Owner sees their actual hand. Opponents see only face-down placeholders. */}
          {isOwner
            ? hand.map((c) => <Card key={c.id} card={c} isOwner={true} />)
            : Array.from({ length: player.hand_count }, (_, i) => (
                <div key={i} className="card face-down" aria-label="Hidden card">
                  <div className="card-back" />
                </div>
              ))}
        </Zone>

        <Zone label="Command" count={command.length} kind="narrow">
          {command.map((c) => (
            <Card key={c.id} card={c} isOwner={isOwner} />
          ))}
        </Zone>

        <Zone label="Library" count={player.library_count} kind="narrow">
          {/* Library always shows a single face-down stack regardless of viewer. */}
          {player.library_count > 0 && (
            <div className="card face-down stack-of-many" aria-label="Library">
              <div className="card-back" />
            </div>
          )}
          {isOwner && (
            <div className="zone-actions">
              <button type="button" onClick={handleDraw}>Draw</button>
              <button type="button" onClick={handleMill}>Mill</button>
              <button type="button" onClick={handleShuffle}>Shuffle</button>
            </div>
          )}
        </Zone>

        <Zone label="Graveyard" count={graveyard.length} kind="narrow">
          {graveyard.map((c) => (
            <Card key={c.id} card={c} isOwner={isOwner} />
          ))}
        </Zone>

        <Zone label="Exile" count={exile.length} kind="narrow">
          {exile.map((c) => (
            <Card key={c.id} card={c} isOwner={isOwner} />
          ))}
        </Zone>
      </div>
    </section>
  );
}

type ZoneKind = 'narrow' | 'wide' | 'widest';

function Zone({
  label,
  count,
  kind = 'narrow',
  children,
}: {
  label: string;
  count: number;
  kind?: ZoneKind;
  children: React.ReactNode;
}) {
  return (
    <div className={`zone zone--${kind}`}>
      <div className="zone-label">
        {label}
        {count > 0 && <span className="zone-count">{count}</span>}
      </div>
      <div className="zone-cards">{children}</div>
    </div>
  );
}
