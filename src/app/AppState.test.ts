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
});
