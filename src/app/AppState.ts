/**
 * Global application state management
 *
 * This module defines the central state store for the application.
 * React components subscribe to state changes; PixiJS reads state but doesn't modify it.
 *
 * Related files:
 * - `src/app/App.tsx` (provider + dispatch wiring)
 * - `src/app/Startup.ts` (initial state hydration)
 * - `src/data/dataModels.ts` (persisted domain types)
 * - `src/canvas/canvasAreas.ts` (canvas area normalization)
 */

import { createContext, useContext } from 'react';
import type {
  UserData,
  Card,
  Deck,
  ActiveBoard,
  CollectionItem,
  CanvasLabel,
  ArchetypeScoresData,
} from '@/data/dataModels';
import type { CanvasDeckVariant, CanvasArea, CanvasAreaKind } from '@/canvas/canvasAreas';
import {
  createDefaultCardFilters,
  ensureCardFilterState,
  type CardFilterState,
} from '@/data/cardFilters';
import type { AssociationSourceZone } from '@/data/cardAssociations';

// ============================================================================
// State Shape
// ============================================================================

export interface AppState {
  // User session
  session: SessionState;

  // Card database (loaded from API)
  cards: Card[];
  cardsLoaded: boolean;

  // User data (decks + collection)
  userData: UserData | null;

  // Active deck editing
  editor: EditorState;

  // UI state
  ui: UIState;
}

export interface SessionState {
  isGuest: boolean;
  userId: string | null;
  username: string | null;
  token: string | null;
}

export interface EditorState {
  activeDeckId: string | null;
  activeBoard: ActiveBoard;
}

export interface UIState {
  loginModalOpen: boolean;
  notifications: Notification[];
  selectedArchetype: string | null;
  labelPlacementMode: boolean;
  cardFilters: CardFilterState;
  selectedCardNames: string[];
  associationsEnabled: boolean;
  associationSourceZone: AssociationSourceZone;
}

export interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error';
  message: string;
  timestamp: number;
}

// ============================================================================
// Initial State
// ============================================================================

export const initialAppState: AppState = {
  session: {
    isGuest: true,
    userId: null,
    username: null,
    token: null,
  },
  cards: [],
  cardsLoaded: false,
  userData: null,
  editor: {
    activeDeckId: null,
    activeBoard: 'mainboard',
  },
  ui: {
    loginModalOpen: false,
    notifications: [],
    selectedArchetype: null,
    labelPlacementMode: false,
    cardFilters: createDefaultCardFilters(),
    selectedCardNames: [],
    associationsEnabled: false,
    associationSourceZone: 'main',
  },
};

// ============================================================================
// Actions
// ============================================================================

export type AppAction =
  | { type: 'SET_CARDS'; cards: Card[] }
  | { type: 'SET_USER_DATA'; userData: UserData }
  | { type: 'SET_SESSION'; session: SessionState }
  | { type: 'SET_ACTIVE_DECK'; deckId: string | null }
  | { type: 'SET_ACTIVE_BOARD'; board: ActiveBoard }
  | { type: 'ADD_CARD_TO_DECK'; cardName: string }
  | { type: 'ADD_CARDS_TO_DECK_BY_ID'; deckId: string; cardNames: string[]; board?: ActiveBoard }
  | { type: 'REMOVE_CARD_FROM_DECK'; cardName: string }
  | { type: 'CREATE_DECK'; deck: Deck }
  | { type: 'DELETE_DECK'; deckId: string }
  | { type: 'RENAME_DECK'; deckId: string; name: string }
  | { type: 'SET_COLLECTION'; collection: CollectionItem[] }
  | { type: 'TOGGLE_LOGIN_MODAL' }
  | { type: 'ADD_NOTIFICATION'; notification: Omit<Notification, 'id' | 'timestamp'> }
  | { type: 'DISMISS_NOTIFICATION'; id: string }
  | { type: 'SET_SELECTED_ARCHETYPE'; archetype: string | null }
  | { type: 'SET_LABEL_PLACEMENT_MODE'; enabled: boolean }
  | { type: 'SET_CARD_FILTERS'; filters: CardFilterState }
  | { type: 'CLEAR_CARD_FILTERS' }
  | { type: 'SET_SELECTED_CARD_NAMES'; names: string[] }
  | { type: 'SET_ASSOCIATIONS_ENABLED'; enabled: boolean }
  | { type: 'SET_ASSOCIATION_SOURCE_ZONE'; sourceZone: AssociationSourceZone }
  | { type: 'SET_CANVAS_LABELS'; labels: CanvasLabel[] }
  | { type: 'SET_ARCHETYPE_SCORES'; scores: ArchetypeScoresData }
  | { type: 'SET_CANVAS_AREAS'; canvasAreas: CanvasArea[] };

