// The battlefield zone — three horizontal rows matching a physical
// Commander playmat:
//
//   1. Creatures + Planeswalkers (top)
//   2. Artifacts + Enchantments (middle)
//   3. Lands (bottom)
//
// Cards are bucketed by their type_line. Tokens get a synthetic
// type_line at creation time (see gameActions.createToken). Legacy
// rows from before migration 0007 carry NULL type_line; the cardCache
// fills them in lazily on mount.

import { useEffect, useState } from 'react';
import type { GameCard } from '../lib/types';
import {
  fetchCardData,
  getCachedCardData,
} from '../lib/cardCache';
import { Card } from './Card';
import type { TokenCategory } from './gameActions';

type Row = 'creatures' | 'artifacts' | 'lands';

interface BattlefieldProps {
  cards: GameCard[];
  isOwner: boolean;
  onCreateToken?: (name: string, category: TokenCategory) => Promise<void>;
}

function bucketFromTypeLine(typeLine: string | null | undefined): Row {
  if (!typeLine) return 'creatures'; // safe default until cache fills
  const t = typeLine.toLowerCase();
  if (t.includes('land')) return 'lands';
  // Artifact creatures / enchantment creatures bucket as creatures.
  if (t.includes('creature') || t.includes('planeswalker')) return 'creatures';
  if (t.includes('artifact') || t.includes('enchantment')) return 'artifacts';
  return 'creatures';
}

export function Battlefield({ cards, isOwner, onCreateToken }: BattlefieldProps) {
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [tokenName, setTokenName] = useState('1/1 Soldier');
  const [tokenCategory, setTokenCategory] = useState<TokenCategory>('creature');
  // Re-render trigger when the cardCache fills new entries.
  const [, setCacheTick] = useState(0);

  // For any card missing type_line that has a scryfall_id, kick off a
  // lazy fetch. Once it lands in the cache, force a re-render so the
  // card moves into the right bucket.
  useEffect(() => {
    const missing = cards.filter(
      (c) => !c.type_line && c.scryfall_id && !getCachedCardData(c.scryfall_id)
    );
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((c) =>
        fetchCardData(c.scryfall_id!).catch(() => null)
      )
    ).then(() => {
      if (!cancelled) setCacheTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [cards]);

  // Bucket every card. We read from the cache as a fallback when the
  // DB row's type_line is null.
  function bucket(card: GameCard): Row {
    if (card.type_line) return bucketFromTypeLine(card.type_line);
    if (card.scryfall_id) {
      const cached = getCachedCardData(card.scryfall_id);
      if (cached) return bucketFromTypeLine(cached.type_line);
    }
    return 'creatures';
  }

  const creatures: GameCard[] = [];
  const artifacts: GameCard[] = [];
  const lands: GameCard[] = [];
  for (const c of cards) {
    const row = bucket(c);
    (row === 'creatures' ? creatures : row === 'artifacts' ? artifacts : lands).push(c);
  }

  async function handleCreate() {
    if (!onCreateToken) return;
    await onCreateToken(tokenName, tokenCategory);
    setShowTokenInput(false);
  }

  return (
    <div className="battlefield-rows">
      <BattlefieldRow label="Creatures · Planeswalkers" cards={creatures} isOwner={isOwner} />
      <BattlefieldRow label="Artifacts · Enchantments" cards={artifacts} isOwner={isOwner} />
      <BattlefieldRow label="Lands" cards={lands} isOwner={isOwner} />

      {isOwner && onCreateToken && !showTokenInput && (
        <button
          type="button"
          className="ghost"
          onClick={() => setShowTokenInput(true)}
        >
          + Token
        </button>
      )}
      {isOwner && onCreateToken && showTokenInput && (
        <div className="token-input">
          <div className="token-category">
            {(['creature', 'artifact', 'enchantment', 'land'] as TokenCategory[]).map(
              (cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`token-category-btn ${
                    tokenCategory === cat ? 'active' : ''
                  }`}
                  onClick={() => setTokenCategory(cat)}
                >
                  {cat[0]!.toUpperCase() + cat.slice(1)}
                </button>
              )
            )}
          </div>
          <input
            type="text"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder='e.g. "1/1 Soldier"'
          />
          <button type="button" onClick={handleCreate}>
            Create
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setShowTokenInput(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function BattlefieldRow({
  label,
  cards,
  isOwner,
}: {
  label: string;
  cards: GameCard[];
  isOwner: boolean;
}) {
  return (
    <div className="battlefield-row">
      <div className="battlefield-row-label">
        {label}
        {cards.length > 0 && (
          <span className="battlefield-row-count">{cards.length}</span>
        )}
      </div>
      <div className="battlefield-row-cards">
        {cards.map((c) => (
          <Card key={c.id} card={c} isOwner={isOwner} />
        ))}
      </div>
    </div>
  );
}
