/**
 * Login modal for optional account authentication
 *
 * The app remains fully functional without login.
 * Login only enhances persistence across devices.
 */

import { useState, useCallback } from 'react';
import { useAppState } from '@/app/AppState';
import { login, logout } from '@/auth/authService';

export function LoginModal() {
  const { state, dispatch } = useAppState();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClose = useCallback(() => {
    dispatch({ type: 'TOGGLE_LOGIN_MODAL' });
    setUsername('');
    setPassword('');
    setError(null);
  }, [dispatch]);

  const handleLogin = useCallback(async () => {
    if (!username.trim() || !password) {
      setError('Username and password are required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const session = await login(username.trim(), password);
      dispatch({
        type: 'SET_SESSION',
        session: {
          isGuest: false,
          userId: session.userId,
          username: session.username,
          token: session.token,
        },
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }, [username, password, dispatch, handleClose]);

  const handleLogout = useCallback(() => {
    logout();
    dispatch({
      type: 'SET_SESSION',
      session: {
        isGuest: true,
        userId: null,
        username: null,
        token: null,
      },
    });
    handleClose();
  }, [dispatch, handleClose]);

  if (!state.ui.loginModalOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{state.session.isGuest ? 'Login' : 'Account'}</h2>
          <button className="modal-close" onClick={handleClose}>
            ×
          </button>
        </div>

        <div className="modal-content">
          {state.session.isGuest ? (
            <>
              <p className="modal-info">
                Login to save your decks across devices. The app works fully
                without an account.
              </p>

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
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  disabled={loading}
                />
              </div>

              {error && <div className="form-error">{error}</div>}

              <div className="modal-actions">
                <button onClick={handleClose} disabled={loading}>
                  Cancel
                </button>
                <button
                  onClick={handleLogin}
                  disabled={loading || !username.trim() || !password}
                  className="primary"
                >
                  {loading ? 'Logging in...' : 'Login'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Logged in as <strong>{state.session.username}</strong>
              </p>
              <div className="modal-actions">
                <button onClick={handleClose}>Close</button>
                <button onClick={handleLogout} className="danger">
                  Logout
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
