/**
 * Backend API wrapper
 *
 * Provides typed methods for backend communication.
 * All requests include auth token in Authorization header.
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
 * Login with username and password
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

// ============================================================================
// User Data Endpoints
// ============================================================================

/**
 * Fetch user data from server
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
 * Update user data on server
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
