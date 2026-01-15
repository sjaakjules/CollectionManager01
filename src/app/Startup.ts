/**
 * Application startup orchestration
 *
 * Handles the initialization sequence:
 * 1. Check for existing session
 * 2. Load card data from API
 * 3. Load or create user data
 * 4. Initialize app state
 */

import type { AppAction } from './AppState';
import type { Card, UserData } from '@/data/dataModels';
import { createGuestUserData } from '@/data/dataModels';
import { loadUserData, saveUserData } from '@/data/userStorage';
import { fetchCards } from '@/data/cardService';
import { getStoredSession } from '@/auth/session';
import { generateUUID } from '@/utils/uuid';

export interface StartupResult {
  success: boolean;
  error?: string;
}

export async function initializeApp(
  dispatch: React.Dispatch<AppAction>
): Promise<StartupResult> {
  try {
    // Step 1: Check for existing session
    const session = getStoredSession();

    if (session) {
      dispatch({
        type: 'SET_SESSION',
        session: {
          isGuest: false,
          userId: session.userId,
          username: session.username,
          token: session.token,
        },
      });
    }

    // Step 2: Load card data (can happen in parallel with user data)
    const cardsPromise = loadCards(dispatch);

    // Step 3: Load or create user data
    const userDataPromise = loadOrCreateUserData(dispatch, session?.userId ?? null);

    // Wait for both to complete
    const [cardsResult, userDataResult] = await Promise.all([
      cardsPromise,
      userDataPromise,
    ]);

    if (!cardsResult.success) {
      return { success: false, error: cardsResult.error };
    }

    if (!userDataResult.success) {
      return { success: false, error: userDataResult.error };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    console.error('Startup failed:', error);
    return { success: false, error: message };
  }
}

async function loadCards(
  dispatch: React.Dispatch<AppAction>
): Promise<StartupResult> {
  try {
    const cards: Card[] = await fetchCards();
    dispatch({ type: 'SET_CARDS', cards });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load cards';
    console.error('Failed to load cards:', error);
    return { success: false, error: message };
  }
}

async function loadOrCreateUserData(
  dispatch: React.Dispatch<AppAction>,
  userId: string | null
): Promise<StartupResult> {
  try {
    // Try to load existing user data
    let userData = await loadUserData(userId);

    // If no data exists, create guest data
    if (!userData) {
      const guestId = generateUUID();
      userData = createGuestUserData(guestId);
      await saveUserData(userData);
    }

    dispatch({ type: 'SET_USER_DATA', userData });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load user data';
    console.error('Failed to load user data:', error);
    return { success: false, error: message };
  }
}
