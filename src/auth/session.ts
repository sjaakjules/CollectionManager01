/**
 * Session management
 *
 * Stores and retrieves authentication session data.
 * Uses sessionStorage for tab-scoped sessions or localStorage for persistent.
 */

const SESSION_KEY = 'sorcery_session';

export interface StoredSession {
  userId: string;
  username: string;
  token: string;
}

/**
 * Store session data
 */
export function storeSession(session: StoredSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.warn('Failed to store session:', error);
  }
}

/**
 * Get stored session
 */
export function getStoredSession(): StoredSession | null {
  try {
    const json = localStorage.getItem(SESSION_KEY);
    if (!json) return null;
    return JSON.parse(json) as StoredSession;
  } catch {
    return null;
  }
}

/**
 * Clear session data (logout)
 */
export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn('Failed to clear session:', error);
  }
}

/**
 * Check if session exists
 */
export function hasSession(): boolean {
  return getStoredSession() !== null;
}
