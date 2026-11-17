import { describe, expect, it } from 'vitest';
import { mergeUserData } from '@/data/userSync';
import { CANVAS_GRID_VERSION } from '@/data/canvasGridVersion';
import { createEmptyDeck, type UserData } from '@/data/dataModels';
import type { CanvasArea } from '@/canvas/canvasAreas';
import { DRAWN_GRID } from '@/rendering/Grid';

function userData(id: string, name: string): UserData {
  return {
    id,
    name,
    decks: [],
    collection: [],
    selectedCardCategory: null,
    favouriteDeckIds: [],
    canvasLabels: [],
    canvasAreas: [],
  };
}

function canvasArea(id: string, type: CanvasArea['type']): CanvasArea {
  return {
    id,
    name: type === 'deck' ? 'Deck Canvas' : 'Stack',
    type,
    pinned: true,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    cards: [],
  };
}

describe('mergeUserData', () => {
  const legacyGrids = [[undefined, 55], [2, 75], [3, 65]] as const;
  const legacyMerges = legacyGrids.flatMap(([gridVersion, oldCell]) => [false, true].map(legacyServer => ({ gridVersion, oldCell, legacyServer })));
  it.each(legacyMerges)('brings both stores onto the current grid (legacy v$gridVersion, server=$legacyServer)', ({ gridVersion, oldCell, legacyServer }) => {
    const cell = DRAWN_GRID.width;
    const currentArea: CanvasArea = { ...canvasArea('current', 'deck'),
      bounds: { x: cell, y: 2 * cell, width: 10 * cell, height: 12 * cell },
      cards: [{ id: 'spell', cardName: 'Spell', x: 2 * cell - 50, y: 2.5 * cell - 70, board: 'mainboard' }],
    };
    const current: UserData = { ...userData('current', 'Current'), gridVersion: CANVAS_GRID_VERSION,
      canvasAreas: [currentArea], canvasLabels: [{ id: 'current-label', text: 'Current', x: 2 * cell, y: 4 * cell }],
    };
    const legacy: UserData = { ...userData('legacy', 'Legacy'), gridVersion,
      canvasAreas: [{ ...canvasArea('legacy', 'deck'), bounds: { x: -2 * oldCell, y: -4 * oldCell, width: 10 * oldCell, height: 12 * oldCell },
        cards: [{ id: 'site', cardName: 'Site', x: 3.5 * oldCell - 70, y: 3 * oldCell - 50, board: 'mainboard' }],
      }],
      canvasLabels: [{ id: 'legacy-label', text: 'Legacy', x: -2 * oldCell, y: oldCell }],
    };
    const server = legacyServer ? legacy : current;
    const result = mergeUserData(legacyServer ? current : legacy, server);
    expect(result.id).toBe(server.id);
    expect(result.gridVersion).toBe(CANVAS_GRID_VERSION);
    expect(result.canvasAreas?.find(area => area.id === 'current')).toEqual(currentArea);
    expect(result.canvasAreas?.find(area => area.id === 'legacy')).toMatchObject({
      bounds: { x: -2 * cell, y: -4 * cell, width: 10 * cell, height: 12 * cell },
      cards: [{ id: 'site', cardName: 'Site', x: 3.5 * cell - 70, y: 3 * cell - 50, board: 'mainboard' }],
    });
    expect(result.canvasLabels).toEqual(expect.arrayContaining([
      { id: 'current-label', text: 'Current', x: 2 * cell, y: 4 * cell },
      { id: 'legacy-label', text: 'Legacy', x: -2 * cell, y: cell },
    ]));
    expect(mergeUserData(result, server)).toEqual(result);
  });

  it('preserves guest collection, labels, and canvas areas while keeping server deck conflicts', () => {
    const sharedDeckId = 'deck-shared';
    const localDeck = createEmptyDeck('Local Name', sharedDeckId);
    const serverDeck = createEmptyDeck('Server Name', sharedDeckId);

    const local = {
      ...userData('guest-1', 'Guest'),
      decks: [localDeck, createEmptyDeck('Local Only', 'deck-local')],
      favouriteDeckIds: ['deck-local', 'deck-shared'],
      collection: [
        { name: 'Fireball', quantity: 2 },
        { name: 'Local Only Card', quantity: 1 },
      ],
      selectedCardCategory: 'swarm-bodies',
      cardCategories: {
        version: 'test',
        categories: [
          {
            id: 'swarm-bodies',
            name: 'Swarm',
            tooltip: 'Guest tooltip',
            description: 'Guest description',
            base: true,
          },
        ],
        scores: { Fireball: { 'swarm-bodies': 0.5 } },
      },
      canvasLabels: [{ id: 'label-local', text: 'Local', x: 0, y: 0 }],
      canvasAreas: [canvasArea('stack-local', 'stack')],
    };
    const server = {
      ...userData('user-1', 'Alice'),
      decks: [serverDeck],
      favouriteDeckIds: ['deck-server', 'deck-shared'],
      collection: [
        { name: 'Fireball', quantity: 3 },
        { name: 'Server Only Card', quantity: 4 },
      ],
      canvasLabels: [{ id: 'label-server', text: 'Server', x: 1, y: 1 }],
      canvasAreas: [canvasArea('deck-server', 'deck')],
    };

    const merged = mergeUserData(local, server);

    expect(merged.decks.find((deck) => deck.id === sharedDeckId)?.name).toBe('Server Name');
    expect(merged.decks.some((deck) => deck.id === 'deck-local')).toBe(true);
    expect(merged.collection).toEqual(
      expect.arrayContaining([
        { name: 'Fireball', quantity: 5 },
        { name: 'Local Only Card', quantity: 1 },
        { name: 'Server Only Card', quantity: 4 },
      ]),
    );
    expect(merged.canvasLabels?.map((label) => label.id).sort()).toEqual([
      'label-local',
      'label-server',
    ]);
    expect(merged.canvasAreas?.map((area) => area.id).sort()).toEqual([
      'deck-server',
      'stack-local',
    ]);
    expect(merged.favouriteDeckIds).toEqual([
      'deck-server',
      'deck-shared',
      'deck-local',
    ]);
    expect(merged.selectedCardCategory).toBe('swarm-bodies');
    expect(merged.cardCategories?.scores.Fireball?.['swarm-bodies']).toBe(0.5);
  });
});
