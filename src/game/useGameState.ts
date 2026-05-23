// useGameState — the live snapshot of the game, kept fresh by Supabase Realtime.
//
// On mount:
//   1. Fetch the full current state (game row, players, cards).
//   2. Subscribe to Realtime changes on the three tables, filtered by game_id.
//   3. Apply each row change to local state so every browser stays in sync.
//
// On unmount: tear the channel down so we don't leak subscriptions.
//
// Reliability note (Phase 1 acceptance):
//   The database is the source of truth. If a player disconnects, when
//   they reconnect this hook re-runs the initial fetch and re-subscribes
//   — they get the current correct board. There is no per-browser
//   "authoritative" copy that could drift.

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Game, GameCard, GamePlayer, GameState } from '../lib/types';

interface UseGameStateResult {
  state: GameState | null;
  error: string | null;
  loading: boolean;
}

export function useGameState(gameId: string | null): UseGameStateResult {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Keep the latest state in a ref so realtime handlers can read it
  // without re-subscribing every render.
  const stateRef = useRef<GameState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    if (!gameId) {
      setState(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // ---- Initial fetch: get everything we can see right now. ----
        const [{ data: game, error: gErr }, { data: players, error: pErr }, { data: cards, error: cErr }] =
          await Promise.all([
            supabase.from('games').select('*').eq('id', gameId).single(),
            supabase
              .from('game_players')
              .select('*')
              .eq('game_id', gameId)
              .order('seat_number', { ascending: true }),
            // RLS filters this: we see shared zones for everyone, and
            // our own hand/library; we never see opponents' hidden zones.
            supabase.from('game_cards').select('*').eq('game_id', gameId),
          ]);
        if (gErr) throw gErr;
        if (pErr) throw pErr;
        if (cErr) throw cErr;
        if (cancelled) return;

        setState({
          game: game as Game,
          players: (players ?? []) as GamePlayer[],
          cards: (cards ?? []) as GameCard[],
        });

        // ---- Subscribe to realtime changes. ----
        // One channel per game; three table subscriptions on it.
        channel = supabase
          .channel(`game-${gameId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
            (payload) => applyGameChange(payload, setState, stateRef)
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'game_players',
              filter: `game_id=eq.${gameId}`,
            },
            (payload) => applyPlayerChange(payload, setState, stateRef)
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'game_cards',
              filter: `game_id=eq.${gameId}`,
            },
            (payload) => applyCardChange(payload, setState, stateRef)
          )
          .subscribe();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [gameId]);

  return { state, error, loading };
}

// ---- Reducer-ish handlers ----
// Each takes a Realtime payload and patches the cached GameState.
// We use setState(prev => …) so React batches correctly.

type Setter = React.Dispatch<React.SetStateAction<GameState | null>>;
type StateRef = React.MutableRefObject<GameState | null>;

function applyGameChange(payload: any, setState: Setter, _ref: StateRef) {
  setState((prev) => {
    if (!prev) return prev;
    if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
      return { ...prev, game: { ...prev.game, ...(payload.new as Game) } };
    }
    return prev;
  });
}

function applyPlayerChange(payload: any, setState: Setter, _ref: StateRef) {
  setState((prev) => {
    if (!prev) return prev;
    const row = (payload.new ?? payload.old) as GamePlayer;
    if (payload.eventType === 'DELETE') {
      return { ...prev, players: prev.players.filter((p) => p.id !== row.id) };
    }
    const exists = prev.players.some((p) => p.id === row.id);
    const next = exists
      ? prev.players.map((p) => (p.id === row.id ? (payload.new as GamePlayer) : p))
      : [...prev.players, payload.new as GamePlayer];
    next.sort((a, b) => a.seat_number - b.seat_number);
    return { ...prev, players: next };
  });
}

function applyCardChange(payload: any, setState: Setter, _ref: StateRef) {
  setState((prev) => {
    if (!prev) return prev;
    if (payload.eventType === 'DELETE') {
      const old = payload.old as GameCard;
      return { ...prev, cards: prev.cards.filter((c) => c.id !== old.id) };
    }
    const row = payload.new as GameCard;
    const exists = prev.cards.some((c) => c.id === row.id);
    const next = exists
      ? prev.cards.map((c) => (c.id === row.id ? row : c))
      : [...prev.cards, row];
    return { ...prev, cards: next };
  });
}
