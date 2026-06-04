/**
 * Root React component
 *
 * Sets up app context, orchestrates startup, and renders the
 * Pixi canvas plus deck/zone UI panels.
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
 * - `src/zones/zones.ts` (zone creation and placement utilities)
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
} from '@/zones/zones';
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
  const [focusZoneRequest, setFocusZoneRequest] = useState<{
    zoneId: string;
    nonce: number;
  } | null>(null);
  const [openStackRequest, setOpenStackRequest] = useState<{
    stackId: string;
    nonce: number;
  } | null>(null);
  const [deckFilterRequest, setDeckFilterRequest] = useState<{
    zoneId: string;
    editingFilterIndex: number | null;
    anchorClientRect: { left: number; top: number; right: number; bottom: number };
    nonce: number;
  } | null>(null);
  const viewportCenterRef = useRef<{ x: number; y: number } | null>(null);
  const zones = useMemo(() => state.userData?.zones ?? [], [state.userData?.zones]);
  const cardOrientationMap = useMemo(
    () => cardNameToOrientationMap(state.cards),
    [state.cards],
  );

  const handleZonesChange = useCallback(
    (nextZones: typeof zones) => {
      dispatch({ type: 'SET_ZONES', zones: nextZones });
    },
    [dispatch],
  );

  const createStackZone = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const center = viewportCenterRef.current;
    const zone = center
      ? createStackZoneAtWorldPoint(trimmed, center, zones)
      : createEmptyZone(
          'stack',
          trimmed,
          zones.filter((entry) => entry.type === 'stack').length,
          zones,
        );
    const createdId = zone.id;
    dispatch({ type: 'SET_ZONES', zones: [...zones, zone] });

    if (createdId) {
      setFocusZoneRequest({ zoneId: createdId, nonce: Date.now() });
    }
    return createdId;
  }, [dispatch, zones]);

  const createDeckZoneFromDeck = useCallback(
    (deck: Deck): string | null => {
      dispatch({ type: 'CREATE_DECK', deck });
      dispatch({ type: 'SET_ACTIVE_DECK', deckId: deck.id });

      let zoneId: string | null = null;
      const existingZone = zones.find(
        (zone) => zone.type === 'deck' && zone.deckId === deck.id,
      );
      const nextZones = existingZone
        ? zones.map((zone) =>
            zone.id === existingZone.id
              ? {
                  ...moveZoneIntoQuadrantPreservingCards(
                    zone,
                    zones.filter(
                      (entry) => entry.type === 'deck' && entry.pinned,
                    ).length,
                    zones,
                  ),
                  name: sanitizeDeckZoneName(deck.name),
                  avatarCardName: deck.boards.avatar[0]?.name ?? null,
                  deckAuthor: deck.author ?? null,
                }
              : zone,
          )
        : [
            ...zones,
            createDeckZone(
              deck,
              cardOrientationMap,
              zones.filter((zone) => zone.type === 'deck').length,
              zones,
            ),
          ];
      zoneId =
        existingZone?.id ??
        nextZones.find(
          (zone) => zone.type === 'deck' && zone.deckId === deck.id,
        )?.id ??
        null;
      dispatch({ type: 'SET_ZONES', zones: nextZones });

      if (zoneId) {
        setFocusZoneRequest({ zoneId, nonce: Date.now() });
      }
      return zoneId;
    },
    [cardOrientationMap, dispatch, zones],
  );

  const setZonePinned = useCallback((zoneId: string, pinned: boolean) => {
    const nextZones = zones.map((zone) => {
      if (zone.id !== zoneId) return zone;
      if (zone.pinned === pinned) return zone;
      if (!pinned) return { ...zone, pinned: false };
      if (zone.type === 'stack') {
        return { ...zone, pinned: true };
      }

      return moveZoneIntoQuadrantPreservingCards(
        { ...zone, pinned: true },
        zones.filter((entry) => entry.type === zone.type && entry.pinned).length,
        zones,
      );
    });
    dispatch({ type: 'SET_ZONES', zones: nextZones });
  }, [dispatch, zones]);

  const deleteZone = useCallback((zoneId: string) => {
    const nextZones = zones.filter((zone) => zone.id !== zoneId);
    dispatch({ type: 'SET_ZONES', zones: nextZones });
  }, [dispatch, zones]);

  const focusZone = useCallback((zoneId: string) => {
    const nextZones = zones.map((zone) => {
      if (zone.id !== zoneId) return zone;
      if (zone.pinned) return zone;
      if (zone.type === 'stack') {
        return { ...zone, pinned: true };
      }
      return moveZoneIntoQuadrantPreservingCards(
        { ...zone, pinned: true },
        zones.filter((entry) => entry.type === zone.type && entry.pinned).length,
        zones,
      );
    });
    dispatch({ type: 'SET_ZONES', zones: nextZones });
    setFocusZoneRequest({ zoneId, nonce: Date.now() });
  }, [dispatch, zones]);

  const removeCardFromStack = useCallback((zoneId: string, cardName: string) => {
    const nextZones = zones.map((zone) => {
      if (zone.id !== zoneId || zone.type !== 'stack') return zone;
      const nextCards = zone.cards.filter((card) => card.cardName !== cardName);
      if (nextCards.length === zone.cards.length) return zone;
      return { ...zone, cards: nextCards };
    });
    dispatch({ type: 'SET_ZONES', zones: nextZones });
  }, [dispatch, zones]);

  const setDeckZoneFilters = useCallback(
    (zoneId: string, filters: CardFilterState) => {
      const nextZones = zones.map((zone) => {
        if (zone.id !== zoneId || zone.type !== 'deck') return zone;
        return { ...zone, cardFilters: filters };
      });
      dispatch({ type: 'SET_ZONES', zones: nextZones });
    },
    [dispatch, zones],
  );

  const activeDeckFilterZone = useMemo(() => {
    if (!deckFilterRequest) return null;
    return (
      zones.find(
        (zone) => zone.id === deckFilterRequest.zoneId && zone.type === 'deck',
      ) ?? null
    );
  }, [deckFilterRequest, zones]);

  useEffect(() => {
    if (!deckFilterRequest) return;
    if (activeDeckFilterZone) return;
    setDeckFilterRequest(null);
  }, [activeDeckFilterZone, deckFilterRequest]);

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
          zones={zones}
          onZonesChange={handleZonesChange}
          onStackZoneHeaderClick={(zoneId) =>
            setOpenStackRequest({ stackId: zoneId, nonce: Date.now() })
          }
          onViewportCenterChange={(center) => {
            viewportCenterRef.current = center;
          }}
          onDeckFilterRequest={(request) =>
            setDeckFilterRequest({ ...request, nonce: Date.now() })
          }
          focusZoneRequest={focusZoneRequest}
        />
        <StacksPanel
          zones={zones}
          onCreateStack={createStackZone}
          onSetZonePinned={setZonePinned}
          onFocusZone={focusZone}
          onRemoveCardFromStack={removeCardFromStack}
          openStackRequest={openStackRequest}
        />
        <BottomPanel
          zones={zones}
          onCreateDeckZone={createDeckZoneFromDeck}
          onDeleteZone={deleteZone}
          onFocusZone={focusZone}
        />
        <DeckFilterPopover
          zone={activeDeckFilterZone}
          cards={state.cards}
          anchorRect={deckFilterRequest?.anchorClientRect ?? null}
          requestNonce={deckFilterRequest?.nonce ?? 0}
          requestedEditingFilterIndex={deckFilterRequest?.editingFilterIndex ?? null}
          onUpdateZoneFilters={setDeckZoneFilters}
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
