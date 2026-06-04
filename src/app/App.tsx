/**
 * Root React component
 *
 * Sets up app context, orchestrates startup, and renders the
 * Pixi canvas plus deck/stack UI panels.
 *
 * The splash screen overlays the app while data loads,
 * allowing PixiJS to initialize in the background.
 *
 * Animation sequence (2 seconds total after data loads):
 *   0.0–0.5s  Opaque splash, cards loading invisibly behind
 *   0.5–1.5s  Splash becomes translucent, cards appear at 50% in random order
 *   1.5–2.0s  Splash fades out, cards rise to full opacity
 *
 * Related files:
 * - `src/app/AppState.ts` (global reducer and app context)
 * - `src/app/Startup.ts` (startup orchestration)
 * - `src/rendering/PixiCanvas.tsx` (canvas host)
 * - `src/canvas/canvasAreas.ts` (canvas area creation and placement utilities)
 */

import { useReducer, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  AppContext,
  appReducer,
  initialAppState,
} from './AppState';
import { initializeApp } from './Startup';
import { PixiCanvas } from '@/rendering/PixiCanvas';
import { LoginModal } from '@/ui/LoginModal';
import { Notifications } from '@/ui/Notifications';
import { BottomPanel } from '@/ui/BottomPanel';
import { DeckFilterPopover } from '@/ui/DeckFilterPopover';
import { StacksPanel } from '@/ui/StacksPanel';
import { saveUserData } from '@/data/userStorage';
import { queueSync, flushSync } from '@/data/userSync';
import type { Deck } from '@/data/dataModels';
import type { CardFilterState } from '@/data/cardFilters';
import {
  createDeckZone,
  createEmptyZone,
  createStackZoneAtWorldPoint,
  cardNameToOrientationMap,
  moveZoneIntoQuadrantPreservingCards,
  sanitizeDeckZoneName,
} from '@/canvas/canvasAreas';
import '@/styles/ui.css';

type SplashPhase = 'full' | 'transparent' | 'fading' | 'done';

/**
 * App shell that wires startup, persistence, and UI/canvas coordination.
 *
 * Inputs:
 * - None (component reads from reducer state and local side effects).
 *
 * Outputs:
 * - Returns the root React element tree for the application.
 */
