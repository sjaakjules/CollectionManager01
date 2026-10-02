import { describe, expect, it, vi } from 'vitest';
import { createEmptyDeck, createGuestUserData } from './dataModels';
import { getDeckLibraryEntries } from './deckLibrary';
import { appReducer, initialAppState } from '@/app/AppState';
import { createDeckZone } from '@/canvas/canvasAreas';
import { mergeSeedDecks } from './seedDecks';
import { mergeUserData } from './userSync';

const seed = { ...createEmptyDeck('Example', 'seed'), origin: 'seed' as const,
  createdAt: '2026-09-29T10:00:00Z', updatedAt: '2026-09-29T10:00:00Z' };
const personal = { ...createEmptyDeck('Personal', 'mine'), origin: 'user' as const };
const lookup = { ...createEmptyDeck('Saved lookup', 'lookup'), origin: 'lookup' as const };

describe('shared saved deck library', () => {
  it('includes examples, saved lookup decks and manual imports in the same order, with no duplicate canvas decks', () => {
    const decks = [seed, personal, lookup];
    const area = createDeckZone(personal, new Map(), 0);
    expect(getDeckLibraryEntries(decks, [area]).map((entry) => entry.id)).toEqual(['seed', 'mine', 'lookup']);
    expect(getDeckLibraryEntries(decks, [area])[1]?.area).toBe(area);
  });

  it('uses current canvas boards and the active variant for metrics and export without losing stored cards', () => {
    const area = createDeckZone(personal, new Map(), 0);
    area.cards = [
      { id: 'a', cardName: 'Blink', board: 'mainboard', x: 1, y: 2 },
      { id: 'b', cardName: 'Browse', board: 'mainboard', x: 1, y: 2 },
      { id: 'c', cardName: 'Riptide', board: 'maybeboard', x: 1, y: 2 },
    ];
    area.deckVariants = [{ id: 'variant', name: 'Test', activeCardIds: ['b'] }];
    area.activeDeckVariantId = 'variant';
    const entry = getDeckLibraryEntries([personal], [area])[0];
    expect(entry?.deck.boards.mainboard).toEqual([{ name: 'Browse', quantity: 1 }]);
    expect(entry?.deck.boards.maybeboard).toEqual([{ name: 'Riptide', quantity: 1 }]);
    expect(area.cards).toHaveLength(3);
  });

  it('keeps an explicitly removed canvas avatar out of export and analysis', () => {
    const saved = { ...personal, boards: { ...personal.boards, avatar: [{ name: 'Avatar', quantity: 1 }] } };
    const area = createDeckZone(saved, new Map(), 0);
    area.avatarCardName = null;
    expect(getDeckLibraryEntries([saved], [area])[0]?.deck.boards.avatar).toEqual([]);
    // Legacy areas without an avatar field still use the saved deck.
    delete area.avatarCardName;
    expect(getDeckLibraryEntries([saved], [area])[0]?.deck.boards.avatar).toEqual(saved.boards.avatar);
  });

  it('removes a deck and every matching area from both lists, persists removal through reload/seeding/login, and permits a deliberate re-import', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
    try {
      const area = createDeckZone(seed, new Map(), 0);
      const saved = { ...createGuestUserData('g'), decks: [seed, personal], canvasAreas: [area],
        canvasLabels: [{ id: 'label', text: 'Keep this note', x: 15, y: 20,
          areaId: area.id, board: 'collection' as const, parentLabelId: 'parent' }] };
      const state = { ...initialAppState, userData: saved, editor: { ...initialAppState.editor, activeDeckId: seed.id } };
      const removed = appReducer(state, { type: 'DELETE_DECK', deckId: seed.id });
      if (!removed.userData) throw new Error('Missing user data');
      expect(removed.editor.activeDeckId).toBeNull();
      expect(removed.userData.canvasLabels).toEqual([{ id: 'label', text: 'Keep this note', x: 15, y: 20 }]);
      expect(getDeckLibraryEntries(removed.userData.decks, removed.userData.canvasAreas ?? []).map((entry) => entry.id)).toEqual(['mine']);
      const reloaded = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: JSON.parse(JSON.stringify(removed.userData)) });
      if (!reloaded.userData) throw new Error('Missing restored user data');
      expect(mergeSeedDecks(reloaded.userData, [seed]).addedDeckNames).toEqual([]);
      const merged = mergeUserData(reloaded.userData, saved);
      expect(merged.decks.map((deck) => deck.id)).toEqual(['mine']);
      expect(merged.canvasAreas).toEqual([]);
      expect(merged.canvasLabels).toEqual(removed.userData.canvasLabels);
      vi.advanceTimersByTime(1000);
      const readded = appReducer(reloaded, { type: 'CREATE_DECK', deck: seed });
      if (!readded.userData) throw new Error('Missing re-added user data');
      expect(readded.userData.removedDecks?.[seed.id]).toBeUndefined();
      expect(mergeUserData(readded.userData, removed.userData).decks.map((deck) => deck.id)).toContain(seed.id);
    } finally { vi.useRealTimers(); }
  });
});
