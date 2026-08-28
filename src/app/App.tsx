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
import { isStartupGateEnabled } from './startupGate';
import { PixiCanvas } from '@/rendering/PixiCanvas';
import { LoginModal } from '@/ui/LoginModal';
import { Notifications } from '@/ui/Notifications';
import { BottomPanel } from '@/ui/BottomPanel';
import { DeckFilterPopover } from '@/ui/DeckFilterPopover';
import { StacksPanel } from '@/ui/StacksPanel';
import { DecksPanel } from '@/ui/DecksPanel';
import { useResponsiveUiMode } from '@/ui/useResponsiveUiMode';
import { mirrorUserDataToLocalStorage, saveUserData } from '@/data/userStorage';
import { queueSync, flushSync } from '@/data/userSync';
import type { Deck } from '@/data/dataModels';
import type { ActiveBoard } from '@/data/dataModels';
import type { DeckAddPlacement, DeckAddRequestPayload } from '@/rendering/PixiStage';
import type { CardFilterState } from '@/data/cardFilters';
import {
  createDeckZone,
  createEmptyZone,
  createLookupDeckZone,
  createZoneCardId,
  cardNameToOrientationMap,
  moveZoneIntoQuadrantPreservingCards,
  sanitizeDeckZoneName,
  ZONE_DECK_HEADER_HEIGHT,
  ZONE_HEADER_HEIGHT,
  type CanvasArea,
} from '@/canvas/canvasAreas';
import { createLocalDeck } from '@/data/deckCreation';
import { AVATAR_SHORT_NAMES, getAvatarShortName, type AvatarName } from '@/ui/deckDisplay';
import { BOARD_CHOICE_OPTIONS, type DeckAddBoard } from '@/ui/boardChoice';
import { filterBlockedTokenCardNames, isBlockedTokenCardName } from '@/data/tokenCards';
import {
  getPhoneSideSwipeTarget,
  togglePhoneTab,
  type PhoneTabId,
} from '@/ui/phoneTabs';
import { CARD_SIZE, DRAWN_GRID } from '@/rendering/Grid';
import '@/styles/ui.css';

type StartupState = 'waiting' | 'loading' | 'ready' | 'error';
type SplashPhase = 'full' | 'transparent' | 'fading' | 'done';

const SAVE_ERROR_NOTIFY_INTERVAL_MS = 30_000;

interface PendingDeckAddRequest {
  id: number;
  deckId: string;
  canvasAreaId?: string | null;
  cardNames: string[];
  placements?: DeckAddPlacement[];
  deckToCreate?: Deck;
}

