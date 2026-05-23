// Top-level component. Three states:
//   1. Logged out -> <AuthForm />
//   2. Logged in, no game selected -> <Lobby />
//   3. Logged in, in a game -> <GameTable />
//
// We deliberately don't use a router yet — three states gated by simple
// state variables is much easier to follow for a learner, and Phase 1
// doesn't need URL-based routing. Adding it later is straightforward.

import { useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AuthForm } from './auth/AuthForm';
import { Lobby } from './lobby/Lobby';
import { GameTable } from './game/GameTable';

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  const [activeGameId, setActiveGameId] = useState<string | null>(null);

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

  if (activeGameId) {
    return <GameTable gameId={activeGameId} onLeave={() => setActiveGameId(null)} />;
  }

  return <Lobby onJoined={setActiveGameId} />;
}
