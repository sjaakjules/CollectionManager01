/**
 * User data persistence using browser storage
 *
 * Uses IndexedDB via idb-keyval for reliable storage.
 * Falls back to localStorage if IndexedDB unavailable.
 */

import { get, set, del } from 'idb-keyval';
import type { UserData } from './dataModels';

const STORAGE_KEY = 'sorcery_user_data';
const GUEST_KEY = 'sorcery_guest_data';

/**
 * Load user data from storage
 * @param userId - User ID for logged-in users, null for guest
 */
export async function loadUserData(userId: string | null): Promise<UserData | null> {
  try {
    const key = userId ? `${STORAGE_KEY}_${userId}` : GUEST_KEY;
    const data = await get<UserData>(key);
    return data ?? null;
  } catch (error) {
    console.warn('Failed to load from IndexedDB, trying localStorage:', error);
    return loadFromLocalStorage(userId);
  }
}

/**
 * Save user data to storage
 */
export async function saveUserData(userData: UserData): Promise<void> {
  try {
    const key = userData.name === 'Guest' ? GUEST_KEY : `${STORAGE_KEY}_${userData.id}`;
    await set(key, userData);
  } catch (error) {
    console.warn('Failed to save to IndexedDB, using localStorage:', error);
    saveToLocalStorage(userData);
  }
}

/**
 * Delete user data from storage
 */
export async function deleteUserData(userId: string): Promise<void> {
  try {
    await del(`${STORAGE_KEY}_${userId}`);
  } catch (error) {
    console.warn('Failed to delete from IndexedDB:', error);
    localStorage.removeItem(`${STORAGE_KEY}_${userId}`);
  }
}

/**
 * Clear all stored data (for testing/debug)
 */
export async function clearAllData(): Promise<void> {
  try {
    await del(GUEST_KEY);
    // Note: This doesn't clear all user data, just guest
    // Full clear would need to enumerate keys
  } catch (error) {
    console.warn('Failed to clear IndexedDB:', error);
    localStorage.removeItem(GUEST_KEY);
  }
}

// LocalStorage fallback

function loadFromLocalStorage(userId: string | null): UserData | null {
  const key = userId ? `${STORAGE_KEY}_${userId}` : GUEST_KEY;
  const json = localStorage.getItem(key);
  if (!json) return null;

  try {
    return JSON.parse(json) as UserData;
  } catch {
    console.error('Failed to parse localStorage data');
    return null;
  }
}

function saveToLocalStorage(userData: UserData): void {
  const key = userData.name === 'Guest' ? GUEST_KEY : `${STORAGE_KEY}_${userData.id}`;
  localStorage.setItem(key, JSON.stringify(userData));
}
