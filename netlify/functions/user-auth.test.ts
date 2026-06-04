import { describe, expect, it } from 'vitest';
import { sanitizeUserData } from './user-auth';

describe('sanitizeUserData', () => {
  it('keeps the same canvasAreas shape used by guest data and drops legacy zones', () => {
    const sanitized = sanitizeUserData(
      {
        name: 'Wrong Name',
        id: 'wrong-id',
        decks: [{ id: 'deck-1' }],
        collection: [{ name: 'Fireball', quantity: 2 }],
        selectedArchetype: 'midrange',
        canvasLabels: [
          { id: 'label-1', text: 'Keep', x: 1, y: 2 },
          { id: 'bad-label', text: 'Drop', x: Number.NaN, y: 2 },
        ],
        canvasAreas: [
          { id: 'stack-1', name: 'Stack', type: 'stack', cards: [] },
          { id: 'deck-1', name: 'Deck', type: 'deck', cards: [] },
          { id: 'legacy-custom', name: 'Legacy', type: 'custom', cards: [] },
        ],
        zones: [{ id: 'legacy-area', name: 'Legacy', type: 'stack' }],
      } as unknown as Parameters<typeof sanitizeUserData>[0],
      'user-1',
      'Alice',
    );

    expect(sanitized).toMatchObject({
      name: 'Alice',
      id: 'user-1',
      decks: [{ id: 'deck-1' }],
      collection: [{ name: 'Fireball', quantity: 2 }],
      selectedArchetype: 'midrange',
    });
    expect(sanitized.canvasLabels).toEqual([
      { id: 'label-1', text: 'Keep', x: 1, y: 2 },
    ]);
    expect(sanitized.canvasAreas?.map((area) => area.id)).toEqual([
      'stack-1',
      'deck-1',
    ]);
    expect(sanitized).not.toHaveProperty('zones');
  });
});
