// List the user's saved decks. Lets them create a new deck, open one
// in the builder, or delete one.

import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { createDeck, deleteDeck, listMyDecks } from './deckActions';
import type { Deck } from './types';

interface DeckListProps {
  onOpenDeck: (deckId: string) => void;
  onBack: () => void;
}

export function DeckList({ onOpenDeck, onBack }: DeckListProps) {
  const { user } = useAuth();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listMyDecks(user.id)
      .then((d) => {
        if (!cancelled) setDecks(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleCreate() {
    if (!user) return;
    const name = newName.trim();
    if (!name) {
      setError('Give the deck a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const deck = await createDeck(user.id, name);
      setDecks((cur) => [deck, ...(cur ?? [])]);
      setNewName('');
      onOpenDeck(deck.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(deck: Deck) {
    const ok = window.confirm(`Delete "${deck.name}"? This can't be undone.`);
    if (!ok) return;
    setError(null);
    try {
      await deleteDeck(deck.id);
      setDecks((cur) => (cur ?? []).filter((d) => d.id !== deck.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="decks-page">
      <header className="topbar">
        <button type="button" className="ghost" onClick={onBack}>
          ← Back to lobby
        </button>
        <strong>My Decks</strong>
      </header>

      <main className="decks-main">
        <section className="card">
          <h2>Start a new deck</h2>
          <label className="field">
            <span>Deck name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Krenko Goblins"
            />
          </label>
          <button
            type="button"
            className="primary"
            onClick={handleCreate}
            disabled={busy}
          >
            {busy ? 'Creating…' : 'Create deck'}
          </button>
        </section>

        <section className="card">
          <h2>Saved decks</h2>
          {decks === null && <p className="muted">Loading…</p>}
          {decks && decks.length === 0 && (
            <p className="muted">No decks yet. Create one to get started.</p>
          )}
          {decks && decks.length > 0 && (
            <ul className="deck-list">
              {decks.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="link"
                    onClick={() => onOpenDeck(d.id)}
                  >
                    {d.name}
                  </button>
                  <button
                    type="button"
                    className="ghost danger-link"
                    onClick={() => handleDelete(d)}
                    aria-label={`Delete ${d.name}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <div className="error full">{error}</div>}
      </main>
    </div>
  );
}
