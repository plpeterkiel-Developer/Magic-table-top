// Autocomplete card search. Used by the deck builder.
//
// Typing in the box hits Scryfall's /cards/autocomplete with a small
// debounce. Selecting a suggestion calls /cards/named to fetch the
// full card and reports it via onPick.

import { useEffect, useRef, useState } from 'react';
import {
  autocompleteNames,
  getCardByExactName,
  type ScryfallCard,
} from '../lib/scryfall';

interface CardSearchProps {
  onPick: (card: ScryfallCard) => void | Promise<void>;
  disabled?: boolean;
}

const DEBOUNCE_MS = 200;

export function CardSearch({ onPick, disabled }: CardSearchProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cancel stale fetches if the user keeps typing.
  const requestId = useRef(0);

  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const id = ++requestId.current;
    const t = setTimeout(async () => {
      try {
        const names = await autocompleteNames(query);
        if (id !== requestId.current) return; // stale
        setSuggestions(names);
        setActiveIndex(names.length > 0 ? 0 : -1);
      } catch {
        // Autocomplete failures are silent — the user can still hit Enter.
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  async function pick(name: string) {
    setError(null);
    setBusy(true);
    try {
      const card = await getCardByExactName(name);
      await onPick(card);
      setQuery('');
      setSuggestions([]);
      setActiveIndex(-1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen =
        activeIndex >= 0 ? suggestions[activeIndex] : query.trim();
      if (chosen) pick(chosen);
    } else if (e.key === 'Escape') {
      setSuggestions([]);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="card-search">
      <input
        type="text"
        value={query}
        placeholder="Search Scryfall (e.g. Lightning Bolt)"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled || busy}
        autoCorrect="off"
        spellCheck={false}
      />
      {suggestions.length > 0 && (
        <ul className="card-search-suggestions">
          {suggestions.map((name, i) => (
            <li
              key={name}
              className={i === activeIndex ? 'active' : ''}
              onMouseDown={(e) => {
                // mousedown so we fire before the input blurs.
                e.preventDefault();
                pick(name);
              }}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
      {busy && <div className="muted">Adding…</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
