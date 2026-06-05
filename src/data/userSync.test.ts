import { describe, expect, it } from 'vitest';
import { mergeUserData } from '@/data/userSync';
import { createEmptyDeck, type UserData } from '@/data/dataModels';
import type { CanvasArea } from '@/canvas/canvasAreas';

function userData(id: string, name: string): UserData {
  return {
    id,
    name,
    decks: [],
    collection: [],
    selectedArchetype: null,
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
  it('preserves guest collection, labels, and canvas areas while keeping server deck conflicts', () => {
    const sharedDeckId = 'deck-shared';
    const localDeck = createEmptyDeck('Local Name', sharedDeckId);
    const serverDeck = createEmptyDeck('Server Name', sharedDeckId);

    const local = {
      ...userData('guest-1', 'Guest'),
      decks: [localDeck, createEmptyDeck('Local Only', 'deck-local')],
      collection: [
        { name: 'Fireball', quantity: 2 },
        { name: 'Local Only Card', quantity: 1 },
      ],
      canvasLabels: [{ id: 'label-local', text: 'Local', x: 0, y: 0 }],
      canvasAreas: [canvasArea('stack-local', 'stack')],
    };
    const server = {
      ...userData('user-1', 'Alice'),
      decks: [serverDeck],
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
  });
});
