import { required } from '@/utils/required';
import { describe, expect, it } from 'vitest';
import { appReducer, initialAppState } from '@/app/AppState';
import { CANVAS_GRID_VERSION } from '@/data/canvasGridVersion';
import { createEmptyDeck, createGuestUserData, type UserData } from '@/data/dataModels';
import type { CanvasArea } from '@/canvas/canvasAreas';
import { DRAWN_GRID } from '@/rendering/Grid';

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
  it.each(['Guest', 'Alice'])('upgrades legacy %s geometry only once across saves and reloads', name => {
    const legacy: UserData = { id: name.toLowerCase(), name, decks: [], collection: [],
      canvasAreas: [stackArea({ type: 'deck', bounds: { x: -110, y: -220, width: 550, height: 660 },
        deckRegionBounds: { collection: { x: 0, y: 55, width: 440, height: 330 } },
        cards: [{ id: 'spell', cardName: 'Spell', x: 60, y: 67.5, board: 'collection', labelId: 'label' }],
      })],
      canvasLabels: [{ id: 'label', text: 'Collection cards', x: 55, y: 0, areaId: 'stack-1', board: 'collection' }],
    };
    const loaded = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: legacy });
    const saved = required(loaded.userData);
    const cell = DRAWN_GRID.width;
    expect(saved.gridVersion).toBe(CANVAS_GRID_VERSION);
    expect(saved.canvasAreas?.[0]).toMatchObject({
      bounds: { x: -2 * cell, y: -4 * cell, width: 10 * cell, height: 12 * cell },
      deckRegionBounds: { collection: { x: 0, y: cell, width: 8 * cell, height: 6 * cell } },
      cards: [{ id: 'spell', cardName: 'Spell', x: 2 * cell - 50, y: 2.5 * cell - 70, board: 'collection', labelId: 'label' }],
    });
    expect(saved.canvasLabels?.[0]).toMatchObject({ id: 'label', x: cell, y: 0, areaId: 'stack-1' });
    const reloaded = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: JSON.parse(JSON.stringify(saved)) as UserData });
    expect(reloaded.userData).toEqual(saved);
    expect(legacy.canvasAreas?.[0]?.cards[0]).toMatchObject({ x: 60, y: 67.5 });
    expect(legacy).not.toHaveProperty('gridVersion');
  });

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
    deck.boards.collection = [{ name: 'Spark', quantity: 1 }];
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
      board: 'collection',
      cardNames: ['Spark', 'Spark', 'Bolt'],
    });

    expect(next.userData?.decks[0]?.boards.collection).toEqual([
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

describe('appReducer catalogue preferences and label persistence', () => {
  it.each(['guest', 'account'])('round-trips deck region frames and the spacing upgrade in %s data', id => {
    const rect = {x: -200, y: -500, width: 440, height: 990};
    const userData = {...createGuestUserData(id), canvasAreas: [stackArea({type: 'deck', deckRegionBounds: {collection: rect}})]};
    const loaded = appReducer(initialAppState, {type: 'SET_USER_DATA', userData});
    const saved = appReducer(loaded, {type: 'SET_CANVAS_AREAS', canvasAreas: required(required(loaded.userData).canvasAreas)});
    const reloaded = appReducer(initialAppState, {type: 'SET_USER_DATA', userData: JSON.parse(JSON.stringify(saved.userData)) as UserData});
    expect(required(required(required(reloaded.userData).canvasAreas)[0]).deckRegionBounds).toEqual({collection: rect});
    expect(required(required(required(required(reloaded.userData).canvasAreas)[0]).deckRegionBounds).collection).not.toBe(rect);
  });
  it('persists the same layout preference for guest and account data without changing decks', () => {
    const deck = createEmptyDeck('Unchanged deck', 'deck-1');
    const loaded = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: { ...createGuestUserData('guest'), decks: [deck] } });
    const changed = appReducer(loaded, { type: 'SET_CATALOGUE_LAYOUT', layout: {
      columns: 8, steps: [{ field: 'family', mode: 'group', direction: 'asc' }, { field: 'name', mode: 'sort', direction: 'desc' }],
    } });
    expect(changed.userData?.catalogueLayout).toEqual(changed.ui.catalogueLayout);
    expect(changed.userData?.decks).toEqual(loaded.userData?.decks);
    const reloaded = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: JSON.parse(JSON.stringify(changed.userData)) as UserData });
    expect(reloaded.ui.catalogueLayout).toEqual(changed.ui.catalogueLayout);
  });

  it('round-trips label ownership, nested membership and new-card markers', () => {
    const userData: UserData = {
      ...createGuestUserData('guest'),
      canvasLabels: [{ id: 'label', text: 'Removal', x: 100, y: 200, areaId: 'deck', board: 'collection', parentLabelId: 'parent' }],
      canvasAreas: [stackArea({ id: 'deck', type: 'deck', cards: [{ id: 'card', cardName: 'Spark', x: 300, y: 200, board: 'collection', labelId: 'label', isNew: true }] })],
    };
    const loaded = appReducer(initialAppState, { type: 'SET_USER_DATA', userData });
    const saved = appReducer(loaded, { type: 'SET_CANVAS_AREAS', canvasAreas: loaded.userData?.canvasAreas ?? [] });
    const reloaded = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: JSON.parse(JSON.stringify(saved.userData)) as UserData });
    expect(reloaded.userData?.canvasLabels).toEqual(userData.canvasLabels);
    expect(reloaded.userData?.canvasAreas?.[0]?.cards).toEqual(userData.canvasAreas?.[0]?.cards);
  });

  it('routes newly added Main avatars to the avatar board while preserving explicit Collection targets', () => {
    const avatar = { name: 'Avatar', elements: '', subTypes: '', sets: [], guardian: { type: 'Avatar', rarity: 'Unique', rulesText: '', cost: null, attack: null, defence: null, life: 20, thresholds: { air: 0, earth: 0, fire: 0, water: 0 } } };
    const loaded = appReducer({ ...initialAppState, cards: [avatar] }, { type: 'SET_USER_DATA', userData: { ...createGuestUserData('guest'), decks: [createEmptyDeck('Deck', 'deck')] } });
    const main = appReducer(loaded, { type: 'ADD_CARDS_TO_DECK_BY_ID', deckId: 'deck', cardNames: ['Avatar', 'Spell'], board: 'mainboard' });
    expect(main.userData?.decks[0]?.boards.avatar).toEqual([{ name: 'Avatar', quantity: 1 }]);
    expect(main.userData?.decks[0]?.boards.mainboard).toEqual([{ name: 'Spell', quantity: 1 }]);
    const collection = appReducer(main, { type: 'ADD_CARDS_TO_DECK_BY_ID', deckId: 'deck', cardNames: ['Avatar'], board: 'collection' });
    expect(collection.userData?.decks[0]?.boards.collection).toEqual([{ name: 'Avatar', quantity: 1 }]);
  });
});
