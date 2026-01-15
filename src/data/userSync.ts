/**
 * User data synchronization with backend
 *
 * Handles syncing local changes to the server when logged in.
 * Implements debounced saves to avoid excessive API calls.
 */

import type { UserData } from './dataModels';
import { fetchUserData, updateUserData } from '@/auth/api';
import { saveUserData } from './userStorage';
import { debounce } from '@/utils/debounce';

// Debounce delay for auto-save (ms)
const SYNC_DEBOUNCE_MS = 2000;

let pendingSync: UserData | null = null;
let syncInProgress = false;

/**
 * Queue user data for syncing to server
 * Debounced to avoid excessive API calls
 */
export const queueSync = debounce(async (userData: UserData, token: string) => {
  if (syncInProgress) {
    pendingSync = userData;
    return;
  }

  await performSync(userData, token);
}, SYNC_DEBOUNCE_MS);

/**
 * Fetch fresh user data from server
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
 * Force immediate sync (use when logging out or closing)
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
 * Merge local guest data with server user data
 * Server data takes precedence for conflicts
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
  // Note: We don't merge local collection, server is authoritative

  return {
    ...server,
    decks: Array.from(deckMap.values()),
    collection: Array.from(collectionMap.entries()).map(([name, quantity]) => ({
      name,
      quantity,
    })),
  };
}
