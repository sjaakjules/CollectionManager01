/**
 * Authentication service
 *
 * Handles login/logout and token management.
 * Backend is expected to be minimal - just storing JSON blobs.
 */

import { storeSession, clearSession, type StoredSession } from './session';
import { loginApi, type LoginResponse } from './api';

export interface LoginResult {
  userId: string;
  username: string;
  token: string;
}

/**
 * Login with username and password
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
 * Logout and clear session
 */
export function logout(): void {
  clearSession();
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return getAuthToken() !== null;
}

/**
 * Get current auth token
 */
export function getAuthToken(): string | null {
  const session = getStoredSessionSafe();
  return session?.token ?? null;
}

function getStoredSessionSafe(): StoredSession | null {
  try {
    const { getStoredSession } = require('./session');
    return getStoredSession();
  } catch {
    return null;
  }
}
