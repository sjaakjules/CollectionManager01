/**
 * Root React component
 *
 * Sets up the app context provider, orchestrates startup,
 * and renders the main layout with PixiJS canvas and UI panels.
 *
 * The splash screen overlays the app while data loads,
 * allowing PixiJS to initialize in the background.
 *
 * Animation sequence (2 seconds total after data loads):
 *   0.0–0.5s  Opaque splash, cards loading invisibly behind
 *   0.5–1.5s  Splash becomes translucent, cards appear at 50% in random order
 *   1.5–2.0s  Splash fades out, cards rise to full opacity
 */

import { useReducer, useEffect, useState, useCallback } from 'react';
import {
  AppContext,
  appReducer,
  initialAppState,
} from './AppState';
import { initializeApp } from './Startup';
import { PixiCanvas } from '@/rendering/PixiCanvas';
// SidePanel kept for future use
// import { SidePanel } from '@/ui/SidePanel';
import { LoginModal } from '@/ui/LoginModal';
import { Notifications } from '@/ui/Notifications';
import { BottomPanel } from '@/ui/BottomPanel';
import { saveUserData } from '@/data/userStorage';
import { queueSync, flushSync } from '@/data/userSync';
import '@/styles/ui.css';

type SplashPhase = 'full' | 'transparent' | 'fading' | 'done';

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [startupState, setStartupState] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [startupError, setStartupError] = useState<string | null>(null);
  const [splashPhase, setSplashPhase] = useState<SplashPhase>('full');

  useEffect(() => {
    let cancelled = false;

    async function startup() {
      const result = await initializeApp(dispatch);
      if (cancelled) return;

      if (!result.success) {
        setStartupState('error');
        setStartupError(result.error ?? 'Unknown error');
        setSplashPhase('done');
        return;
      }

      setStartupState('ready');

      // 0.5s: splash becomes translucent so cards show through
      setTimeout(() => { if (!cancelled) setSplashPhase('transparent'); }, 500);
      // 1.5s: splash starts fading out
      setTimeout(() => { if (!cancelled) setSplashPhase('fading'); }, 1500);
      // 2.0s: splash removed
      setTimeout(() => { if (!cancelled) setSplashPhase('done'); }, 2000);
    }

    startup();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleRetry = useCallback(() => {
    setStartupState('loading');
    setStartupError(null);
    setSplashPhase('full');

    initializeApp(dispatch).then((result) => {
      if (!result.success) {
        setStartupState('error');
        setStartupError(result.error ?? 'Unknown error');
        setSplashPhase('done');
        return;
      }

      setStartupState('ready');
      setTimeout(() => setSplashPhase('transparent'), 500);
      setTimeout(() => setSplashPhase('fading'), 1500);
      setTimeout(() => setSplashPhase('done'), 2000);
    });
  }, []);

  useEffect(() => {
    if (!state.userData) return;

    // Always keep a local copy for offline use/recovery.
    saveUserData(state.userData).catch((error) => {
      console.error('Failed to save local user data:', error);
    });

    // Logged-in users additionally sync to backend.
    if (
      !state.session.isGuest &&
      state.session.token &&
      state.session.userId &&
      state.userData.id === state.session.userId
    ) {
      queueSync(state.userData, state.session.token);
    }
  }, [state.userData, state.session.isGuest, state.session.token, state.session.userId]);

  useEffect(() => {
    const canFlush =
      !!state.userData &&
      !state.session.isGuest &&
      !!state.session.token &&
      !!state.session.userId &&
      state.userData.id === state.session.userId;

    if (!canFlush) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && state.userData && state.session.token) {
        void flushSync(state.userData, state.session.token);
      }
    };

    const handleBeforeUnload = () => {
      if (state.userData && state.session.token) {
        void flushSync(state.userData, state.session.token);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [
    state.userData,
    state.session.isGuest,
    state.session.token,
    state.session.userId,
  ]);

  if (startupState === 'error') {
    return <ErrorScreen error={startupError} onRetry={handleRetry} />;
  }

  const splashClass =
    splashPhase === 'transparent' ? 'splash-transparent' :
    splashPhase === 'fading' ? 'splash-fade-out' : '';

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <div className="app-container">
        <PixiCanvas splashDone={splashPhase === 'done'} />
        <BottomPanel />
        <LoginModal />
        <Notifications />
      </div>
      {splashPhase !== 'done' && <SplashScreen className={splashClass} />}
    </AppContext.Provider>
  );
}

function SplashScreen({ className }: { className: string }) {
  return (
    <div className={`splash-screen ${className}`}>
      <div className="splash-content">
        <div className="splash-title">
          <span className="splash-title-sorcery">Sorcery</span>
          <span className="splash-title-stacks">Stacks</span>
        </div>
        <div className="splash-bar">
          <div className="splash-bar-fill" />
        </div>
      </div>
    </div>
  );
}

interface ErrorScreenProps {
  error: string | null;
  onRetry: () => void;
}

function ErrorScreen({ error, onRetry }: ErrorScreenProps) {
  return (
    <div className="error-screen">
      <div className="error-content">
        <h1>Failed to Load</h1>
        <p>{error ?? 'An unknown error occurred'}</p>
        <button onClick={onRetry}>Retry</button>
      </div>
    </div>
  );
}
