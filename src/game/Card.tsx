// One card on the table. Renders the Scryfall image when we have one
// (Phase 2), otherwise a coloured placeholder (Phase 1 / tokens).
// Clicking the card opens a small menu of moves.
// Hovering (desktop) or pressing-and-holding (mobile) shows an
// oracle-text overlay above the card.
//
// We use click-to-act, not drag-and-drop, because click is much easier
// to make reliable across desktop and mobile.
import { useEffect, useRef, useState } from 'react';
import type { GameCard, Zone } from '../lib/types';
import { ALL_ZONES } from '../lib/types';
import { moveCard, setTapped, deleteToken } from './gameActions';
import { fetchOracleText, getCachedOracleText } from '../lib/oracleCache';

interface CardProps {
  card: GameCard;
  // True if the viewer is the owner — they get the action menu.
  isOwner: boolean;
  // True for the player's own hand: face-up. For opponents' hands
  // we don't render Card components at all — only a count.
  faceDown?: boolean;
}

// Fallback colour for cards without a Scryfall image (tokens, or
// the legacy test decks that never set image_url).
const HINT_COLOURS: Record<string, string> = {
  white: '#f3ecd0',
  blue: '#94c5ec',
  black: '#5a5560',
  red: '#e08272',
  green: '#7eb38a',
  colorless: '#b9b9b9',
};

function placeholderColour(name: string): string {
  const lower = name.toLowerCase();
  if (
    lower.includes('mountain') ||
    lower.includes('bolt') ||
    lower.includes('goblin') ||
    lower.includes('krenko')
  )
    return HINT_COLOURS.red!;
  if (
    lower.includes('island') ||
    lower.includes('counter') ||
    lower.includes('brainstorm') ||
    lower.includes('talrand')
  )
    return HINT_COLOURS.blue!;
  return HINT_COLOURS.colorless!;
}

// Long-press threshold for mobile (touchstart hold).
const LONG_PRESS_MS = 400;

export function Card({ card, isOwner, faceDown = false }: CardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // hover is tracked in React (rather than CSS :hover) so we can
  // compute viewport-aware overlay placement and reuse the same code
  // path for mobile long-press.
  const [hovering, setHovering] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  // Local snapshot of oracle text once we've fetched it from Scryfall.
  // Starts as whatever the DB row already has.
  const [oracle, setOracle] = useState<string | null>(card.oracle_text);
  const [oracleLoading, setOracleLoading] = useState(false);
  // Position of the overlay (computed from the card's bounding rect).
  const [overlayPos, setOverlayPos] = useState<{ left: number; top: number } | null>(null);

  const pressTimer = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const classNames = ['card'];
  if (card.tapped) classNames.push('tapped');
  if (faceDown) classNames.push('face-down');
  if (card.is_token) classNames.push('token');
  if (!isOwner) classNames.push('opponent');
  if (card.image_url && !faceDown) classNames.push('has-art');
  if (previewing) classNames.push('previewing');

  // If oracle_text wasn't on the DB row but we have a scryfall_id,
  // pull it on the first hover/press. Cached for the rest of the
  // session by oracleCache. Cards without scryfall_id (tokens, the
  // legacy test decks) just skip this.
  function ensureOracle() {
    if (faceDown) return;
    if (oracle !== null || oracleLoading) return;
    if (!card.scryfall_id) return;
    const cached = getCachedOracleText(card.scryfall_id);
    if (cached !== undefined) {
      setOracle(cached);
      return;
    }
    setOracleLoading(true);
    fetchOracleText(card.scryfall_id)
      .then((txt) => setOracle(txt))
      .catch(() => setOracle('')) // silent fail: empty overlay body
      .finally(() => setOracleLoading(false));
  }

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

  // Compute overlay placement relative to the card so it never gets
  // clipped by the viewport. Prefers above-the-card; falls back to
  // below or sideways depending on available space.
  function positionOverlay() {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const OVERLAY_W = 280;
    const OVERLAY_H_ESTIMATE = 140;
    const GAP = 8;

    // Horizontal: centred on the card, then clamped into the viewport.
    let left = rect.left + rect.width / 2 - OVERLAY_W / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - OVERLAY_W - 8));

    // Vertical: prefer above the card; if not enough room, drop below.
    let top = rect.top - OVERLAY_H_ESTIMATE - GAP;
    if (top < 8) top = rect.bottom + GAP;

    setOverlayPos({ left, top });
  }

  // Desktop hover: set state, position the overlay, kick off lazy fetch.
  function handleMouseEnter() {
    if (faceDown) return;
    setHovering(true);
    positionOverlay();
    ensureOracle();
  }
  function handleMouseLeave() {
    setHovering(false);
  }

  // Mobile: long-press to preview. Tap (short press) still goes through
  // to onClick afterwards for the menu.
  function handleTouchStart() {
    if (faceDown) return;
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      positionOverlay();
      setPreviewing(true);
      ensureOracle();
    }, LONG_PRESS_MS);
  }
  function clearLongPress() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    setPreviewing(false);
  }

  useEffect(() => {
    return () => {
      if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    };
  }, []);

  // Overlay is visible when the user is hovering (desktop) or has
  // long-pressed (mobile). Skip face-down cards.
  const overlayVisible =
    !faceDown && (hovering || previewing) && overlayPos !== null;

  return (
    <div
      ref={cardRef}
      className={classNames.join(' ')}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchEnd={clearLongPress}
      onTouchCancel={clearLongPress}
      onTouchMove={clearLongPress}
    >
      {faceDown ? (
        <div className="card-back" />
      ) : card.image_url ? (
        <img
          className="card-art"
          src={card.image_url}
          alt={card.name}
          loading="lazy"
          draggable={false}
        />
      ) : (
        <div
          className="card-face"
          style={{ background: placeholderColour(card.name) }}
        >
          <div className="card-name">{card.name}</div>
          {card.is_token && <div className="card-tag">TOKEN</div>}
        </div>
      )}

      {overlayVisible && overlayPos && (
        <div
          className="card-oracle-overlay"
          role="tooltip"
          style={{ left: overlayPos.left, top: overlayPos.top }}
        >
          <div className="card-oracle-overlay-title">
            <span>{card.name}</span>
          </div>
          <div className="card-oracle-overlay-body">
            {oracleLoading && oracle === null ? (
              <span className="card-oracle-overlay-loading">Loading…</span>
            ) : oracle && oracle.length > 0 ? (
              oracle
            ) : (
              <span className="card-oracle-overlay-loading">
                No oracle text available.
              </span>
            )}
          </div>
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
