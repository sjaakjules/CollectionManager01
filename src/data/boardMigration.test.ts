import { describe, expect, it } from 'vitest';
import { normalizeDeckBoards, normalizeUserDataBoards } from './boardMigration';
import { createEmptyDeck, createGuestUserData, type UserData } from './dataModels';
import { appReducer, initialAppState } from '@/app/AppState';

describe('Collection board migration', () => {
  it('upgrades old guest and account snapshots without moving cards or losing variants and labels', () => {
    for (const name of ['Guest', 'Alice']) {
      const legacy = {
        ...createGuestUserData('user'), name,
        decks: [{ ...createEmptyDeck('Blade Dancer', 'deck'), boards: {
          mainboard: [{ name: 'Spell', quantity: 1 }], avatar: [],
          sideboard: [{ name: 'Site', quantity: 2 }], maybeboard: [],
        } }],
        canvasAreas: [{ id: 'area', type: 'deck', name: 'Blade Dancer', pinned: true,
          bounds: { x: -100, y: -200, width: 3000, height: 6000 },
          cards: [{ id: 'card', cardName: 'Site', x: 71, y: 89, board: 'sideboard', labelId: 'label', isNew: true }],
          deckVariants: [{ id: 'variant', name: 'Test', activeCardIds: ['card'] }],
        }],
        canvasLabels: [{ id: 'label', text: 'Utility', x: 70, y: 10, board: 'sideboard', areaId: 'area' }],
      };
      const before = JSON.stringify(legacy);
      const migrated = normalizeUserDataBoards(legacy as unknown as UserData);
      expect(migrated.decks[0]?.boards.collection).toEqual([{ name: 'Site', quantity: 2 }]);
      expect(migrated.decks[0]?.boards).not.toHaveProperty('sideboard');
      expect(migrated.canvasAreas?.[0]?.cards[0]).toMatchObject({
        id: 'card', x: 71, y: 89, board: 'collection', labelId: 'label', isNew: true,
      });
      expect(migrated.canvasAreas?.[0]?.deckVariants).toEqual(legacy.canvasAreas[0]?.deckVariants);
      expect(migrated.canvasLabels?.[0]).toMatchObject({ board: 'collection', areaId: 'area' });
      expect(normalizeUserDataBoards(migrated)).toEqual(migrated);
      expect(JSON.stringify(legacy)).toBe(before);
    }
  });

  it('honors an explicitly empty Collection rather than restoring a stale legacy board', () => {
    expect(normalizeDeckBoards({ mainboard: [], avatar: [], maybeboard: [],
      collection: [], sideboard: [{ name: 'Deleted', quantity: 1 }],
    })).toEqual({ mainboard: [], avatar: [], maybeboard: [], collection: [] });
  });

  it('lets incomplete legacy canvas snapshots reach the hydration sanitizer', () => {
    const legacy = {
      ...createGuestUserData('guest'),
      canvasAreas: [null, { id: 'empty', name: 'Empty', type: 'stack' }, {
        id: 'deck', name: 'Deck', type: 'deck', cards: [null, {
          id: 'card', cardName: 'Site', board: 'sideboard', x: 12, y: 34,
        }],
      }],
      canvasLabels: [null, { id: 'label', text: 'Note', x: 0, y: 0, board: 'sideboard' }],
    } as unknown as UserData;
    const loaded = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: legacy });
    expect(loaded.userData?.canvasAreas?.map((area) => area.id)).toEqual(['empty', 'deck']);
    expect(loaded.userData?.canvasAreas?.[0]?.cards).toEqual([]);
    expect(loaded.userData?.canvasAreas?.[1]?.cards).toEqual([
      expect.objectContaining({ id: 'card', board: 'collection', x: 12, y: 34 }),
    ]);
    expect(loaded.userData?.canvasLabels).toEqual([
      { id: 'label', text: 'Note', x: 0, y: 0, board: 'collection' },
    ]);
    expect(normalizeUserDataBoards({ ...legacy, canvasAreas: {}, canvasLabels: {} } as unknown as UserData))
      .toMatchObject({ canvasAreas: [], canvasLabels: [] });
  });
});
