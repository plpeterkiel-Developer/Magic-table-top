// Top-level component. Four views:
//   1. Logged out -> <AuthForm />
//   2. Logged in, lobby -> <Lobby />
//   3. Logged in, browsing decks -> <DeckList />
//   4. Logged in, editing one deck -> <DeckBuilder />
//   5. Logged in, in a game -> <GameTable />
//
// We deliberately don't use a router yet — a small view state machine
// is much easier to follow for a learner, and these screens have no
// reason to be deep-linkable. Adding react-router later is straightforward.

import { useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AuthForm } from './auth/AuthForm';
import { Lobby } from './lobby/Lobby';
import { GameTable } from './game/GameTable';
import { DeckList } from './decks/DeckList';
import { DeckBuilder } from './decks/DeckBuilder';

type View =
  | { kind: 'lobby' }
  | { kind: 'decks' }
  | { kind: 'deck-builder'; deckId: string }
  | { kind: 'game'; gameId: string };

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  const [view, setView] = useState<View>({ kind: 'lobby' });

  if (loading) {
    return (
      <div className="centered">
        <p>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="centered">
        <AuthForm />
      </div>
    );
  }

  switch (view.kind) {
    case 'game':
      return (
        <GameTable
          gameId={view.gameId}
          onLeave={() => setView({ kind: 'lobby' })}
        />
      );
    case 'decks':
      return (
        <DeckList
          onOpenDeck={(deckId) => setView({ kind: 'deck-builder', deckId })}
          onBack={() => setView({ kind: 'lobby' })}
        />
      );
    case 'deck-builder':
      return (
        <DeckBuilder
          deckId={view.deckId}
          onBack={() => setView({ kind: 'decks' })}
        />
      );
    case 'lobby':
    default:
      return (
        <Lobby
          onJoined={(gameId) => setView({ kind: 'game', gameId })}
          onOpenDecks={() => setView({ kind: 'decks' })}
        />
      );
  }
}
