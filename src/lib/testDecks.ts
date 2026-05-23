// Phase 1 uses HARDCODED test decks so the build is not blocked on
// Scryfall integration. Phase 2 replaces this with real deck building.
//
// Each deck has a commander (goes to command zone) and a list of cards
// (goes to library, shuffled). Card art is just a coloured placeholder
// — we deliberately don't fetch real images yet.
//
// To keep Phase 1 simple, both seats use the same two test decks.

export interface TestCard {
  name: string;
  // Optional: a colour used by the placeholder renderer to make cards
  // distinguishable at a glance.
  hint?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
}

export interface TestDeck {
  id: string;
  name: string;
  commander: TestCard;
  cards: TestCard[]; // becomes the library
}

function spread(name: string, count: number, hint: TestCard['hint']): TestCard[] {
  return Array.from({ length: count }, (_, i) => ({ name: `${name} #${i + 1}`, hint }));
}

export const TEST_DECKS: TestDeck[] = [
  {
    id: 'test-deck-mono-red',
    name: 'Test Deck — Mono-Red',
    commander: { name: 'Krenko, Mob Boss (test)', hint: 'red' },
    cards: [
      ...spread('Mountain', 4, 'red'),
      ...spread('Goblin Guide', 3, 'red'),
      ...spread('Lightning Bolt', 3, 'red'),
    ],
  },
  {
    id: 'test-deck-mono-blue',
    name: 'Test Deck — Mono-Blue',
    commander: { name: 'Talrand, Sky Summoner (test)', hint: 'blue' },
    cards: [
      ...spread('Island', 4, 'blue'),
      ...spread('Brainstorm', 3, 'blue'),
      ...spread('Counterspell', 3, 'blue'),
    ],
  },
];

export function getTestDeck(id: string): TestDeck | undefined {
  return TEST_DECKS.find((d) => d.id === id);
}
