import { describe, expect, it } from 'vitest';
import { appReducer, initialAppState } from '@/app/AppState';
import { createEmptyDeck, createGuestUserData, type UserData } from '@/data/dataModels';
import type { CanvasArea } from '@/canvas/canvasAreas';

function stackArea(overrides: Partial<CanvasArea> = {}): CanvasArea {
  return {
    id: 'stack-1',
    name: 'Draft Stack',
    type: 'stack',
    pinned: true,
    bounds: { x: 10, y: 20, width: 980, height: 780 },
    cards: [],
    ...overrides,
  };
}

describe('appReducer canvas areas', () => {
  it('normalizes user data to supported canvas area types', () => {
    const userData = {
      ...createGuestUserData('guest-1'),
      canvasAreas: [
        stackArea(),
        { ...stackArea({ id: 'unsupported-custom' }), type: 'custom' },
      ],
    } as unknown as UserData;

    const next = appReducer(initialAppState, {
      type: 'SET_USER_DATA',
      userData,
    });

    expect(next.userData?.canvasAreas?.map((area) => area.id)).toEqual(['stack-1']);
  });

  it('updates canvas areas through the dedicated reducer action', () => {
    const withUser = appReducer(initialAppState, {
      type: 'SET_USER_DATA',
      userData: createGuestUserData('guest-1'),
    });
    const deckArea = stackArea({
      id: 'deck-1',
      name: 'Imported Deck',
      type: 'deck',
      bounds: { x: -1400, y: -1200, width: 1400, height: 1200 },
      cardFilters: undefined,
    });

    const next = appReducer(withUser, {
      type: 'SET_CANVAS_AREAS',
      canvasAreas: [deckArea],
    });

    expect(next.userData?.canvasAreas).toHaveLength(1);
    expect(next.userData?.canvasAreas?.[0]?.id).toBe('deck-1');
  });

  it('normalizes optional lookup deck markers on canvas areas', () => {
    const withUser = appReducer(initialAppState, {
      type: 'SET_USER_DATA',
      userData: createGuestUserData('guest-1'),
    });
    const deckArea = stackArea({
      id: 'lookup-deck-1',
      name: 'Lookup Deck',
      type: 'deck',
      lookupDeckId: 'source-deck-1',
      bounds: { x: -1400, y: 200, width: 1400, height: 1200 },
      cardFilters: undefined,
    });

    const next = appReducer(withUser, {
      type: 'SET_CANVAS_AREAS',
      canvasAreas: [deckArea],
    });

    expect(next.userData?.canvasAreas?.[0]?.lookupDeckId).toBe('source-deck-1');
  });
});

describe('appReducer deck board additions', () => {
  it('adds multiple card names to the requested deck board by deck id', () => {
    const deck = createEmptyDeck('Avatar of Fire Deck', 'deck-1');
    deck.boards.avatar = [{ name: 'Avatar of Fire', quantity: 1 }];
    deck.boards.sideboard = [{ name: 'Spark', quantity: 1 }];
    const withUser = appReducer(initialAppState, {
      type: 'SET_USER_DATA',
      userData: {
        ...createGuestUserData('guest-1'),
        decks: [deck],
      },
    });

    const next = appReducer(withUser, {
      type: 'ADD_CARDS_TO_DECK_BY_ID',
      deckId: 'deck-1',
      board: 'sideboard',
      cardNames: ['Spark', 'Spark', 'Bolt'],
    });

    expect(next.userData?.decks[0]?.boards.sideboard).toEqual([
      { name: 'Spark', quantity: 3 },
      { name: 'Bolt', quantity: 1 },
    ]);
    expect(next.userData?.decks[0]?.boards.mainboard).toEqual([]);
  });

  it('does not add token cards to deck boards', () => {
    const deck = createEmptyDeck('Token Test', 'deck-1');
    const withUser = appReducer(initialAppState, {
      type: 'SET_USER_DATA',
      userData: {
        ...createGuestUserData('guest-1'),
        decks: [deck],
      },
    });

    const next = appReducer(withUser, {
      type: 'ADD_CARDS_TO_DECK_BY_ID',
      deckId: 'deck-1',
      cardNames: ['Frog', 'Skeleton', 'Foot Soldier 1', 'Gift of the Frog'],
    });

    expect(next.userData?.decks[0]?.boards.mainboard).toEqual([
      { name: 'Gift of the Frog', quantity: 1 },
    ]);
  });
});