// ============================================================================
// Reducer
// ============================================================================

/**
 * Main reducer for all app-level state transitions.
 *
 * Inputs:
 * - `state`: Current immutable app state snapshot.
 * - `action`: Discriminated action payload describing a state transition.
 *
 * Outputs:
 * - Returns the next immutable `AppState`.
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CARDS':
      return { ...state, cards: action.cards, cardsLoaded: true };

    case 'SET_USER_DATA':
      {
        const normalized = normalizeUserData(action.userData);
        return {
          ...state,
          userData: normalized,
          ui: {
            ...state.ui,
            selectedArchetype: normalized.selectedArchetype ?? null,
          },
        };
      }

    case 'SET_SESSION':
      return { ...state, session: action.session };

    case 'SET_ACTIVE_DECK':
      return {
        ...state,
        editor: { ...state.editor, activeDeckId: action.deckId },
      };

    case 'SET_ACTIVE_BOARD':
      return {
        ...state,
        editor: { ...state.editor, activeBoard: action.board },
      };

    case 'ADD_CARD_TO_DECK': {
      if (!state.userData || !state.editor.activeDeckId) return state;

      const updatedDecks = state.userData.decks.map((deck) => {
        if (deck.id !== state.editor.activeDeckId) return deck;

        const board = deck.boards[state.editor.activeBoard];
        const existingCard = board.find((c) => c.name === action.cardName);

        const updatedBoard = existingCard
          ? board.map((c) =>
              c.name === action.cardName ? { ...c, quantity: c.quantity + 1 } : c
            )
          : [...board, { name: action.cardName, quantity: 1 }];

        return {
          ...deck,
          boards: { ...deck.boards, [state.editor.activeBoard]: updatedBoard },
          updatedAt: new Date().toISOString(),
        };
      });

      return {
        ...state,
        userData: { ...state.userData, decks: updatedDecks },
      };
    }

    case 'ADD_CARDS_TO_DECK_BY_ID': {
      if (!state.userData || action.cardNames.length === 0) return state;
      const targetBoard = action.board ?? 'mainboard';

      const updatedDecks = state.userData.decks.map((deck) => {
        if (deck.id !== action.deckId) return deck;

        const quantities = new Map<string, number>();
        for (const cardName of action.cardNames) {
          const trimmed = cardName.trim();
          if (!trimmed) continue;
          quantities.set(trimmed, (quantities.get(trimmed) ?? 0) + 1);
        }
        if (quantities.size === 0) return deck;

        const board = deck.boards[targetBoard];
        let updatedBoard = [...board];
        for (const [cardName, quantity] of quantities) {
          const existingIndex = updatedBoard.findIndex((card) => card.name === cardName);
          if (existingIndex >= 0) {
            const existing = updatedBoard[existingIndex];
            if (!existing) continue;
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
          boards: { ...deck.boards, [targetBoard]: updatedBoard },
          updatedAt: new Date().toISOString(),
        };
      });

      return {
        ...state,
        userData: { ...state.userData, decks: updatedDecks },
      };
    }

    case 'REMOVE_CARD_FROM_DECK': {
      if (!state.userData || !state.editor.activeDeckId) return state;

      const updatedDecks = state.userData.decks.map((deck) => {
        if (deck.id !== state.editor.activeDeckId) return deck;

        const board = deck.boards[state.editor.activeBoard];
        const updatedBoard = board
          .map((c) =>
            c.name === action.cardName ? { ...c, quantity: c.quantity - 1 } : c
          )
          .filter((c) => c.quantity > 0);

        return {
          ...deck,
          boards: { ...deck.boards, [state.editor.activeBoard]: updatedBoard },
          updatedAt: new Date().toISOString(),
        };
      });

      return {
        ...state,
        userData: { ...state.userData, decks: updatedDecks },
      };
    }

    case 'CREATE_DECK': {
      if (!state.userData) return state;
      return {
        ...state,
        userData: {
          ...state.userData,
          decks: [...state.userData.decks, action.deck],
        },
      };
    }

    case 'DELETE_DECK': {
      if (!state.userData) return state;
      const updatedDecks = state.userData.decks.filter((d) => d.id !== action.deckId);
      return {
        ...state,
        userData: { ...state.userData, decks: updatedDecks },
        editor:
          state.editor.activeDeckId === action.deckId
            ? { ...state.editor, activeDeckId: null }
            : state.editor,
      };
    }

    case 'RENAME_DECK': {
      if (!state.userData) return state;
      const updatedDecks = state.userData.decks.map((d) =>
        d.id === action.deckId
          ? { ...d, name: action.name, updatedAt: new Date().toISOString() }
          : d
      );
      return {
        ...state,
        userData: { ...state.userData, decks: updatedDecks },
      };
    }

    case 'SET_COLLECTION': {
      if (!state.userData) return state;
      return {
        ...state,
        userData: { ...state.userData, collection: action.collection },
      };
    }

    case 'TOGGLE_LOGIN_MODAL':
      return {
        ...state,
        ui: { ...state.ui, loginModalOpen: !state.ui.loginModalOpen },
      };

    case 'ADD_NOTIFICATION': {
      const notification: Notification = {
        ...action.notification,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      };
      return {
        ...state,
        ui: {
          ...state.ui,
          notifications: [...state.ui.notifications, notification],
        },
      };
    }

    case 'DISMISS_NOTIFICATION':
      return {
        ...state,
        ui: {
          ...state.ui,
          notifications: state.ui.notifications.filter((n) => n.id !== action.id),
        },
      };

    case 'SET_SELECTED_ARCHETYPE': {
      const nextArchetype =
        state.ui.selectedArchetype === action.archetype ? null : action.archetype;
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedArchetype: nextArchetype,
          associationsEnabled: nextArchetype ? false : state.ui.associationsEnabled,
        },
        userData: state.userData
          ? { ...state.userData, selectedArchetype: nextArchetype }
          : state.userData,
      };
    }

    case 'SET_LABEL_PLACEMENT_MODE':
      return {
        ...state,
        ui: { ...state.ui, labelPlacementMode: action.enabled },
      };

    case 'SET_CARD_FILTERS':
      return {
        ...state,
        ui: { ...state.ui, cardFilters: ensureCardFilterState(action.filters) },
      };

    case 'CLEAR_CARD_FILTERS':
      return {
        ...state,
        ui: { ...state.ui, cardFilters: createDefaultCardFilters() },
      };

    case 'SET_SELECTED_CARD_NAMES':
      return {
        ...state,
        ui: { ...state.ui, selectedCardNames: action.names },
      };

    case 'SET_ASSOCIATIONS_ENABLED':
      return {
        ...state,
        ui: {
          ...state.ui,
          associationsEnabled: action.enabled,
          associationSourceZone: action.enabled ? state.ui.associationSourceZone : 'main',
          selectedArchetype: action.enabled ? null : state.ui.selectedArchetype,
        },
        userData:
          action.enabled && state.userData
            ? { ...state.userData, selectedArchetype: null }
            : state.userData,
      };

    case 'SET_ASSOCIATION_SOURCE_ZONE':
      return {
        ...state,
        ui: { ...state.ui, associationSourceZone: action.sourceZone },
      };

    case 'SET_CANVAS_LABELS':
      if (!state.userData) return state;
      return {
        ...state,
        userData: { ...state.userData, canvasLabels: action.labels },
      };

    case 'SET_ARCHETYPE_SCORES':
      if (!state.userData) return state;
      return {
        ...state,
        userData: { ...state.userData, archetypeScores: action.scores },
      };

    case 'SET_CANVAS_AREAS':
      if (!state.userData) return state;
      return {
        ...state,
        userData: {
          ...state.userData,
          canvasAreas: normalizeCanvasAreas(action.canvasAreas),
        },
      };

    default:
      return state;
  }
}

function parseFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseCanvasAreaKind(value: unknown): CanvasAreaKind | null {
  if (value === 'deck') {
    return 'deck';
  }
  if (value === 'stack') {
    return 'stack';
  }
  return null;
}

function defaultCanvasAreaSize(type: CanvasAreaKind): { width: number; height: number } {
  if (type === 'deck') return { width: 1400, height: 1200 };
  return { width: 980, height: 780 };
}

function createFallbackId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCanvasAreas(value: unknown): CanvasArea[] {
  if (!Array.isArray(value)) return [];

  const canvasAreas: CanvasArea[] = [];
  for (const rawArea of value) {
    if (!rawArea || typeof rawArea !== 'object') continue;
    const areaRecord = rawArea as Record<string, unknown>;
    const type = parseCanvasAreaKind(areaRecord.type);
    if (!type) continue;
    const defaults = defaultCanvasAreaSize(type);
    const boundsRecord =
      areaRecord.bounds && typeof areaRecord.bounds === 'object'
        ? (areaRecord.bounds as Record<string, unknown>)
        : null;

    const cardsRaw = Array.isArray(areaRecord.cards) ? areaRecord.cards : [];
    const cards = cardsRaw
      .map((rawCard) => {
        if (!rawCard || typeof rawCard !== 'object') return null;
        const cardRecord = rawCard as Record<string, unknown>;
        const cardName = parseString(cardRecord.cardName).trim();
        if (!cardName) return null;
        const board = parseString(cardRecord.board);
        let normalizedBoard: ActiveBoard | null = null;
        if (
          board === 'mainboard' ||
          board === 'sideboard' ||
          board === 'avatar' ||
          board === 'maybeboard'
        ) {
          normalizedBoard = board;
        }
        return {
          id: parseString(cardRecord.id, createFallbackId('canvas-card')),
          cardName,
          x: parseFiniteNumber(cardRecord.x, 0),
          y: parseFiniteNumber(cardRecord.y, 0),
          board: normalizedBoard,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const deckVariantsRaw = Array.isArray(areaRecord.deckVariants)
      ? areaRecord.deckVariants
      : [];
    const deckVariants: CanvasDeckVariant[] = deckVariantsRaw
      .map((rawVariant, index) => {
        if (!rawVariant || typeof rawVariant !== 'object') return null;
        const variantRecord = rawVariant as Record<string, unknown>;
        const activeCardIdsRaw = Array.isArray(variantRecord.activeCardIds)
          ? variantRecord.activeCardIds
          : [];
        const activeCardIds = activeCardIdsRaw
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean);
        const fallbackName = index === 0 ? 'Main' : `Variant ${index + 1}`;
        return {
          id: parseString(variantRecord.id, createFallbackId('canvas-variant')),
          name: parseString(variantRecord.name, fallbackName).trim() || fallbackName,
          activeCardIds,
        };
      })
      .filter((entry): entry is CanvasDeckVariant => entry !== null);
    const cardFilters =
      type === 'deck' ? ensureCardFilterState(areaRecord.cardFilters) : undefined;

    canvasAreas.push({
      id: parseString(areaRecord.id, createFallbackId('canvas-area')),
      name: parseString(areaRecord.name, type === 'deck' ? 'Deck' : 'Stack'),
      type,
      pinned: areaRecord.pinned !== false,
      bounds: {
        x: parseFiniteNumber(boundsRecord?.x, 0),
        y: parseFiniteNumber(boundsRecord?.y, 0),
        width: parseFiniteNumber(boundsRecord?.width, defaults.width),
        height: parseFiniteNumber(boundsRecord?.height, defaults.height),
      },
      cards,
      deckId: parseString(areaRecord.deckId).trim() || undefined,
      avatarCardName:
        typeof areaRecord.avatarCardName === 'string'
          ? areaRecord.avatarCardName
          : null,
      deckAuthor:
        typeof areaRecord.deckAuthor === 'string'
          ? areaRecord.deckAuthor
          : null,
      deckVariants,
      activeDeckVariantId: parseString(areaRecord.activeDeckVariantId).trim() || null,
      cardFilters,
    });
  }

  return canvasAreas;
}

function normalizeUserData(userData: UserData): UserData {
  return {
    name: userData.name,
    id: userData.id,
    decks: userData.decks,
    collection: userData.collection,
    selectedArchetype: userData.selectedArchetype ?? null,
    archetypeScores: userData.archetypeScores,
    canvasLabels: userData.canvasLabels ?? [],
    canvasAreas: normalizeCanvasAreas(userData.canvasAreas),
  };
}

// ============================================================================
// Context
// ============================================================================

export interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

export const AppContext = createContext<AppContextValue | null>(null);

/**
 * React hook for consuming app state context.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - Returns `{ state, dispatch }` from `AppContext`.
 * - Throws if called outside `AppContext.Provider`.
 */