export function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [startupState, setStartupState] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [startupError, setStartupError] = useState<string | null>(null);
  const [splashPhase, setSplashPhase] = useState<SplashPhase>('full');
  const [focusCanvasAreaRequest, setFocusCanvasAreaRequest] = useState<{
    canvasAreaId: string;
    nonce: number;
  } | null>(null);
  const [openStackRequest, setOpenStackRequest] = useState<{
    stackId: string;
    nonce: number;
  } | null>(null);
  const [deckFilterRequest, setDeckFilterRequest] = useState<{
    canvasAreaId: string;
    editingFilterIndex: number | null;
    anchorClientRect: { left: number; top: number; right: number; bottom: number };
    nonce: number;
  } | null>(null);
  const viewportCenterRef = useRef<{ x: number; y: number } | null>(null);
  const canvasAreas = useMemo(
    () => state.userData?.canvasAreas ?? [],
    [state.userData?.canvasAreas],
  );
  const cardOrientationMap = useMemo(
    () => cardNameToOrientationMap(state.cards),
    [state.cards],
  );

  const handleCanvasAreasChange = useCallback(
    (nextCanvasAreas: typeof canvasAreas) => {
      dispatch({ type: 'SET_CANVAS_AREAS', canvasAreas: nextCanvasAreas });
    },
    [dispatch],
  );

  const createStackZone = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const center = viewportCenterRef.current;
    const canvasArea = center
      ? createStackZoneAtWorldPoint(trimmed, center, canvasAreas)
      : createEmptyZone(
          'stack',
          trimmed,
          canvasAreas.filter((entry) => entry.type === 'stack').length,
          canvasAreas,
        );
    const createdId = canvasArea.id;
    dispatch({
      type: 'SET_CANVAS_AREAS',
      canvasAreas: [...canvasAreas, canvasArea],
    });

    if (createdId) {
      setFocusCanvasAreaRequest({ canvasAreaId: createdId, nonce: Date.now() });
    }
    return createdId;
  }, [canvasAreas, dispatch]);

  const createDeckZoneFromDeck = useCallback(
    (deck: Deck): string | null => {
      dispatch({ type: 'CREATE_DECK', deck });
      dispatch({ type: 'SET_ACTIVE_DECK', deckId: deck.id });

      let canvasAreaId: string | null = null;
      const existingCanvasArea = canvasAreas.find(
        (area) => area.type === 'deck' && area.deckId === deck.id,
      );
      const nextCanvasAreas = existingCanvasArea
        ? canvasAreas.map((area) =>
            area.id === existingCanvasArea.id
              ? {
                  ...moveZoneIntoQuadrantPreservingCards(
                    area,
                    canvasAreas.filter(
                      (entry) => entry.type === 'deck' && entry.pinned,
                    ).length,
                    canvasAreas,
                  ),
                  name: sanitizeDeckZoneName(deck.name),
                  avatarCardName: deck.boards.avatar[0]?.name ?? null,
                  deckAuthor: deck.author ?? null,
                }
              : area,
          )
        : [
            ...canvasAreas,
            createDeckZone(
              deck,
              cardOrientationMap,
              canvasAreas.filter((area) => area.type === 'deck').length,
              canvasAreas,
            ),
          ];
      canvasAreaId =
        existingCanvasArea?.id ??
        nextCanvasAreas.find(
          (area) => area.type === 'deck' && area.deckId === deck.id,
        )?.id ??
        null;
      dispatch({ type: 'SET_CANVAS_AREAS', canvasAreas: nextCanvasAreas });

      if (canvasAreaId) {
        setFocusCanvasAreaRequest({ canvasAreaId, nonce: Date.now() });
      }
      return canvasAreaId;
    },
    [canvasAreas, cardOrientationMap, dispatch],
  );

  const setCanvasAreaPinned = useCallback((canvasAreaId: string, pinned: boolean) => {
    const nextCanvasAreas = canvasAreas.map((area) => {
      if (area.id !== canvasAreaId) return area;
      if (area.pinned === pinned) return area;
      if (!pinned) return { ...area, pinned: false };
      if (area.type === 'stack') {
        return { ...area, pinned: true };
      }

      return moveZoneIntoQuadrantPreservingCards(
        { ...area, pinned: true },
        canvasAreas.filter((entry) => entry.type === area.type && entry.pinned).length,
        canvasAreas,
      );
    });
    dispatch({ type: 'SET_CANVAS_AREAS', canvasAreas: nextCanvasAreas });
  }, [canvasAreas, dispatch]);

  const deleteCanvasArea = useCallback((canvasAreaId: string) => {
    const nextCanvasAreas = canvasAreas.filter((area) => area.id !== canvasAreaId);
    dispatch({ type: 'SET_CANVAS_AREAS', canvasAreas: nextCanvasAreas });
  }, [canvasAreas, dispatch]);

  const focusCanvasArea = useCallback((canvasAreaId: string) => {
    const nextCanvasAreas = canvasAreas.map((area) => {
      if (area.id !== canvasAreaId) return area;
      if (area.pinned) return area;
      if (area.type === 'stack') {
        return { ...area, pinned: true };
      }
      return moveZoneIntoQuadrantPreservingCards(
        { ...area, pinned: true },
        canvasAreas.filter((entry) => entry.type === area.type && entry.pinned).length,
        canvasAreas,
      );
    });
    dispatch({ type: 'SET_CANVAS_AREAS', canvasAreas: nextCanvasAreas });
    setFocusCanvasAreaRequest({ canvasAreaId, nonce: Date.now() });
  }, [canvasAreas, dispatch]);

  const removeCardFromStack = useCallback((stackId: string, cardName: string) => {
    const nextCanvasAreas = canvasAreas.map((area) => {
      if (area.id !== stackId || area.type !== 'stack') return area;
      const nextCards = area.cards.filter((card) => card.cardName !== cardName);
      if (nextCards.length === area.cards.length) return area;
      return { ...area, cards: nextCards };
    });
    dispatch({ type: 'SET_CANVAS_AREAS', canvasAreas: nextCanvasAreas });
  }, [canvasAreas, dispatch]);

  const setDeckCanvasFilters = useCallback(
    (canvasAreaId: string, filters: CardFilterState) => {
      const nextCanvasAreas = canvasAreas.map((area) => {
        if (area.id !== canvasAreaId || area.type !== 'deck') return area;
        return { ...area, cardFilters: filters };
      });
      dispatch({ type: 'SET_CANVAS_AREAS', canvasAreas: nextCanvasAreas });
    },
    [canvasAreas, dispatch],
  );

  const activeDeckFilterArea = useMemo(() => {
    if (!deckFilterRequest) return null;
    return (
      canvasAreas.find(
        (area) => area.id === deckFilterRequest.canvasAreaId && area.type === 'deck',
      ) ?? null
    );
  }, [canvasAreas, deckFilterRequest]);

  useEffect(() => {
    if (!deckFilterRequest) return;
    if (activeDeckFilterArea) return;
    setDeckFilterRequest(null);
  }, [activeDeckFilterArea, deckFilterRequest]);

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
        <PixiCanvas
          splashDone={splashPhase === 'done'}
          canvasAreas={canvasAreas}
          onCanvasAreasChange={handleCanvasAreasChange}
          onStackHeaderClick={(stackId) =>
            setOpenStackRequest({ stackId, nonce: Date.now() })
          }
          onViewportCenterChange={(center) => {
            viewportCenterRef.current = center;
          }}
          onDeckFilterRequest={(request) =>
            setDeckFilterRequest({ ...request, nonce: Date.now() })
          }
          focusCanvasAreaRequest={focusCanvasAreaRequest}
        />
        <StacksPanel
          canvasAreas={canvasAreas}
          onCreateStack={createStackZone}
          onSetCanvasAreaPinned={setCanvasAreaPinned}
          onFocusCanvasArea={focusCanvasArea}
          onRemoveCardFromStack={removeCardFromStack}
          openStackRequest={openStackRequest}
        />
        <BottomPanel
          canvasAreas={canvasAreas}
          onCreateDeckZone={createDeckZoneFromDeck}
          onDeleteCanvasArea={deleteCanvasArea}
          onFocusCanvasArea={focusCanvasArea}
        />
        <DeckFilterPopover
          canvasArea={activeDeckFilterArea}
          cards={state.cards}
          anchorRect={deckFilterRequest?.anchorClientRect ?? null}
          requestNonce={deckFilterRequest?.nonce ?? 0}
          requestedEditingFilterIndex={deckFilterRequest?.editingFilterIndex ?? null}
          onUpdateDeckCanvasFilters={setDeckCanvasFilters}
          onClose={() => setDeckFilterRequest(null)}
        />
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
