// One card on the table. Renders a coloured placeholder (Phase 1) and
// shows a small menu of moves when clicked.
//
// Phase 1 uses click-to-act, not drag-and-drop, because click is much
// easier to make reliable across desktop and mobile.
import { useState } from 'react';
import type { GameCard, Zone } from '../lib/types';
import { ALL_ZONES } from '../lib/types';
import { moveCard, setTapped, deleteToken } from './gameActions';

interface CardProps {
  card: GameCard;
  // True if the viewer is the owner — they get the action menu.
  isOwner: boolean;
  // True for the player's own hand: face-up. For opponents' hands
  // we don't render Card components at all — only a count.
  faceDown?: boolean;
}

const HINT_COLOURS: Record<string, string> = {
  white: '#f3ecd0',
  blue: '#94c5ec',
  black: '#5a5560',
  red: '#e08272',
  green: '#7eb38a',
  colorless: '#b9b9b9',
};

export function Card({ card, isOwner, faceDown = false }: CardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // A super-cheap "hint" colour derived from the card name so test
  // cards look distinguishable. Phase 2 will use real images.
  const lower = card.name.toLowerCase();
  let hint = 'colorless';
  if (lower.includes('mountain') || lower.includes('bolt') || lower.includes('goblin') || lower.includes('krenko'))
    hint = 'red';
  else if (lower.includes('island') || lower.includes('counter') || lower.includes('brainstorm') || lower.includes('talrand'))
    hint = 'blue';

  const colour = HINT_COLOURS[hint] ?? HINT_COLOURS.colorless;

  const classNames = ['card'];
  if (card.tapped) classNames.push('tapped');
  if (faceDown) classNames.push('face-down');
  if (card.is_token) classNames.push('token');
  if (!isOwner) classNames.push('opponent');

  function handleClick() {
    if (!isOwner) return;
    if (faceDown) return;
    setMenuOpen((o) => !o);
  }

  async function handleMove(zone: Zone) {
    setMenuOpen(false);
    await moveCard(card, zone);
  }

  async function handleTapToggle() {
    setMenuOpen(false);
    await setTapped(card.id, !card.tapped);
  }

  async function handleDeleteToken() {
    setMenuOpen(false);
    await deleteToken(card.id);
  }

  return (
    <div className={classNames.join(' ')} onClick={handleClick}>
      {faceDown ? (
        <div className="card-back" />
      ) : (
        <div className="card-face" style={{ background: colour }}>
          <div className="card-name">{card.name}</div>
          {card.is_token && <div className="card-tag">TOKEN</div>}
        </div>
      )}

      {menuOpen && isOwner && (
        <div className="card-menu" onClick={(e) => e.stopPropagation()}>
          {card.zone === 'battlefield' && (
            <button type="button" onClick={handleTapToggle}>
              {card.tapped ? 'Untap' : 'Tap'}
            </button>
          )}
          {ALL_ZONES.filter((z) => z !== card.zone).map((z) => (
            <button key={z} type="button" onClick={() => handleMove(z)}>
              → {labelForZone(z)}
            </button>
          ))}
          {card.is_token && (
            <button type="button" className="danger" onClick={handleDeleteToken}>
              Delete token
            </button>
          )}
          <button type="button" className="ghost" onClick={() => setMenuOpen(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function labelForZone(z: Zone): string {
  switch (z) {
    case 'library':
      return 'Library';
    case 'hand':
      return 'Hand';
    case 'battlefield':
      return 'Battlefield';
    case 'graveyard':
      return 'Graveyard';
    case 'exile':
      return 'Exile';
    case 'command':
      return 'Command';
  }
}