export function useAppState(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppState must be used within AppProvider');
  }
  return context;
}

// ============================================================================
// Selectors
// ============================================================================

/**
 * Resolve the currently active deck from reducer state.
 *
 * Inputs:
 * - `state`: Current app state.
 *
 * Outputs:
 * - Returns the active `Deck` when available, otherwise `null`.
 */
export function selectActiveDeck(state: AppState): Deck | null {
  if (!state.userData || !state.editor.activeDeckId) return null;
  return state.userData.decks.find((d) => d.id === state.editor.activeDeckId) ?? null;
}

/**
 * Lookup a card by its exact name from the loaded card index.
 *
 * Inputs:
 * - `state`: Current app state.
 * - `name`: Card name to match.
 *
 * Outputs:
 * - Returns the matched `Card`, otherwise `null`.
 */
export function selectCardByName(state: AppState, name: string): Card | null {
  return state.cards.find((c) => c.name === name) ?? null;
}

/**
 * Get quantity of a card in a specific board (or active board by default).
 *
 * Inputs:
 * - `state`: Current app state.
 * - `cardName`: Card name to count.
 * - `board`: Optional board override.
 *
 * Outputs:
 * - Returns quantity for that board, or `0` when unavailable.
 */
export function selectDeckCardQuantity(
  state: AppState,
  cardName: string,
  board?: ActiveBoard
): number {
  const deck = selectActiveDeck(state);
  if (!deck) return 0;

  const targetBoard = board ?? state.editor.activeBoard;
  const card = deck.boards[targetBoard].find((c) => c.name === cardName);
  return card?.quantity ?? 0;
}

/**
 * Get aggregate quantity of a card across deck boards tracked by rules.
 *
 * Inputs:
 * - `state`: Current app state.
 * - `cardName`: Card name to count.
 *
 * Outputs:
 * - Returns total quantity across `mainboard`, `sideboard`, and `avatar`.
 */
export function selectTotalDeckCardQuantity(state: AppState, cardName: string): number {
  const deck = selectActiveDeck(state);
  if (!deck) return 0;

  let total = 0;
  for (const board of ['mainboard', 'sideboard', 'avatar'] as const) {
    const card = deck.boards[board].find((c) => c.name === cardName);
    if (card) total += card.quantity;
  }
  return total;
}

/**
 * Get quantity of a card owned in the user collection.
 *
 * Inputs:
 * - `state`: Current app state.
 * - `cardName`: Card name to count.
 *
 * Outputs:
 * - Returns collection quantity or `0` when missing.
 */
export function selectCollectionQuantity(state: AppState, cardName: string): number {
  if (!state.userData) return 0;
  const item = state.userData.collection.find((c) => c.name === cardName);
  return item?.quantity ?? 0;
}
