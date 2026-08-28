/**
 * Application startup orchestration
 *
 * Handles the initialization sequence:
 * 1. Check for existing session
 * 2. Load card data from API
 * 3. Load or create user data
 * 4. Initialize app state
 *
 * Related files:
 * - `src/app/App.tsx` (calls `initializeApp`)
 * - `src/auth/session.ts` (session bootstrap)
 * - `src/data/cardService.ts` (card bootstrap)
 * - `src/data/userStorage.ts` and `src/data/userSync.ts` (user data hydration/merge)
 */

import type { AppAction } from './AppState';
import type { Card, UserData } from '@/data/dataModels';
import { createGuestUserData } from '@/data/dataModels';
import { loadUserDataResult, saveUserData } from '@/data/userStorage';
import { fetchGuestSeedDecks, mergeSeedDecks } from '@/data/seedDecks';
import { fetchCards } from '@/data/cardService';
import { getStoredSession, type StoredSession } from '@/auth/session';
import { generateUUID } from '@/utils/uuid';
import { fetchUserData } from '@/auth/api';
import { mergeUserData } from '@/data/userSync';

export interface StartupResult {
  success: boolean;
  error?: string;
}

/**
 * Bootstrap cards, session, and user data, then dispatch initial app actions.
 *
 * Inputs:
 * - `dispatch`: App reducer dispatch function.
 *
 * Outputs:
 * - Resolves to `{ success: true }` on completion or `{ success: false, error }` on failure.
 */
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
    const userDataPromise = loadOrCreateUserData(dispatch, session ?? null);

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
  session: StoredSession | null
): Promise<StartupResult> {
  try {
    let userData: UserData | null = null;
    let readFailed = false;

    if (session) {
      const localResult = await loadUserDataResult(session.userId);
      const localData = localResult.data;
      readFailed = localResult.readFailed;
      let serverData: UserData | null = null;

      try {
        serverData = await fetchUserData(session.userId, session.token);
      } catch (error) {
        console.warn('Failed to fetch server user data during startup:', error);
      }

      if (localData && serverData) {
        userData = mergeUserData(localData, serverData);
      } else if (serverData) {
        userData = serverData;
      } else if (localData) {
        userData = localData;
      } else {
        userData = {
          name: session.username,
          id: session.userId,
          decks: [],
          collection: [],
          selectedCardCategory: null,
          favouriteDeckIds: [],
          canvasLabels: [],
          canvasAreas: [],
        };
      }
    } else {
      const guestResult = await loadUserDataResult(null);
      userData = guestResult.data;
      readFailed = guestResult.readFailed;
      if (!userData) {
        const guestId = generateUUID();
        userData = createGuestUserData(guestId);
      }

      userData = await applyGuestSeedDecks(dispatch, userData);

      dispatch({
        type: 'SET_SESSION',
        session: {
          isGuest: true,
          userId: userData.id,
          username: userData.name,
          token: null,
        },
      });
    }

    if (readFailed) {
      // A storage read threw, so existing data may be present but unreadable.
      // Persisting now could overwrite it with fresh defaults — stay in
      // memory only and let the user know.
      dispatch({
        type: 'ADD_NOTIFICATION',
        notification: {
          type: 'error',
          message:
            'Saved data could not be read from browser storage, so it was left untouched. Changes made now may not persist — try reloading.',
        },
      });
    } else {
      try {
        await saveUserData(userData);
      } catch (error) {
        console.warn('Failed to persist user data during startup:', error);
      }
    }

    dispatch({ type: 'SET_USER_DATA', userData });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load user data';
    console.error('Failed to load user data:', error);
    return { success: false, error: message };
  }
}

/**
 * Merge bundled seed decks into guest data (first boot only per deck id).
 *
 * Inputs:
 * - `dispatch`: App reducer dispatch (for the one-time "decks added" notice).
 * - `userData`: Guest snapshot to extend.
 *
 * Outputs:
 * - Resolves to the (possibly extended) guest snapshot; never throws.
 */
async function applyGuestSeedDecks(
  dispatch: React.Dispatch<AppAction>,
  userData: UserData
): Promise<UserData> {
  try {
    const seedDecks = await fetchGuestSeedDecks();
    if (seedDecks.length === 0) return userData;

    const { userData: seeded, addedDeckNames } = mergeSeedDecks(userData, seedDecks);
    if (addedDeckNames.length > 0) {
      dispatch({
        type: 'ADD_NOTIFICATION',
        notification: {
          type: 'info',
          message: `Added ${addedDeckNames.length} downloaded ${
            addedDeckNames.length === 1 ? 'deck' : 'decks'
          }: ${addedDeckNames.join(', ')}`,
        },
      });
    }
    return seeded;
  } catch (error) {
    console.warn('Failed to apply guest seed decks:', error);
    return userData;
  }
}
