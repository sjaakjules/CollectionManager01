/**
 * Guest seed decks
 *
 * Loads pre-downloaded decks from a bundled static asset and merges them into
 * guest user data exactly once. Seed decks carry deterministic ids
 * (`curiosa-<curiosaDeckId>`, produced by `scripts/build-guest-seed-decks.mjs`),
 * so re-running startup never duplicates them and never overwrites local edits
 * made to a previously seeded deck.
 *
 * Related files:
 * - `scripts/build-guest-seed-decks.mjs` (generates the asset)
 * - `src/app/Startup.ts` (applies seeds during guest hydration)
 */

import type { Deck, DeckBoards, UserData } from './dataModels';

export const GUEST_SEED_ASSET_URL = '/assets/guest_seed_decks.json';

const BOARD_KEYS: (keyof DeckBoards)[] = [
  'mainboard',
  'sideboard',
  'avatar',
  'maybeboard',
];

function isDeckLike(value: unknown): value is Deck {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) return false;
  if (typeof record.name !== 'string' || !record.name) return false;
  const boards = record.boards as Record<string, unknown> | undefined;
  if (!boards || typeof boards !== 'object') return false;
  return BOARD_KEYS.every((key) => Array.isArray(boards[key]));
}

/**
 * Fetch the bundled seed deck asset.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - Resolves to valid seed `Deck[]`; empty when the asset is missing/invalid
 *   (seeding is optional and must never block startup).
 */
export async function fetchGuestSeedDecks(): Promise<Deck[]> {
  try {
    const response = await fetch(GUEST_SEED_ASSET_URL);
    if (!response.ok) return [];
    const payload = (await response.json()) as unknown;
    const decks =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>).decks
        : null;
    if (!Array.isArray(decks)) return [];
    return decks.filter(isDeckLike);
  } catch {
    return [];
  }
}

/**
 * Merge seed decks into user data, skipping already-present deck ids.
 *
 * Inputs:
 * - `userData`: Current user snapshot.
 * - `seedDecks`: Candidate decks from the seed asset.
 *
 * Outputs:
 * - Returns `{ userData, addedDeckNames }`. When nothing new is added the
 *   original `userData` reference is returned unchanged.
 */
export function mergeSeedDecks(
  userData: UserData,
  seedDecks: Deck[]
): { userData: UserData; addedDeckNames: string[] } {
  const existingIds = new Set(userData.decks.map((deck) => deck.id));
  const newDecks = seedDecks.filter((deck) => !existingIds.has(deck.id));

  if (newDecks.length === 0) {
    return { userData, addedDeckNames: [] };
  }

  return {
    userData: {
      ...userData,
      decks: [...userData.decks, ...newDecks],
    },
    addedDeckNames: newDecks.map((deck) => deck.name),
  };
}
