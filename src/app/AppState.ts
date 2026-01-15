/**
 * Global application state management
 *
 * This module defines the central state store for the application.
 * React components subscribe to state changes; PixiJS reads state but doesn't modify it.
 */

import { createContext, useContext } from 'react';
import type {
  UserData,
  Card,
  Deck,
  ActiveBoard,
  CollectionItem,
} from '@/data/dataModels';

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
  sidePanelOpen: boolean;
  loginModalOpen: boolean;
  notifications: Notification[];
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
    sidePanelOpen: true,
    loginModalOpen: false,
    notifications: [],
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
  | { type: 'REMOVE_CARD_FROM_DECK'; cardName: string }
  | { type: 'CREATE_DECK'; deck: Deck }
  | { type: 'DELETE_DECK'; deckId: string }
  | { type: 'RENAME_DECK'; deckId: string; name: string }
  | { type: 'SET_COLLECTION'; collection: CollectionItem[] }
  | { type: 'TOGGLE_SIDE_PANEL' }
  | { type: 'TOGGLE_LOGIN_MODAL' }
  | { type: 'ADD_NOTIFICATION'; notification: Omit<Notification, 'id' | 'timestamp'> }
  | { type: 'DISMISS_NOTIFICATION'; id: string };

// ============================================================================
// Reducer
// ============================================================================

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CARDS':
      return { ...state, cards: action.cards, cardsLoaded: true };

    case 'SET_USER_DATA':
      return { ...state, userData: action.userData };

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

    case 'TOGGLE_SIDE_PANEL':
      return {
        ...state,
        ui: { ...state.ui, sidePanelOpen: !state.ui.sidePanelOpen },
      };

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

    default:
      return state;
  }
}

// ============================================================================
// Context
// ============================================================================

export interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

export const AppContext = createContext<AppContextValue | null>(null);

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

export function selectActiveDeck(state: AppState): Deck | null {
  if (!state.userData || !state.editor.activeDeckId) return null;
  return state.userData.decks.find((d) => d.id === state.editor.activeDeckId) ?? null;
}

export function selectCardByName(state: AppState, name: string): Card | null {
  return state.cards.find((c) => c.name === name) ?? null;
}

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

export function selectCollectionQuantity(state: AppState, cardName: string): number {
  if (!state.userData) return 0;
  const item = state.userData.collection.find((c) => c.name === cardName);
  return item?.quantity ?? 0;
}
