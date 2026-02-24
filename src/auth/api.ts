/**
 * Backend API wrapper
 *
 * Provides typed methods for backend communication.
 * All requests include auth token in Authorization header.
 *
 * Related files:
 * - `src/auth/authService.ts` (auth orchestration)
 * - `src/data/userSync.ts` (pull/push user data)
 * - `src/app/Startup.ts` (startup user bootstrap)
 */

import type { UserData } from '@/data/dataModels';

// Configure base URL via environment variable or default
const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

// ============================================================================
// Types
// ============================================================================

export interface LoginResponse {
  userId: string;
  username: string;
  token: string;
}

export interface ApiError {
  message: string;
  status: number;
}

// ============================================================================
// Auth Endpoints
// ============================================================================

/**
 * Perform backend login request.
 *
 * Inputs:
 * - `username`: Account username.
 * - `password`: Account password.
 *
 * Outputs:
 * - Resolves to auth/session payload for the authenticated user.
 */
export async function loginApi(
  username: string,
  password: string
): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const error = await parseError(response);
    throw new Error(error.message);
  }

  return response.json();
}

/**
 * Perform backend signup request.
 *
 * Inputs:
 * - `username`: Requested account username.
 * - `password`: Requested account password.
 *
 * Outputs:
 * - Resolves to auth/session payload for the created user.
 */
export async function signupApi(
  username: string,
  password: string
): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const error = await parseError(response);
    throw new Error(error.message);
  }

  return response.json();
}

// ============================================================================
// User Data Endpoints
// ============================================================================

/**
 * Fetch persisted user data from backend.
 *
 * Inputs:
 * - `userId`: User identifier.
 * - `token`: Bearer auth token.
 *
 * Outputs:
 * - Resolves to `UserData`, `null` on 404, or throws on other failures.
 */
export async function fetchUserData(
  userId: string,
  token: string
): Promise<UserData | null> {
  const response = await fetch(`${API_BASE_URL}/user/${userId}/data`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const error = await parseError(response);
    throw new Error(error.message);
  }

  return response.json();
}

/**
 * Persist the full user payload to backend.
 *
 * Inputs:
 * - `userId`: User identifier.
 * - `data`: Full `UserData` payload to persist.
 * - `token`: Bearer auth token.
 *
 * Outputs:
 * - Resolves `void` on success; throws on request failure.
 */
export async function updateUserData(
  userId: string,
  data: UserData,
  token: string
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/user/${userId}/data`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await parseError(response);
    throw new Error(error.message);
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function parseError(response: Response): Promise<ApiError> {
  try {
    const data = await response.json();
    return {
      message: data.message ?? data.error ?? 'Unknown error',
      status: response.status,
    };
  } catch {
    return {
      message: `HTTP ${response.status}: ${response.statusText}`,
      status: response.status,
    };
  }
}
