/**
 * Authentication service
 *
 * Handles login/logout and token management.
 * Backend is expected to be minimal - just storing JSON blobs.
 *
 * Related files:
 * - `src/auth/api.ts` (HTTP requests)
 * - `src/auth/session.ts` (session persistence)
 * - `src/ui/LoginModal.tsx` (login/signup UI)
 */

import { storeSession, clearSession, type StoredSession } from './session';
import { getStoredSession } from './session';
import { loginApi, signupApi, type LoginResponse } from './api';

export interface LoginResult {
  userId: string;
  username: string;
  token: string;
}

/**
 * Authenticate an existing user and persist session data.
 *
 * Inputs:
 * - `username`: Account username.
 * - `password`: Account password.
 *
 * Outputs:
 * - Resolves to `LoginResult` containing user identity and token.
 */
export async function login(username: string, password: string): Promise<LoginResult> {
  const response: LoginResponse = await loginApi(username, password);

  const session: StoredSession = {
    userId: response.userId,
    username: response.username,
    token: response.token,
  };

  storeSession(session);

  return {
    userId: response.userId,
    username: response.username,
    token: response.token,
  };
}

/**
 * Create a new account and immediately persist session data.
 *
 * Inputs:
 * - `username`: Requested username.
 * - `password`: Requested password.
 *
 * Outputs:
 * - Resolves to `LoginResult` containing user identity and token.
 */
export async function signup(
  username: string,
  password: string
): Promise<LoginResult> {
  const response: LoginResponse = await signupApi(username, password);

  const session: StoredSession = {
    userId: response.userId,
    username: response.username,
    token: response.token,
  };

  storeSession(session);

  return {
    userId: response.userId,
    username: response.username,
    token: response.token,
  };
}

/**
 * Clear the persisted authentication session.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - Returns `void`.
 */
export function logout(): void {
  clearSession();
}

/**
 * Check whether a session token is currently available.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - Returns `true` when authenticated, otherwise `false`.
 */
export function isAuthenticated(): boolean {
  return getAuthToken() !== null;
}

/**
 * Read the current auth token from persisted session.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - Returns token string when present, otherwise `null`.
 */
export function getAuthToken(): string | null {
  const session = getStoredSession();
  return session?.token ?? null;
}
