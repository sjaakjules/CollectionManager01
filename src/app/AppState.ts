import { ensureInteractionEffects, type InteractionEffectsSettings, type CanvasGestureCommand } from '@/data/interactionEffects';
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
  CardCategoryData,
} from '@/data/dataModels';
import type { CanvasDeckVariant, CanvasArea, CanvasAreaKind } from '@/canvas/canvasAreas';
import {
  createDefaultCardFilters,
  ensureCardFilterState,
  type CardFilterState,
} from '@/data/cardFilters';
import type { DeckStyleAssociationMode } from '@/data/deckStyleAssociations';
import { filterBlockedTokenCardNames } from '@/data/tokenCards';
import { detachLabelsFromAreas, normalizeDeckRemovals } from '@/data/deckRemovals';
import { normalizeUserDataBoards } from '@/data/boardMigration';
import { createDefaultCatalogueLayout, ensureCatalogueLayout, type CatalogueLayoutConfig } from '@/data/catalogueLayout';

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
  selectedCardCategory: string | null;
  labelPlacementMode: boolean;
  cardFilters: CardFilterState;
  catalogueLayout: CatalogueLayoutConfig;
  interactionEffects: InteractionEffectsSettings;
  canvasGesture: { command: CanvasGestureCommand; nonce: number } | null;
  selectedCardNames: string[];
  associationsEnabled: boolean;
  associationMode: DeckStyleAssociationMode;
  associationStyleId: string | null;
  associationSubStyleId: string | null;
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
    selectedCardCategory: null,
    labelPlacementMode: false,
    cardFilters: createDefaultCardFilters(),
    catalogueLayout: createDefaultCatalogueLayout(),
    interactionEffects: ensureInteractionEffects(null),
    canvasGesture: null,
    selectedCardNames: [],
    associationsEnabled: false,
    associationMode: 'primary',
    associationStyleId: null,
    associationSubStyleId: null,
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
  | { type: 'TOGGLE_FAVOURITE_DECK'; deckId: string }
  | { type: 'TOGGLE_LOGIN_MODAL' }
  | { type: 'ADD_NOTIFICATION'; notification: Omit<Notification, 'id' | 'timestamp'> }
  | { type: 'DISMISS_NOTIFICATION'; id: string }
  | { type: 'SET_SELECTED_CARD_CATEGORY'; categoryId: string | null }
  | { type: 'SET_LABEL_PLACEMENT_MODE'; enabled: boolean }
  | { type: 'SET_CARD_FILTERS'; filters: CardFilterState }
  | { type: 'SET_CATALOGUE_LAYOUT'; layout: CatalogueLayoutConfig }
  | { type: 'SET_INTERACTION_EFFECTS'; settings: InteractionEffectsSettings }
  | { type: 'RUN_CANVAS_GESTURE'; command: CanvasGestureCommand }
  | { type: 'CLEAR_CARD_FILTERS' }
  | { type: 'SET_SELECTED_CARD_NAMES'; names: string[] }
  | { type: 'SET_ASSOCIATIONS_ENABLED'; enabled: boolean }
  | { type: 'SET_ASSOCIATION_MODE'; mode: DeckStyleAssociationMode }
  | { type: 'SET_ASSOCIATION_STYLE'; styleId: string | null }
  | { type: 'SET_ASSOCIATION_SUB_STYLE'; subStyleId: string | null }
  | { type: 'SET_CANVAS_LABELS'; labels: CanvasLabel[] }
  | { type: 'SET_CARD_CATEGORIES'; data: CardCategoryData }
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
            selectedCardCategory: normalized.selectedCardCategory ?? null,
            catalogueLayout: ensureCatalogueLayout(normalized.catalogueLayout),
            interactionEffects: ensureInteractionEffects(normalized.interactionEffects),
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
      if (!state.editor.activeDeckId) return state;
      return appReducer(state, {
        type: 'ADD_CARDS_TO_DECK_BY_ID', deckId: state.editor.activeDeckId,
        cardNames: [action.cardName], board: state.editor.activeBoard,
      });
    }

    case 'ADD_CARDS_TO_DECK_BY_ID': {
      if (!state.userData || action.cardNames.length === 0) return state;
      const targetBoard = action.board ?? 'mainboard';
      const addableCardNames = filterBlockedTokenCardNames(action.cardNames);
      if (addableCardNames.length === 0) return state;

      const updatedDecks = state.userData.decks.map((deck) => {
        if (deck.id !== action.deckId) return deck;

        const boards = { ...deck.boards };
        const additions = new Map<ActiveBoard, Map<string, number>>();
        for (const rawName of addableCardNames) {
          const name = rawName.trim();
          if (!name) continue;
          const board = targetBoard === 'mainboard' && state.cards.some((card) => card.name === name && card.guardian.type === 'Avatar') ? 'avatar' : targetBoard;
          const quantities = additions.get(board) ?? new Map<string, number>();
          quantities.set(name, (quantities.get(name) ?? 0) + 1);
          additions.set(board, quantities);
        }
        if (!additions.size) return deck;
        for (const [board, quantities] of additions) {
          const updated = boards[board].map((card) => ({ ...card }));
          for (const [name, quantity] of quantities) {
            const existing = updated.find((card) => card.name === name);
            if (existing) existing.quantity += quantity;
            else updated.push({ name, quantity });
          }
          boards[board] = updated;
        }
        return { ...deck, boards, updatedAt: new Date().toISOString() };
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
      const restoring = !!state.userData.removedDecks?.[action.deck.id];
      const removedDecks = Object.fromEntries(Object.entries(state.userData.removedDecks ?? {})
        .filter(([id]) => id !== action.deck.id));
      return {
        ...state,
        userData: {
          ...state.userData,
          removedDecks,
          // Re-importing through + marks an existing deck as personal without
          // replacing its local edits or adding a duplicate remote ID.
          decks: state.userData.decks.some((deck) => deck.id === action.deck.id)
            ? state.userData.decks.map((deck) => deck.id === action.deck.id && action.deck.origin === 'user'
              ? { ...deck, origin: 'user' as const }
              : deck)
            : [...state.userData.decks, restoring ? { ...action.deck, updatedAt: new Date().toISOString() } : action.deck],
        },
      };
    }

    case 'DELETE_DECK': {
      if (!state.userData) return state;
      const updatedDecks = state.userData.decks.filter((d) => d.id !== action.deckId);
      const removedAreaIds = new Set((state.userData.canvasAreas ?? [])
        .filter((area) => area.type === 'deck' && (area.deckId ?? area.id) === action.deckId)
        .map((area) => area.id));
      return {
        ...state,
        userData: {
          ...state.userData,
          decks: updatedDecks,
          removedDecks: { ...state.userData.removedDecks, [action.deckId]: new Date().toISOString() },
          canvasAreas: state.userData.canvasAreas?.filter((area) =>
            area.type !== 'deck' || (area.deckId ?? area.id) !== action.deckId),
          canvasLabels: detachLabelsFromAreas(state.userData.canvasLabels ?? [], removedAreaIds),
        },
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

    case 'TOGGLE_FAVOURITE_DECK': {
      if (!state.userData) return state;
      const deckId = action.deckId.trim();
      if (!deckId) return state;
      const currentIds = normalizeStringList(state.userData.favouriteDeckIds);
      const favouriteDeckIds = currentIds.includes(deckId)
        ? currentIds.filter((id) => id !== deckId)
        : [...currentIds, deckId];

      return {
        ...state,
        userData: { ...state.userData, favouriteDeckIds },
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

    case 'SET_SELECTED_CARD_CATEGORY': {
      const nextCategory =
        state.ui.selectedCardCategory === action.categoryId ? null : action.categoryId;
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedCardCategory: nextCategory,
          associationsEnabled: nextCategory ? false : state.ui.associationsEnabled,
        },
        userData: state.userData
          ? { ...state.userData, selectedCardCategory: nextCategory }
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

    case 'RUN_CANVAS_GESTURE':
      return { ...state, ui: { ...state.ui, canvasGesture: { command: action.command, nonce: (state.ui.canvasGesture?.nonce ?? 0) + 1 } } };

    case 'SET_INTERACTION_EFFECTS': {
      const interactionEffects = ensureInteractionEffects(action.settings);
      return { ...state, ui: { ...state.ui, interactionEffects }, userData: state.userData ? { ...state.userData, interactionEffects } : state.userData };
    }

    case 'SET_CATALOGUE_LAYOUT': {
      const catalogueLayout = ensureCatalogueLayout(action.layout);
      return {
        ...state,
        ui: { ...state.ui, catalogueLayout },
        userData: state.userData ? { ...state.userData, catalogueLayout } : state.userData,
      };
    }

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
          associationStyleId: action.enabled ? state.ui.associationStyleId : null,
          associationSubStyleId: action.enabled ? state.ui.associationSubStyleId : null,
          selectedCardCategory: action.enabled ? null : state.ui.selectedCardCategory,
        },
        userData:
          action.enabled && state.userData
            ? { ...state.userData, selectedCardCategory: null }
            : state.userData,
      };

    case 'SET_ASSOCIATION_MODE':
      return {
        ...state,
        ui: {
          ...state.ui,
          associationMode: action.mode,
          associationSubStyleId: null,
        },
      };

    case 'SET_ASSOCIATION_STYLE':
      return {
        ...state,
        ui: {
          ...state.ui,
          associationStyleId: action.styleId,
          associationSubStyleId: null,
        },
      };

    case 'SET_ASSOCIATION_SUB_STYLE':
      return {
        ...state,
        ui: {
          ...state.ui,
          associationSubStyleId: action.subStyleId,
        },
      };

    case 'SET_CANVAS_LABELS':
      if (!state.userData) return state;
      return {
        ...state,
        userData: { ...state.userData, canvasLabels: action.labels },
      };

    case 'SET_CARD_CATEGORIES':
      if (!state.userData) return state;
      return {
        ...state,
        userData: { ...state.userData, cardCategories: action.data },
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

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  return Array.from(new Set(entries));
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
          board === 'collection' ||
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
          labelId: parseString(cardRecord.labelId).trim() || undefined,
          isNew: cardRecord.isNew === true || undefined,
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
      lookupDeckId: parseString(areaRecord.lookupDeckId).trim() || null,
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

function normalizeUserData(raw: UserData): UserData {
  const userData = normalizeUserDataBoards(raw);
  return {
    name: userData.name,
    id: userData.id,
    decks: userData.decks,
    removedDecks: normalizeDeckRemovals(userData.removedDecks),
    collection: userData.collection,
    selectedCardCategory: userData.selectedCardCategory ?? null,
    cardCategories: userData.cardCategories,
    favouriteDeckIds: normalizeStringList(userData.favouriteDeckIds),
    canvasLabels: userData.canvasLabels ?? [],
    canvasAreas: normalizeCanvasAreas(userData.canvasAreas),
    catalogueLayout: ensureCatalogueLayout(userData.catalogueLayout),
    interactionEffects: ensureInteractionEffects(userData.interactionEffects),
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
 * - Returns total quantity across `mainboard`, `collection`, and `avatar`.
 */
export function selectTotalDeckCardQuantity(state: AppState, cardName: string): number {
  const deck = selectActiveDeck(state);
  if (!deck) return 0;

  let total = 0;
  for (const board of ['mainboard', 'collection', 'avatar'] as const) {
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
