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

describe('appReducer associations state', () => {
  it('clears archetype edit mode when associations are enabled', () => {
    const withArchetype = appReducer(initialAppState, {
      type: 'SET_SELECTED_ARCHETYPE',
      archetype: 'control',
    });

    const next = appReducer(withArchetype, {
      type: 'SET_ASSOCIATIONS_ENABLED',
      enabled: true,
    });

    expect(next.ui.associationsEnabled).toBe(true);
    expect(next.ui.selectedArchetype).toBeNull();
  });

  it('stores the selected association mode only in UI state', () => {
    const withGroup = appReducer(initialAppState, {
      type: 'SET_ASSOCIATION_CLUSTER_GROUP',
      groupId: 'avatar:a',
    });
    const next = appReducer(withGroup, {
      type: 'SET_ASSOCIATION_MODE',
      mode: 'meta',
    });

    expect(next.ui.associationMode).toBe('meta');
    expect(next.ui.associationClusterGroupId).toBeNull();
    expect(next.ui.associationClusterId).toBeNull();
    expect(next.userData).toBeNull();
  });

  it('clears the selected association cluster when cluster group changes', () => {
    const withCluster = appReducer(
      appReducer(initialAppState, {
        type: 'SET_ASSOCIATION_CLUSTER_GROUP',
        groupId: 'avatar:a',
      }),
      {
        type: 'SET_ASSOCIATION_CLUSTER',
        clusterId: 'cluster-1',
      },
    );

    const next = appReducer(withCluster, {
      type: 'SET_ASSOCIATION_CLUSTER_GROUP',
      groupId: 'avatar:b',
    });

    expect(next.ui.associationClusterGroupId).toBe('avatar:b');
    expect(next.ui.associationClusterId).toBeNull();
  });

  it('clears selected association clusters when source zone changes or associations close', () => {
    const withCluster = appReducer(
      appReducer(initialAppState, {
        type: 'SET_ASSOCIATION_CLUSTER_GROUP',
        groupId: 'avatar:a',
      }),
      {
        type: 'SET_ASSOCIATION_CLUSTER',
        clusterId: 'cluster-1',
      },
    );

    const withSource = appReducer(withCluster, {
      type: 'SET_ASSOCIATION_SOURCE_ZONE',
      sourceZone: 'collection',
    });
    const closed = appReducer(withCluster, {
      type: 'SET_ASSOCIATIONS_ENABLED',
      enabled: false,
    });

    expect(withSource.ui.associationClusterId).toBeNull();
    expect(withSource.ui.associationClusterGroupId).toBe('avatar:a');
    expect(closed.ui.associationClusterId).toBeNull();
    expect(closed.ui.associationClusterGroupId).toBeNull();
  });
});
