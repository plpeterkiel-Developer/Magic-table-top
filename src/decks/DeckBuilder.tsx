// Edit one deck: rename, add/remove cards, set commander, import a
// pasted decklist, quick-add basic lands.
//
// No Magic-rules enforcement: deck size, color identity, and singleton
// are NOT checked. The app is a tabletop, not a rules engine.

import { useEffect, useState } from 'react';
import {
  parseDecklist,
  getCardsByNamesBatch,
  getCardByExactName,
  type ScryfallCard,
} from '../lib/scryfall';
import {
  addCardToDeck,
  addCardsBulk,
  loadDeckWithCards,
  removeCardFromDeck,
  renameDeck,
  setCardQuantity,
  setCommander,
} from './deckActions';
import type { DeckWithCards, DeckCard } from './types';
import { CardSearch } from './CardSearch';

interface DeckBuilderProps {
  deckId: string;
  onBack: () => void;
}

const BASIC_LANDS = [
  'Plains',
  'Island',
  'Swamp',
  'Mountain',
  'Forest',
  'Wastes',
] as const;

export function DeckBuilder({ deckId, onBack }: DeckBuilderProps) {
  const [state, setState] = useState<DeckWithCards | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Import textarea + report
  const [paste, setPaste] = useState('');
  const [importReport, setImportReport] = useState<{
    added: number;
    notFound: string[];
  } | null>(null);

  // Initial load + reload helper.
  async function reload() {
    setError(null);
    try {
      const next = await loadDeckWithCards(deckId);
      setState(next);
      setNameDraft(next.deck.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId]);

  // ---- handlers ---------------------------------------------------

  async function handleRenameSave() {
    if (!state) return;
    const name = nameDraft.trim();
    if (!name || name === state.deck.name) {
      setRenaming(false);
      return;
    }
    try {
      await renameDeck(deckId, name);
      setState({ ...state, deck: { ...state.deck, name } });
      setRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddOne(card: ScryfallCard) {
    setError(null);
    try {
      await addCardToDeck(deckId, card);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleQty(card: DeckCard, delta: number) {
    const next = card.quantity + delta;
    try {
      await setCardQuantity(card.id, next);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemove(card: DeckCard) {
    try {
      await removeCardFromDeck(card.id);
      if (state?.deck.commander_card_id === card.id) {
        await setCommander(deckId, null);
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSetCommander(card: DeckCard) {
    const next = state?.deck.commander_card_id === card.id ? null : card.id;
    try {
      await setCommander(deckId, next);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddBasic(name: string) {
    setError(null);
    setBusy(true);
    try {
      const card = await getCardByExactName(name);
      await addCardToDeck(deckId, card);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    setError(null);
    setImportReport(null);
    const rows = parseDecklist(paste);
    if (rows.length === 0) {
      setError('No card lines found.');
      return;
    }
    setBusy(true);
    try {
      const { found, notFound } = await getCardsByNamesBatch(rows.map((r) => r.name));
      const byName = new Map(found.map((c) => [c.name.toLowerCase(), c]));
      const matched: { card: ScryfallCard; quantity: number }[] = [];
      const stillMissing: string[] = [...notFound];
      for (const row of rows) {
        const c = byName.get(row.name.toLowerCase());
        if (c) matched.push({ card: c, quantity: row.quantity });
        else if (!notFound.includes(row.name)) stillMissing.push(row.name);
      }
      await addCardsBulk(deckId, matched);
      await reload();
      setImportReport({ added: matched.length, notFound: stillMissing });
      setPaste('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // ---- render ------------------------------------------------------

  if (!state) {
    return (
      <div className="centered">
        <p>{error ?? 'Loading deck…'}</p>
      </div>
    );
  }

  const totalCards = state.cards.reduce((sum, c) => sum + c.quantity, 0);
  const commanderId = state.deck.commander_card_id;

  return (
    <div className="deck-builder">
      <header className="topbar">
        <button type="button" className="ghost" onClick={onBack}>
          ← Back
        </button>
        {renaming ? (
          <input
            type="text"
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleRenameSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSave();
              if (e.key === 'Escape') {
                setNameDraft(state.deck.name);
                setRenaming(false);
              }
            }}
            style={{ maxWidth: 280 }}
          />
        ) : (
          <strong
            className="deck-title"
            onClick={() => setRenaming(true)}
            title="Click to rename"
          >
            {state.deck.name}
          </strong>
        )}
        <span className="muted">
          {totalCards} card{totalCards === 1 ? '' : 's'}
        </span>
      </header>

      <main className="deck-builder-grid">
        <section className="card">
          <h2>Add a card</h2>
          <CardSearch onPick={handleAddOne} disabled={busy} />
        </section>

        <section className="card">
          <h2>Basic lands</h2>
          <div className="basics-row">
            {BASIC_LANDS.map((name) => (
              <button
                key={name}
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => handleAddBasic(name)}
              >
                + {name}
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Paste a decklist</h2>
          <p className="muted">
            One card per line, optional quantity prefix. Set codes and
            collector numbers are ignored. Semicolons also work as
            separators if newlines get lost in your clipboard.
          </p>
          <pre className="paste-example">
{`1 Sol Ring
1 Arcane Signet
20 Mountain
1 Krenko, Mob Boss
4x Lightning Bolt
1 Counterspell (C21) 123`}
          </pre>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={'1 Sol Ring\n1 Arcane Signet\n20 Mountain\n…'}
            rows={6}
            disabled={busy}
          />
          <button
            type="button"
            className="primary"
            onClick={handleImport}
            disabled={busy || paste.trim().length === 0}
          >
            {busy ? 'Importing…' : 'Import list'}
          </button>
          {importReport && (
            <div className={importReport.notFound.length > 0 ? 'error' : 'info'}>
              Added/merged {importReport.added} card row
              {importReport.added === 1 ? '' : 's'}.
              {importReport.notFound.length > 0 && (
                <>
                  {' '}
                  Could not resolve:{' '}
                  <strong>{importReport.notFound.join(', ')}</strong>.
                </>
              )}
            </div>
          )}
        </section>

        <section className="card full">
          <h2>Cards in deck</h2>
          {state.cards.length === 0 ? (
            <p className="muted">Empty. Add cards above to get started.</p>
          ) : (
            <ul className="deck-card-list">
              {state.cards.map((c) => {
                const isCommander = c.id === commanderId;
                return (
                  <li key={c.id} className={isCommander ? 'is-commander' : ''}>
                    {c.image_url ? (
                      <img
                        className="deck-card-thumb"
                        src={c.image_url}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="deck-card-thumb deck-card-thumb-placeholder" />
                    )}
                    <div className="deck-card-meta">
                      <div className="deck-card-name">
                        <span className="deck-card-name-text">{c.name}</span>
                        {c.mana_cost && (
                          <span className="mana-cost">{c.mana_cost}</span>
                        )}
                        {isCommander && (
                          <span className="badge">Commander</span>
                        )}
                      </div>
                      {c.type_line && (
                        <div className="muted">{c.type_line}</div>
                      )}
                    </div>
                    <div className="deck-card-qty">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleQty(c, -1)}
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span>{c.quantity}</span>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleQty(c, +1)}
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                    <div className="deck-card-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleSetCommander(c)}
                      >
                        {isCommander ? 'Unset commander' : 'Set commander'}
                      </button>
                      <button
                        type="button"
                        className="ghost danger-link"
                        onClick={() => handleRemove(c)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {error && <div className="error full">{error}</div>}
      </main>
    </div>
  );
}