describe('appReducer associations state', () => {
  it('clears category mode when associations are enabled', () => {
    const withCategory = appReducer(initialAppState, {
      type: 'SET_SELECTED_CARD_CATEGORY',
      categoryId: 'control',
    });

    const next = appReducer(withCategory, {
      type: 'SET_ASSOCIATIONS_ENABLED',
      enabled: true,
    });

    expect(next.ui.associationsEnabled).toBe(true);
    expect(next.ui.selectedCardCategory).toBeNull();
  });

  it('stores the selected association mode only in UI state', () => {
    const withStyle = appReducer(initialAppState, {
      type: 'SET_ASSOCIATION_STYLE',
      styleId: 'vanguard-pressure',
    });
    const next = appReducer(withStyle, {
      type: 'SET_ASSOCIATION_MODE',
      mode: 'fractional',
    });

    expect(next.ui.associationMode).toBe('fractional');
    expect(next.ui.associationStyleId).toBe('vanguard-pressure');
    expect(next.ui.associationSubStyleId).toBeNull();
    expect(next.userData).toBeNull();
  });

  it('clears the selected sub-style when style changes', () => {
    const withSubStyle = appReducer(
      appReducer(initialAppState, {
        type: 'SET_ASSOCIATION_STYLE',
        styleId: 'vanguard-pressure',
      }),
      {
        type: 'SET_ASSOCIATION_SUB_STYLE',
        subStyleId: 'burn-pressure',
      },
    );

    const next = appReducer(withSubStyle, {
      type: 'SET_ASSOCIATION_STYLE',
      styleId: 'spell-engine-control',
    });

    expect(next.ui.associationStyleId).toBe('spell-engine-control');
    expect(next.ui.associationSubStyleId).toBeNull();
  });

  it('clears selected style when associations close', () => {
    const withStyle = appReducer(
      appReducer(initialAppState, {
        type: 'SET_ASSOCIATION_STYLE',
        styleId: 'vanguard-pressure',
      }),
      {
        type: 'SET_ASSOCIATION_SUB_STYLE',
        subStyleId: 'burn-pressure',
      },
    );

    const closed = appReducer(withStyle, {
      type: 'SET_ASSOCIATIONS_ENABLED',
      enabled: false,
    });

    expect(closed.ui.associationStyleId).toBeNull();
    expect(closed.ui.associationSubStyleId).toBeNull();
  });

  it('persists card category data into user data', () => {
    const withUser = appReducer(initialAppState, {
      type: 'SET_USER_DATA',
      userData: createGuestUserData('guest-1'),
    });
    const next = appReducer(withUser, {
      type: 'SET_CARD_CATEGORIES',
      data: {
        version: 'test',
        categories: [],
        scores: {},
      },
    });

    expect(next.userData?.cardCategories?.version).toBe('test');
  });
});

describe('appReducer favourite lookup decks', () => {
  it('normalizes favourite deck ids from user data', () => {
    const next = appReducer(initialAppState, {
      type: 'SET_USER_DATA',
      userData: {
        ...createGuestUserData('guest-1'),
        favouriteDeckIds: ['deck-1', ' deck-2 ', 'deck-1', '', 'deck-3'],
      } as UserData,
    });

    expect(next.userData?.favouriteDeckIds).toEqual(['deck-1', 'deck-2', 'deck-3']);
  });

  it('toggles favourite deck ids in user data', () => {
    const withUser = appReducer(initialAppState, {
      type: 'SET_USER_DATA',
      userData: createGuestUserData('guest-1'),
    });
    const added = appReducer(withUser, {
      type: 'TOGGLE_FAVOURITE_DECK',
      deckId: 'deck-1',
    });
    const removed = appReducer(added, {
      type: 'TOGGLE_FAVOURITE_DECK',
      deckId: 'deck-1',
    });

    expect(added.userData?.favouriteDeckIds).toEqual(['deck-1']);
    expect(removed.userData?.favouriteDeckIds).toEqual([]);
  });
});
