import { describe, expect, it } from 'vitest';
import { normalizeDeckBoards, normalizeUserDataBoards } from './boardMigration';
import { createEmptyDeck, createGuestUserData, type UserData } from './dataModels';
import { appReducer, initialAppState } from '@/app/AppState';
import { mergeSeedDecks } from './seedDecks';
import { extractDeckId } from './sorceryDeckSource';

describe('Collection board migration', () => {
  it('migrates retired deck identities and photographed card names in both guest and account data', () => {
    for (const name of ['Guest', 'Alice']) {
      const before: UserData = { ...createGuestUserData('user'), name,
        decks: [{ ...createEmptyDeck('My edits', 'curiosa-source'), boards: {
          avatar: [], collection: [], maybeboard: [], mainboard: [{ name: 'Reed-cord Measurer', quantity: 2 }],
        } }],
        collection: [{ name: 'Reed-cord Measurer', quantity: 3 }],
        favouriteDeckIds: ['curiosa-source'], removedDecks: { 'curiosa-deleted': '2026-11-16T00:00:00Z' },
        canvasAreas: [{ id: 'area', deckId: 'curiosa-source', type: 'deck', name: 'My edits', pinned: true,
          bounds: { x: 0, y: 0, width: 1000, height: 1000 },
          cards: [{ id: 'copy', cardName: 'Reed-cord Measurer', x: 12, y: 34, board: 'mainboard' }],
          deckVariants: [{ id: 'variant', name: 'Local variant', activeCardIds: ['copy'] }],
        }],
      };
      const saved = JSON.stringify(before);
      const migrated = normalizeUserDataBoards(before);
      expect(migrated.decks[0]?.id).toBe('sorcery-source');
      expect(migrated.decks[0]?.boards.mainboard).toEqual([{ name: 'Reed Cord Measurer', quantity: 2 }]);
      expect(migrated.collection).toEqual([{ name: 'Reed Cord Measurer', quantity: 3 }]);
      expect(migrated.favouriteDeckIds).toEqual(['sorcery-source']);
      expect(migrated.removedDecks).toEqual({ 'sorcery-deleted': '2026-11-16T00:00:00Z' });
      expect(migrated.canvasAreas?.[0]).toMatchObject({ id: 'area', deckId: 'sorcery-source',
        cards: [{ id: 'copy', cardName: 'Reed Cord Measurer', x: 12, y: 34 }],
        deckVariants: before.canvasAreas?.[0]?.deckVariants,
      });
      expect(mergeSeedDecks(migrated, [createEmptyDeck('Seed', 'sorcery-source'), createEmptyDeck('Deleted seed', 'sorcery-deleted')]).addedDeckNames).toEqual([]);
      expect(normalizeUserDataBoards(migrated)).toEqual(migrated);
      expect(JSON.stringify(before)).toBe(saved);
    }
    // The storage migration is not a live URL alias.
    expect(extractDeckId('https://curiosa.io/decks/source')).toBe('');
  });
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