function addCardNamesToDeckBoard(deck: Deck, cardNames: string[], board: DeckAddBoard): Deck {
  const quantities = new Map<string, number>();
  for (const cardName of filterBlockedTokenCardNames(cardNames)) {
    const trimmed = cardName.trim();
    if (!trimmed) continue;
    quantities.set(trimmed, (quantities.get(trimmed) ?? 0) + 1);
  }
  if (quantities.size === 0) return deck;

  let updatedBoard = [...deck.boards[board]];
  for (const [cardName, quantity] of quantities) {
    const existingIndex = updatedBoard.findIndex((card) => card.name === cardName);
    if (existingIndex >= 0) {
      updatedBoard = updatedBoard.map((card, index) =>
        index === existingIndex
          ? { ...card, quantity: card.quantity + quantity }
          : card,
      );
    } else {
      updatedBoard = [...updatedBoard, { name: cardName, quantity }];
    }
  }

  return {
    ...deck,
    boards: { ...deck.boards, [board]: updatedBoard },
    updatedAt: new Date().toISOString(),
  };
}

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
  const uiMode = useResponsiveUiMode();
  const debugStartupGate = useMemo(
    () =>
      typeof window !== 'undefined' &&
      isStartupGateEnabled(window.location.search),
    [],
  );
  const [startupState, setStartupState] = useState<StartupState>(
    debugStartupGate ? 'waiting' : 'loading',
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
  const [activePhoneTab, setActivePhoneTab] = useState<PhoneTabId | null>(null);
  const [pendingDeckAdd, setPendingDeckAdd] = useState<PendingDeckAddRequest | null>(null);
  const [lookupDeckArea, setLookupDeckArea] = useState<CanvasArea | null>(null);
  const pendingDeckAddIdRef = useRef(0);
  const lastSaveErrorNotifiedAtRef = useRef(0);
  const viewportCenterRef = useRef<{ x: number; y: number } | null>(null);
  const splashTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startupRunIdRef = useRef(0);
  const phoneSwipeStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const canvasAreas = useMemo(
    () => state.userData?.canvasAreas ?? [],
    [state.userData?.canvasAreas],
  );
  const visibleCanvasAreas = useMemo(
    () => (lookupDeckArea ? [...canvasAreas, lookupDeckArea] : canvasAreas),
    [canvasAreas, lookupDeckArea],
  );
  const cardOrientationMap = useMemo(
    () => cardNameToOrientationMap(state.cards),
    [state.cards],
  );

  const handleCanvasAreasChange = useCallback(
    (nextCanvasAreas: CanvasArea[]) => {
      const nextLookupArea =
        nextCanvasAreas.find((area) => area.lookupDeckId) ?? null;
      setLookupDeckArea(nextLookupArea);
      dispatch({
        type: 'SET_CANVAS_AREAS',
        canvasAreas: nextCanvasAreas.filter((area) => !area.lookupDeckId),
      });
    },
    [dispatch],
  );

  const handleCardsAddedToCanvasArea = useCallback(
    (canvasAreaId: string, cardNames: string[]) => {
      const targetArea = canvasAreas.find((area) => area.id === canvasAreaId);
      if (!targetArea || targetArea.type !== 'deck' || !targetArea.deckId) return;
      const addableCardNames = filterBlockedTokenCardNames(cardNames);
      if (addableCardNames.length === 0) return;
      dispatch({
        type: 'ADD_CARDS_TO_DECK_BY_ID',
        deckId: targetArea.deckId,
        cardNames: addableCardNames,
        board: 'mainboard',
      });
    },
    [canvasAreas, dispatch],
  );

  const createStackZone = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const canvasArea = createEmptyZone(
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
      const deckExists = state.userData?.decks.some((entry) => entry.id === deck.id) ?? false;
      if (!deckExists) {
        dispatch({ type: 'CREATE_DECK', deck });
      }
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
    [canvasAreas, cardOrientationMap, dispatch, state.userData?.decks],
  );

  const loadLookupDeck = useCallback(
    (deck: Deck) => {
      const lookupArea = createLookupDeckZone(deck, cardOrientationMap, canvasAreas);
      setLookupDeckArea(lookupArea);
      setFocusCanvasAreaRequest({ canvasAreaId: lookupArea.id, nonce: Date.now() });
    },
    [canvasAreas, cardOrientationMap],
  );

  const saveLookupDeck = useCallback(
    (deck: Deck) => {
      const canvasAreaId = createDeckZoneFromDeck(deck);
      setLookupDeckArea(null);
      if (canvasAreaId) {
        setFocusCanvasAreaRequest({ canvasAreaId, nonce: Date.now() });
      }
    },
    [createDeckZoneFromDeck],
  );

  const addCardsToCanvasAreaModel = useCallback(
    (
      area: CanvasArea,
      cardNames: string[],
      options?: { board?: DeckAddBoard; placements?: DeckAddPlacement[] },
    ): CanvasArea => {
      const existingStackNames =
        area.type === 'stack'
          ? new Set(area.cards.map((card) => card.cardName))
          : null;
      const queuedStackNames = new Set<string>();
      const placementQueueByName = new Map<string, DeckAddPlacement[]>();
      for (const placement of options?.placements ?? []) {
        const queue = placementQueueByName.get(placement.cardName) ?? [];
        queue.push(placement);
        placementQueueByName.set(placement.cardName, queue);
      }
      const headerHeight =
        area.type === 'deck' ? ZONE_DECK_HEADER_HEIGHT : ZONE_HEADER_HEIGHT;
      const startIndex = area.cards.length;
      const additions = cardNames
        .map((cardName, index) => {
          const trimmed = cardName.trim();
          if (!trimmed) return null;
          if (isBlockedTokenCardName(trimmed)) return null;
          if (
            area.type === 'stack' &&
            (existingStackNames?.has(trimmed) || queuedStackNames.has(trimmed))
          ) {
            return null;
          }
          if (area.type === 'stack') queuedStackNames.add(trimmed);
          const slot = startIndex + index;
          const placementQueue = placementQueueByName.get(trimmed);
          const placement = placementQueue?.shift() ?? null;
          const isLandscape =
            cardOrientationMap.get(trimmed)?.isLandscape ?? false;
          const cardSize = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
          const board: ActiveBoard | null =
            area.type === 'deck' ? options?.board ?? 'mainboard' : null;
          return {
            id: createZoneCardId(),
            cardName: trimmed,
            x: placement
              ? placement.centerX - cardSize.width / 2
              : area.bounds.x + 36 + (slot % 4) * DRAWN_GRID.width * 2,
            y: placement
              ? placement.centerY - cardSize.height / 2
              : area.bounds.y +
                headerHeight +
                36 +
                Math.floor(slot / 4) * DRAWN_GRID.height * 3,
            board,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      if (additions.length === 0) return area;

      const nextBounds = additions.reduce(
        (bounds, card) => {
          const isLandscape =
            cardOrientationMap.get(card.cardName)?.isLandscape ?? false;
          const cardSize = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
          const padding = 48;
          const left = Math.min(bounds.x, card.x - padding);
          const top = Math.min(bounds.y, card.y - padding);
          const right = Math.max(
            bounds.x + bounds.width,
            card.x + cardSize.width + padding,
          );
          const bottom = Math.max(
            bounds.y + bounds.height,
            card.y + cardSize.height + padding,
          );
          return {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
          };
        },
        area.bounds,
      );

      return { ...area, bounds: nextBounds, cards: [...area.cards, ...additions] };
    },
    [cardOrientationMap],
  );

  const queueDeckAddRequest = useCallback(
    (request: Omit<PendingDeckAddRequest, 'id'>) => {
      const cardNames = request.cardNames
        .map((cardName) => cardName.trim())
        .filter((cardName) => !!cardName && !isBlockedTokenCardName(cardName));
      if (cardNames.length === 0) return;
      pendingDeckAddIdRef.current += 1;
      setPendingDeckAdd({
        ...request,
        cardNames,
        id: pendingDeckAddIdRef.current,
      });
    },
    [],
  );

  const handleAddToActiveDeckRequest = useCallback(
    (cardName: string) => {
      const deckId = state.editor.activeDeckId;
      if (!deckId) return;
      if (isBlockedTokenCardName(cardName)) return;
      const canvasAreaId =
        canvasAreas.find((area) => area.type === 'deck' && area.deckId === deckId)?.id ??
        null;
      queueDeckAddRequest({
        deckId,
        canvasAreaId,
        cardNames: [cardName],
      });
    },
    [canvasAreas, queueDeckAddRequest, state.editor.activeDeckId],
  );

  const handleDeckAddRequest = useCallback(
    (payload: DeckAddRequestPayload) => {
      queueDeckAddRequest({
        deckId: payload.deckId,
        canvasAreaId: payload.canvasAreaId ?? null,
        cardNames: payload.cardNames,
        placements: payload.placements,
      });
    },
    [queueDeckAddRequest],
  );

  const commitPendingDeckAdd = useCallback(
    (board: DeckAddBoard) => {
      if (!pendingDeckAdd) return;

      if (pendingDeckAdd.deckToCreate) {
        const deckWithCards = addCardNamesToDeckBoard(
          pendingDeckAdd.deckToCreate,
          pendingDeckAdd.cardNames,
          board,
        );
        createDeckZoneFromDeck(deckWithCards);
        setPendingDeckAdd(null);
        return;
      }

      dispatch({
        type: 'ADD_CARDS_TO_DECK_BY_ID',
        deckId: pendingDeckAdd.deckId,
        cardNames: pendingDeckAdd.cardNames,
        board,
      });

      const canvasAreaId =
        pendingDeckAdd.canvasAreaId ??
        canvasAreas.find(
          (area) => area.type === 'deck' && area.deckId === pendingDeckAdd.deckId,
        )?.id ??
        null;
      if (canvasAreaId) {
        const nextCanvasAreas = canvasAreas.map((area) => {
          if (area.id !== canvasAreaId || area.type !== 'deck') return area;
          return addCardsToCanvasAreaModel(area, pendingDeckAdd.cardNames, {
            board,
            placements: pendingDeckAdd.placements,
          });
        });
        dispatch({ type: 'SET_CANVAS_AREAS', canvasAreas: nextCanvasAreas });
      }

      setPendingDeckAdd(null);
    },
    [
      addCardsToCanvasAreaModel,
      canvasAreas,
      createDeckZoneFromDeck,
      dispatch,
      pendingDeckAdd,
    ],
  );

  const handleQuickTransferCreateTarget = useCallback(
    (payload: {
      category: 'deck' | 'stack';
      cardNames: string[];
      clientX: number;
      clientY: number;
    }) => {
      if (payload.cardNames.length === 0) return;

      if (payload.category === 'stack') {
        const value = window.prompt('Stack name', '');
        if (value === null) return;
        const trimmed = value.trim();
        if (!trimmed) return;
        const stackArea = createEmptyZone(
          'stack',
          trimmed,
          canvasAreas.filter((entry) => entry.type === 'stack').length,
          canvasAreas,
        );
        const areaWithCards = addCardsToCanvasAreaModel(stackArea, payload.cardNames);
        dispatch({
          type: 'SET_CANVAS_AREAS',
          canvasAreas: [...canvasAreas, areaWithCards],
        });
        setFocusCanvasAreaRequest({ canvasAreaId: areaWithCards.id, nonce: Date.now() });
        return;
      }

      const avatarFallback: AvatarName = 'Animist';
      const avatarInput = window.prompt('Avatar name', avatarFallback);
      if (avatarInput === null) return;
      const avatarName = avatarInput.trim() as AvatarName;
      const safeAvatarName =
        avatarName in AVATAR_SHORT_NAMES ? avatarName : avatarFallback;
      const defaultName = `${getAvatarShortName(safeAvatarName)} Deck`;
      const deckNameInput = window.prompt('Deck name', defaultName);
      if (deckNameInput === null) return;
      const deckName = deckNameInput.trim();
      if (!deckName) return;

      const deck = createLocalDeck({
        name: deckName,
        avatarName: safeAvatarName,
      });
      queueDeckAddRequest({
        deckId: deck.id,
        cardNames: payload.cardNames,
        deckToCreate: deck,
      });
    },
    [
      addCardsToCanvasAreaModel,
      canvasAreas,
      dispatch,
      queueDeckAddRequest,
    ],
  );

  const setCanvasAreaPinned = useCallback((canvasAreaId: string, pinned: boolean) => {
    const nextCanvasAreas = canvasAreas.map((area) => {
      if (area.id !== canvasAreaId) return area;
      if (area.pinned === pinned) return area;
      if (!pinned) return { ...area, pinned: false };

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
    if (lookupDeckArea?.id === canvasAreaId) {
      setFocusCanvasAreaRequest({ canvasAreaId, nonce: Date.now() });
      return;
    }

    const nextCanvasAreas = canvasAreas.map((area) => {
      if (area.id !== canvasAreaId) return area;
      if (area.pinned) return area;
      return moveZoneIntoQuadrantPreservingCards(
        { ...area, pinned: true },
        canvasAreas.filter((entry) => entry.type === area.type && entry.pinned).length,
        canvasAreas,
      );
    });
    dispatch({ type: 'SET_CANVAS_AREAS', canvasAreas: nextCanvasAreas });
    setFocusCanvasAreaRequest({ canvasAreaId, nonce: Date.now() });
  }, [canvasAreas, dispatch, lookupDeckArea?.id]);

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

  const clearSplashTimers = useCallback(() => {
    for (const timerId of splashTimersRef.current) {
      clearTimeout(timerId);
    }
    splashTimersRef.current = [];
  }, []);

  const startApp = useCallback(() => {
    const runId = startupRunIdRef.current + 1;
    startupRunIdRef.current = runId;
    clearSplashTimers();
    setStartupState('loading');
    setStartupError(null);
    setSplashPhase('full');

    void initializeApp(dispatch).then((result) => {
      if (startupRunIdRef.current !== runId) return;

      if (!result.success) {
        setStartupState('error');
        setStartupError(result.error ?? 'Unknown error');
        setSplashPhase('done');
        return;
      }

      setStartupState('ready');

      splashTimersRef.current = [
        // 0.5s: splash becomes translucent so cards show through
        setTimeout(() => {
          if (startupRunIdRef.current === runId) setSplashPhase('transparent');
        }, 500),
        // 1.5s: splash starts fading out
        setTimeout(() => {
          if (startupRunIdRef.current === runId) setSplashPhase('fading');
        }, 1500),
        // 2.0s: splash removed
        setTimeout(() => {
          if (startupRunIdRef.current === runId) setSplashPhase('done');
        }, 2000),
      ];
    });
  }, [clearSplashTimers, dispatch]);

  useEffect(() => {
    if (!debugStartupGate) {
      startApp();
    }

    return () => {
      startupRunIdRef.current += 1;
      clearSplashTimers();
    };
  }, [clearSplashTimers, debugStartupGate, startApp]);

  const handleRetry = useCallback(() => {
    startApp();
  }, [startApp]);

  const handlePhoneTabToggle = useCallback((tab: PhoneTabId) => {
    setActivePhoneTab((previous) => togglePhoneTab(previous, tab));
  }, []);

  useEffect(() => {
    if (uiMode === 'desktop') {
      setActivePhoneTab(null);
    }
  }, [uiMode]);

  useEffect(() => {
    if (uiMode !== 'phone') {
      phoneSwipeStartRef.current = null;
      return;
    }

    const blocksPhoneSwipe = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      !!target.closest(
        'input, textarea, select, .modal, .bottom-folder-shell, .deck-filter-popover, .touch-action-sheet',
      );

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.pointerType === 'mouse') return;
      if (blocksPhoneSwipe(event.target)) return;
      phoneSwipeStartRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
    };

    const handlePointerUp = (event: PointerEvent) => {
      const start = phoneSwipeStartRef.current;
      phoneSwipeStartRef.current = null;
      if (!start || start.pointerId !== event.pointerId) return;

      const target = getPhoneSideSwipeTarget({
        current: activePhoneTab,
        startX: start.x,
        startY: start.y,
        endX: event.clientX,
        endY: event.clientY,
        viewportWidth: window.innerWidth,
      });

      if (target !== undefined) {
        setActivePhoneTab(target);
      }
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (phoneSwipeStartRef.current?.pointerId === event.pointerId) {
        phoneSwipeStartRef.current = null;
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [activePhoneTab, uiMode]);

  useEffect(() => {
    setLookupDeckArea(null);
  }, [
    state.ui.associationMode,
    state.ui.associationStyleId,
    state.ui.associationSubStyleId,
    state.ui.associationsEnabled,
  ]);

  useEffect(() => {
    if (!state.userData) return;

    // Always keep a local copy for offline use/recovery.
    saveUserData(state.userData).catch((error) => {
      console.error('Failed to save local user data:', error);
      const now = Date.now();
      if (now - lastSaveErrorNotifiedAtRef.current > SAVE_ERROR_NOTIFY_INTERVAL_MS) {
        lastSaveErrorNotifiedAtRef.current = now;
        dispatch({
          type: 'ADD_NOTIFICATION',
          notification: {
            type: 'error',
            message: 'Your changes could not be saved to browser storage.',
          },
        });
      }
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
    const userData = state.userData;
    if (!userData) return;

    const remoteToken =
      !state.session.isGuest &&
      state.session.token &&
      state.session.userId &&
      userData.id === state.session.userId
        ? state.session.token
        : null;

    const flush = () => {
      // Synchronous localStorage mirror survives tab close even when an
      // in-flight IndexedDB transaction would be aborted.
      mirrorUserDataToLocalStorage(userData);
      saveUserData(userData).catch(() => {
        // Mirror above already captured the snapshot.
      });
      if (remoteToken) {
        void flushSync(userData, remoteToken);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
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

  if (startupState === 'waiting') {
    return <SplashScreen className="splash-start-gate" onStart={startApp} />;
  }

  const splashClass =
    splashPhase === 'transparent' ? 'splash-transparent' :
    splashPhase === 'fading' ? 'splash-fade-out' : '';

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <div className={`app-container ui-${uiMode}`}>
        <PixiCanvas
          splashDone={splashPhase === 'done'}
          canvasAreas={visibleCanvasAreas}
          onCanvasAreasChange={handleCanvasAreasChange}
          onAddToDeckRequest={handleAddToActiveDeckRequest}
          onDeckAddRequest={handleDeckAddRequest}
          onCardsAddedToCanvasArea={handleCardsAddedToCanvasArea}
          onQuickTransferCreateTarget={handleQuickTransferCreateTarget}
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
          isPhone={uiMode === 'phone'}
          phoneExpanded={activePhoneTab === 'stacks'}
          onPhoneTabToggle={() => handlePhoneTabToggle('stacks')}
          onCreateStack={createStackZone}
          onSetCanvasAreaPinned={setCanvasAreaPinned}
          onFocusCanvasArea={focusCanvasArea}
          onRemoveCardFromStack={removeCardFromStack}
          openStackRequest={openStackRequest}
        />
        <DecksPanel
          canvasAreas={canvasAreas}
          isPhone={uiMode === 'phone'}
          phoneExpanded={activePhoneTab === 'decks'}
          onPhoneTabToggle={() => handlePhoneTabToggle('decks')}
          onCreateDeckZone={createDeckZoneFromDeck}
          onDeleteCanvasArea={deleteCanvasArea}
          onFocusCanvasArea={focusCanvasArea}
        />
        <BottomPanel
          isPhone={uiMode === 'phone'}
          phoneExpanded={activePhoneTab === 'filter'}
          onPhoneTabToggle={() => handlePhoneTabToggle('filter')}
          onLoadLookupDeck={loadLookupDeck}
          onSaveLookupDeck={saveLookupDeck}
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
        {pendingDeckAdd && (
          <BoardChoiceSheet
            cardCount={pendingDeckAdd.cardNames.length}
            deckName={
              pendingDeckAdd.deckToCreate?.name ??
              state.userData?.decks.find((deck) => deck.id === pendingDeckAdd.deckId)?.name ??
              'Deck'
            }
            onChoose={commitPendingDeckAdd}
            onCancel={() => setPendingDeckAdd(null)}
          />
        )}
      </div>
      {splashPhase !== 'done' && <SplashScreen className={splashClass} />}
    </AppContext.Provider>
  );
}

function SplashScreen({
  className,
  onStart,
}: {
  className: string;
  onStart?: () => void;
}) {
  const isStartGate = typeof onStart === 'function';

  return (
    <div className={`splash-screen ${className}`}>
      <div className="splash-content">
        <div className="splash-title">
          <span className="splash-title-sorcery">Sorcery</span>
          <span className="splash-title-stacks">Stacks</span>
        </div>
        {isStartGate ? (
          <button
            type="button"
            className="splash-start-button"
            onClick={onStart}
          >
            Tap to start
          </button>
        ) : (
          <div className="splash-bar">
            <div className="splash-bar-fill" />
          </div>
        )}
      </div>
    </div>
  );
}

function BoardChoiceSheet({
  cardCount,
  deckName,
  onChoose,
  onCancel,
}: {
  cardCount: number;
  deckName: string;
  onChoose: (board: DeckAddBoard) => void;
  onCancel: () => void;
}) {
  return (
    <div className="board-choice-backdrop" role="presentation">
      <div
        className="board-choice-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Choose deck board"
      >
        <div className="board-choice-header">
          <h2>Add to {deckName}</h2>
          <span>
            {cardCount} {cardCount === 1 ? 'card' : 'cards'}
          </span>
        </div>
        <div className="board-choice-actions">
          {BOARD_CHOICE_OPTIONS.map((option) => (
            <button
              key={option.board}
              type="button"
              onClick={() => onChoose(option.board)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="board-choice-cancel" onClick={onCancel}>
          Cancel
        </button>
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
