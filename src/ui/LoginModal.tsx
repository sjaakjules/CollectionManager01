/**
 * Login modal for optional account authentication
 *
 * The app remains fully functional without login.
 * Login only enhances persistence across devices.
 */

import { useState, useCallback } from 'react';
import { useAppState } from '@/app/AppState';
import { login, logout, signup } from '@/auth/authService';
import { loadUserDataResult, saveUserData } from '@/data/userStorage';
import {
  pullUserData,
  mergeUserData,
  flushSync,
} from '@/data/userSync';
import { createGuestUserData, type UserData } from '@/data/dataModels';
import { generateUUID } from '@/utils/uuid';

type AuthMode = 'login' | 'signup';

interface AuthSession {
  userId: string;
  username: string;
  token: string;
}

export function LoginModal() {
  const { state, dispatch } = useAppState();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<AuthMode>('login');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClose = useCallback(() => {
    if (loading) return;
    dispatch({ type: 'TOGGLE_LOGIN_MODAL' });
    setUsername('');
    setPassword('');
    setMode('login');
    setError(null);
  }, [dispatch, loading]);

  const validateForm = useCallback((): string | null => {
    if (!username.trim() || !password) {
      return 'Username and password are required';
    }
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username.trim())) {
      return 'Username must be 3-24 characters (letters, numbers, underscore)';
    }
    if (username.trim().toLowerCase() === 'guest') {
      return 'Username "guest" is reserved';
    }
    if (password.length < 6) {
      return 'Password must be at least 6 characters';
    }
    return null;
  }, [username, password]);

  const buildAccountUserData = useCallback(
    (session: AuthSession, guestData: UserData | null, serverData: UserData | null) => {
      if (guestData && serverData) {
        return mergeUserData(guestData, serverData, state.cards);
      }

      if (serverData) {
        return serverData;
      }

      if (guestData) {
        return {
          ...guestData,
          id: session.userId,
          name: session.username,
        };
      }

      return {
        name: session.username,
        id: session.userId,
        decks: [],
        collection: [],
        selectedCardCategory: null,
        favouriteDeckIds: [],
        canvasLabels: [],
        canvasAreas: [],
      };
    },
    [state.cards]
  );

  const handleAuthenticate = useCallback(async () => {
    if (loading) return;
    if (mode === 'signup' && !state.userData) {
      setError('Your guest workspace is still loading. Please try again once it is ready.');
      return;
    }
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);

    const guestData = state.userData;
    let session: AuthSession;

    try {
      // Retain a separate guest backup before changing identity. Signup sends the
      // complete shared JSON schema; the server saves it with the new account.
      if (mode === 'signup' && guestData) await saveUserData(guestData);
      session = mode === 'signup'
        ? await signup(username.trim(), password, guestData ?? undefined)
        : await login(username.trim(), password);
    } catch (err) {
      const fallback = mode === 'signup' ? 'Sign up failed' : 'Login failed';
      setError(err instanceof Error ? err.message : fallback);
      setLoading(false);
      return;
    }

    let mergedUserData = buildAccountUserData(session, guestData, null);

    try {
      // A new account already contains this exact workspace. Do not merge its
      // copy back into the guest snapshot (which used to double collection counts).
      if (mode === 'login') {
        const serverData = await pullUserData(session.userId, session.token);
        mergedUserData = buildAccountUserData(session, guestData, serverData);
      }
      await saveUserData(mergedUserData);
    } catch (error) {
      console.warn('Failed to merge account data during login:', error);
      try {
        await saveUserData(mergedUserData);
      } catch (saveError) {
        console.warn('Failed to save fallback account data locally:', saveError);
      }
    }

    dispatch({ type: 'SET_USER_DATA', userData: mergedUserData });
    dispatch({
      type: 'SET_SESSION',
      session: {
        isGuest: false,
        userId: session.userId,
        username: session.username,
        token: session.token,
      },
    });
    if (mode === 'signup') dispatch({ type: 'ADD_NOTIFICATION', notification: {
      type: 'info', message: 'Account created. Your guest decks, layouts, labels, and collection are saved in your account.',
    } });
    dispatch({ type: 'TOGGLE_LOGIN_MODAL' });
    setUsername('');
    setPassword('');
    setLoading(false);
    setMode('login');
  }, [
    mode,
    loading,
    username,
    password,
    state.userData,
    dispatch,
    validateForm,
    buildAccountUserData,
  ]);

  const handleLogout = useCallback(() => {
    const finalizeLogout = async () => {
      if (state.userData && state.session.token) {
        try {
          await flushSync(state.userData, state.session.token);
        } catch (error) {
          console.warn('Failed to flush user data before logout:', error);
        }
      }

      logout();

      const guestResult = await loadUserDataResult(null);
      let guestData = guestResult.data;
      if (!guestData) {
        guestData = createGuestUserData(generateUUID());
        // When the read failed, existing guest data may still be in storage —
        // don't overwrite it with an empty snapshot.
        if (!guestResult.readFailed) {
          await saveUserData(guestData);
        }
      }

      dispatch({ type: 'SET_USER_DATA', userData: guestData });
      dispatch({
        type: 'SET_SESSION',
        session: {
          isGuest: true,
          userId: guestData.id,
          username: guestData.name,
          token: null,
        },
      });
      handleClose();
    };

    setLoading(true);
    setError(null);

    finalizeLogout().catch((err) => {
      setError(err instanceof Error ? err.message : 'Logout failed');
    }).finally(() => {
      setLoading(false);
    });
  }, [state.userData, state.session.token, dispatch, handleClose]);

  const switchMode = useCallback((nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
  }, []);

  if (!state.ui.loginModalOpen) return null;

  const submitLabel = mode === 'signup' ? 'Create Account' : 'Login';
  const submittingLabel = mode === 'signup' ? 'Creating account...' : 'Logging in...';

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Account</h2>
          <button className="modal-close" onClick={handleClose} disabled={loading}>
            ×
          </button>
        </div>

        <div className="modal-content">
          {state.session.isGuest ? (
            <>
              <p className="modal-info">
                Creating an account transfers your guest decks, saved layouts, stacks, labels,
                collection, and settings automatically. A guest copy stays in this browser.
              </p>

              <div className="auth-mode-row">
                <button
                  type="button"
                  className={mode === 'login' ? 'active' : ''}
                  onClick={() => switchMode('login')}
                  disabled={loading}
                >
                  Log In
                </button>
                <button
                  type="button"
                  className={mode === 'signup' ? 'active' : ''}
                  onClick={() => switchMode('signup')}
                  disabled={loading}
                >
                  Sign Up
                </button>
              </div>

              <div className="form-field">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="form-field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAuthenticate()}
                  disabled={loading}
                />
              </div>

              {error && <div className="form-error">{error}</div>}

              <div className="modal-actions">
                <button onClick={handleClose} disabled={loading}>
                  Cancel
                </button>
                <button
                  onClick={handleAuthenticate}
                  disabled={loading || !username.trim() || !password}
                  className="primary"
                >
                  {loading ? submittingLabel : submitLabel}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Logged in as <strong>{state.session.username}</strong>
              </p>
              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button onClick={handleClose} disabled={loading}>Close</button>
                <button onClick={handleLogout} className="danger" disabled={loading}>
                  {loading ? 'Switching...' : 'Switch to Guest'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
