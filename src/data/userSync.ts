/**
 * User data synchronization with backend
 *
 * Handles syncing local changes to the server when logged in.
 * Implements debounced saves to avoid excessive API calls.
 *
 * Related files:
 * - `src/app/App.tsx` (auto-save and unload flush hooks)
 * - `src/auth/api.ts` (remote fetch/update endpoints)
 * - `src/data/userStorage.ts` (local persistence fallback)
 */

import type { UserData, CanvasLabel } from './dataModels';
import { fetchUserData, updateUserData } from '@/auth/api';
import { saveUserData } from './userStorage';
import { debounce } from '@/utils/debounce';

// Debounce delay for auto-save (ms)
const SYNC_DEBOUNCE_MS = 2000;

let pendingSync: UserData | null = null;
let syncInProgress = false;

/**
 * Queue user data for debounced backend sync.
 *
 * Inputs:
 * - `userData`: Full user data snapshot to sync.
 * - `token`: Auth token used for API authorization.
 *
 * Outputs:
 * - Schedules sync work and returns immediately (`void`).
 */
export const queueSync = debounce(async (userData: UserData, token: string) => {
  if (syncInProgress) {
    pendingSync = userData;
    return;
  }

  await performSync(userData, token);
}, SYNC_DEBOUNCE_MS);

/**
 * Fetch latest user data from backend and mirror it locally.
 *
 * Inputs:
 * - `userId`: Authenticated user id.
 * - `token`: Auth token used for API authorization.
 *
 * Outputs:
 * - Resolves to server `UserData` when available; returns `null` on failure.
 */
export async function pullUserData(
  userId: string,
  token: string
): Promise<UserData | null> {
  try {
    const serverData = await fetchUserData(userId, token);
    if (serverData) {
      await saveUserData(serverData);
    }
    return serverData;
  } catch (error) {
    console.error('Failed to pull user data:', error);
    return null;
  }
}

/**
 * Force immediate sync, bypassing debounce queue.
 *
 * Inputs:
 * - `userData`: User data snapshot to persist remotely.
 * - `token`: Auth token used for API authorization.
 *
 * Outputs:
 * - Resolves when the sync attempt completes.
 */
export async function flushSync(userData: UserData, token: string): Promise<void> {
  queueSync.cancel();
  await performSync(userData, token);
}

async function performSync(userData: UserData, token: string): Promise<void> {
  syncInProgress = true;

  try {
    await updateUserData(userData.id, userData, token);
    console.log('User data synced to server');
  } catch (error) {
    console.error('Failed to sync user data:', error);
    // Data is still saved locally, will retry on next change
  } finally {
    syncInProgress = false;

    // Process any pending sync that arrived during the operation
    if (pendingSync) {
      const pending = pendingSync;
      pendingSync = null;
      await performSync(pending, token);
    }
  }
}

/**
 * Merge local guest data with server user data.
 * Server data takes precedence for deck conflicts; additive data is preserved.
 *
 * Inputs:
 * - `local`: Local/offline user snapshot.
 * - `server`: Server-authoritative user snapshot.
 *
 * Outputs:
 * - Returns merged `UserData` preserving server precedence where conflicts exist.
 */
export function mergeUserData(local: UserData, server: UserData): UserData {
  // Simple merge strategy: keep all decks, dedupe by ID
  const deckMap = new Map<string, UserData['decks'][0]>();

  // Add server decks first (they take precedence)
  for (const deck of server.decks) {
    deckMap.set(deck.id, deck);
  }

  // Add local decks that don't exist on server
  for (const deck of local.decks) {
    if (!deckMap.has(deck.id)) {
      deckMap.set(deck.id, deck);
    }
  }

  // Merge collections - sum quantities for same cards
  const collectionMap = new Map<string, number>();
  for (const item of server.collection) {
    collectionMap.set(item.name, item.quantity);
  }
  for (const item of local.collection) {
    collectionMap.set(item.name, (collectionMap.get(item.name) ?? 0) + item.quantity);
  }

  const labelsById = new Map<string, CanvasLabel>();
  for (const label of server.canvasLabels ?? []) {
    labelsById.set(label.id, label);
  }
  for (const label of local.canvasLabels ?? []) {
    if (!labelsById.has(label.id)) {
      labelsById.set(label.id, label);
    }
  }

  const canvasAreasById = new Map<
    string,
    NonNullable<UserData['canvasAreas']>[number]
  >();
  for (const area of server.canvasAreas ?? []) {
    canvasAreasById.set(area.id, area);
  }
  for (const area of local.canvasAreas ?? []) {
    if (!canvasAreasById.has(area.id)) {
      canvasAreasById.set(area.id, area);
    }
  }

  return {
    name: server.name,
    id: server.id,
    decks: Array.from(deckMap.values()),
    collection: Array.from(collectionMap.entries()).map(([name, quantity]) => ({
      name,
      quantity,
    })),
    selectedArchetype:
      server.selectedArchetype ?? local.selectedArchetype ?? null,
    archetypeScores: server.archetypeScores ?? local.archetypeScores,
    canvasLabels: Array.from(labelsById.values()),
    canvasAreas: Array.from(canvasAreasById.values()),
  };
}
