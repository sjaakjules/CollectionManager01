/**
 * Root React component
 *
 * Sets up the app context provider, orchestrates startup,
 * and renders the main layout with PixiJS canvas and UI panels.
 */

import { useReducer, useEffect, useState, useCallback } from 'react';
import {
  AppContext,
  appReducer,
  initialAppState,
  type AppState,
} from './AppState';
import { initializeApp } from './Startup';
import { PixiCanvas } from '@/rendering/PixiCanvas';
import { SidePanel } from '@/ui/SidePanel';
import { LoginModal } from '@/ui/LoginModal';
import { Notifications } from '@/ui/Notifications';
import '@/styles/ui.css';

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [startupState, setStartupState] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function startup() {
      const result = await initializeApp(dispatch);

      if (cancelled) return;

      if (result.success) {
        setStartupState('ready');
      } else {
        setStartupState('error');
        setStartupError(result.error ?? 'Unknown error');
      }
    }

    startup();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleRetry = useCallback(() => {
    setStartupState('loading');
    setStartupError(null);
    initializeApp(dispatch).then((result) => {
      if (result.success) {
        setStartupState('ready');
      } else {
        setStartupState('error');
        setStartupError(result.error ?? 'Unknown error');
      }
    });
  }, []);

  if (startupState === 'loading') {
    return <LoadingScreen />;
  }

  if (startupState === 'error') {
    return <ErrorScreen error={startupError} onRetry={handleRetry} />;
  }

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <div className="app-container">
        <PixiCanvas />
        <SidePanel />
        <LoginModal />
        <Notifications />
      </div>
    </AppContext.Provider>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <h1>Sorcery Collection Manager</h1>
        <p>Loading cards...</p>
        <div className="loading-spinner" />
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
