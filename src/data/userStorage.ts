/**
 * User data persistence using browser storage
 *
 * Uses IndexedDB via idb-keyval for reliable storage.
 * Falls back to localStorage if IndexedDB unavailable.
 *
 * Both stores track a `savedAt` timestamp so loads can pick the newest copy
 * when the two stores diverge (e.g. IndexedDB writes failed mid-session and
 * snapshots landed in localStorage instead).
 *
 * Related files:
 * - `src/app/Startup.ts` (initial user hydration)
 * - `src/app/App.tsx` (autosave path + unload flush)
 * - `src/data/userSync.ts` (backend + local mirror)
 */

import { get, set, del } from 'idb-keyval';
import type { UserData } from './dataModels';

const STORAGE_KEY = 'sorcery_user_data';
const GUEST_KEY = 'sorcery_guest_data';
const SAVED_AT_SUFFIX = ':savedAt';

export interface LoadUserDataResult {
  data: UserData | null;
  /**
   * True when no data could be returned AND at least one store threw while
   * reading — existing data may be present but unreadable. Callers must not
   * overwrite storage with fresh defaults in this case.
   */
  readFailed: boolean;
}

interface StoredSnapshot {
  data: UserData;
  savedAt: number;
}

function loadKeyFor(userId: string | null): string {
  return userId ? `${STORAGE_KEY}_${userId}` : GUEST_KEY;
}

function saveKeyFor(userData: UserData): string {
  return userData.name === 'Guest' ? GUEST_KEY : `${STORAGE_KEY}_${userData.id}`;
}

/**
 * Load user data plus read-failure diagnostics from local persistent storage.
 *
 * Inputs:
 * - `userId`: Logged-in user id, or `null` for guest data.
 *
 * Outputs:
 * - Resolves to `{ data, readFailed }`; the newest snapshot across
 *   IndexedDB/localStorage, or `data: null` when nothing is readable.
 */
export async function loadUserDataResult(
  userId: string | null
): Promise<LoadUserDataResult> {
  const key = loadKeyFor(userId);

  let idbSnapshot: StoredSnapshot | null = null;
  let idbFailed = false;
  try {
    const data = (await get<UserData>(key)) ?? null;
    if (data) {
      let savedAt = 0;
      try {
        savedAt = (await get<number>(`${key}${SAVED_AT_SUFFIX}`)) ?? 0;
      } catch {
        savedAt = 0;
      }
      idbSnapshot = { data, savedAt };
    }
  } catch (error) {
    console.warn('Failed to load from IndexedDB, trying localStorage:', error);
    idbFailed = true;
  }

  let localSnapshot: StoredSnapshot | null = null;
  let localFailed = false;
  try {
    localSnapshot = loadFromLocalStorage(key);
  } catch (error) {
    console.warn('Failed to load from localStorage:', error);
    localFailed = true;
  }

  let data: UserData | null = null;
  if (idbSnapshot && localSnapshot) {
    // Prefer the newest copy; on a timestamp tie, IndexedDB is authoritative.
    data =
      localSnapshot.savedAt > idbSnapshot.savedAt
        ? localSnapshot.data
        : idbSnapshot.data;
  } else {
    data = idbSnapshot?.data ?? localSnapshot?.data ?? null;
  }

  return {
    data,
    readFailed: data === null && (idbFailed || localFailed),
  };
}

/**
 * Load user data from local persistent storage.
 *
 * Inputs:
 * - `userId`: Logged-in user id, or `null` for guest data.
 *
 * Outputs:
 * - Resolves to stored `UserData` or `null` when unavailable.
 */
export async function loadUserData(userId: string | null): Promise<UserData | null> {
  return (await loadUserDataResult(userId)).data;
}

/**
 * Persist user data to IndexedDB/localStorage fallback.
 *
 * Inputs:
 * - `userData`: Full user snapshot to store.
 *
 * Outputs:
 * - Resolves `void` on success; throws when both stores reject the write so
 *   callers can surface the failure.
 */
export async function saveUserData(userData: UserData): Promise<void> {
  const key = saveKeyFor(userData);
  const savedAt = Date.now();
  try {
    await set(key, userData);
    try {
      await set(`${key}${SAVED_AT_SUFFIX}`, savedAt);
    } catch {
      // Timestamp write is best-effort; the snapshot itself is stored.
    }
  } catch (error) {
    console.warn('Failed to save to IndexedDB, using localStorage:', error);
    if (!writeToLocalStorage(key, userData, savedAt)) {
      throw new Error('Failed to save user data to browser storage');
    }
  }
}

/**
 * Synchronously mirror a snapshot to localStorage (best effort).
 *
 * localStorage writes complete synchronously, so this survives tab close even
 * when an in-flight IndexedDB transaction would be aborted. Loads pick this
 * copy up via its `savedAt` timestamp when it is the newest.
 *
 * Inputs:
 * - `userData`: Full user snapshot to mirror.
 *
 * Outputs:
 * - Returns `true` when the mirror write succeeded.
 */
export function mirrorUserDataToLocalStorage(userData: UserData): boolean {
  return writeToLocalStorage(saveKeyFor(userData), userData, Date.now());
}

/**
 * Delete persisted data for a specific logged-in user.
 *
 * Inputs:
 * - `userId`: User id to delete.
 *
 * Outputs:
 * - Resolves `void` when delete attempt completes.
 */
export async function deleteUserData(userId: string): Promise<void> {
  const key = `${STORAGE_KEY}_${userId}`;
  try {
    await del(key);
    await del(`${key}${SAVED_AT_SUFFIX}`);
  } catch (error) {
    console.warn('Failed to delete from IndexedDB:', error);
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // localStorage unavailable; nothing to clean up.
  }
}

/**
 * Clear guest data from storage (testing/debug helper).
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - Resolves `void` when clear attempt completes.
 */
export async function clearAllData(): Promise<void> {
  try {
    await del(GUEST_KEY);
    await del(`${GUEST_KEY}${SAVED_AT_SUFFIX}`);
    // Note: This doesn't clear all user data, just guest
    // Full clear would need to enumerate keys
  } catch (error) {
    console.warn('Failed to clear IndexedDB:', error);
  }
  try {
    localStorage.removeItem(GUEST_KEY);
  } catch {
    // localStorage unavailable; nothing to clean up.
  }
}

// LocalStorage fallback

function loadFromLocalStorage(key: string): StoredSnapshot | null {
  const json = localStorage.getItem(key);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (
        typeof record.savedAt === 'number' &&
        record.data &&
        typeof record.data === 'object'
      ) {
        return { data: record.data as UserData, savedAt: record.savedAt };
      }
      // Legacy format: the raw UserData object with no envelope.
      if (typeof record.name === 'string' && typeof record.id === 'string') {
        return { data: parsed as UserData, savedAt: 0 };
      }
    }
    console.error('Unrecognized localStorage data format');
    return null;
  } catch {
    console.error('Failed to parse localStorage data');
    return null;
  }
}

function writeToLocalStorage(
  key: string,
  userData: UserData,
  savedAt: number
): boolean {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt, data: userData }));
    return true;
  } catch (error) {
    console.warn('Failed to save to localStorage:', error);
    return false;
  }
}
