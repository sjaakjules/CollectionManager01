import { describe, expect, it } from 'vitest';
import { sanitizeDevUserData } from './dev-user-data.ts';

describe('development account schema', () => {
  it('keeps layout controls, card markers and linked labels across legacy saves', () => {
    const payload = {
      decks: [{ id: 'deck', boards: { mainboard: [], avatar: [], maybeboard: [],
        sideboard: [{ name: 'Site', quantity: 2 }],
      } }],
      interactionEffects: { intensity: 'subtle', lettering: 'english' },
      catalogueLayout: { steps: [{ key: 'element', mode: 'group' }] },
      canvasLabels: [{ id: 'label', text: 'Utility', x: 3, y: 5,
        areaId: 'area', board: 'sideboard', parentLabelId: 'parent' }],
      canvasAreas: [{ id: 'area', name: 'Deck', type: 'deck',
        cards: [{ id: 'card', cardName: 'Site', x: 10, y: 20, board: 'sideboard', labelId: 'label', isNew: true }],
        deckVariants: [{ id: 'variant', name: 'Main', activeCardIds: ['card'] }],
      }],
    };
    const saved = sanitizeDevUserData(payload, 'user', 'Account');
    expect(saved.interactionEffects).toEqual(payload.interactionEffects);
    expect(saved.catalogueLayout).toEqual(payload.catalogueLayout);
    expect(saved.decks[0].boards).toEqual({ mainboard: [], avatar: [], maybeboard: [], collection: [{ name: 'Site', quantity: 2 }] });
    expect(saved.canvasLabels[0]).toEqual({ ...payload.canvasLabels[0], board: 'collection' });
    expect(saved.canvasAreas[0]).toEqual({ ...payload.canvasAreas[0], cards: [{ ...payload.canvasAreas[0].cards[0], board: 'collection' }] });
    expect(sanitizeDevUserData(saved, 'user', 'Account')).toEqual(saved);
    expect(payload.decks[0].boards).toHaveProperty('sideboard');
  });
});
