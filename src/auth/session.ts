/**
 * Session management
 *
 * Stores and retrieves authentication session data.
 * Uses sessionStorage for tab-scoped sessions or localStorage for persistent.
 *
 * Related files:
 * - `src/auth/authService.ts` (login/logout orchestration)
 * - `src/app/Startup.ts` (session bootstrap on app launch)
 */

const SESSION_KEY = 'sorcery_session';

export interface StoredSession {
  userId: string;
  username: string;
  token: string;
}

/**
 * Persist session payload to browser storage.
 *
 * Inputs:
 * - `session`: Session payload with user id/name/token.
 *
 * Outputs:
 * - Returns `void` after best-effort storage write.
 */
export function storeSession(session: StoredSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.warn('Failed to store session:', error);
  }
}

/**
 * Read session payload from browser storage.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - Returns parsed `StoredSession` or `null` when missing/invalid.
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
 * Remove persisted session payload.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - Returns `void` after best-effort removal.
 */
export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn('Failed to clear session:', error);
  }
}

/**
 * Check whether a valid session payload exists.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - Returns `true` if a session can be read, otherwise `false`.
 */
export function hasSession(): boolean {
  return getStoredSession() !== null;
}
