import { describe, expect, it } from 'vitest';
import { createEmptyDeck, type Card } from './dataModels';
import { createDeckStyleAnalyzer, getDeckMetrics } from './deckAnalysis';
import type { DeckStyleAssociationData, DeckStyleProfile } from './deckStyleAssociations';

function card(name: string, type: string, cost: number | null): Card {
  return { name, elements: '', subTypes: '', sets: [], guardian: {
    type, rarity: 'Ordinary', cost, rulesText: '', attack: null, defence: null, life: null,
    thresholds: { air: 0, earth: 0, fire: 1, water: 0 },
  } };
}
const cards = [card('Avatar', 'Avatar', null), card('Burn', 'Magic', 2), card('Draw', 'Magic', 4),
  card('Land', 'Site', null), card('New ward', 'Ward', null)];
const burn = createEmptyDeck('Burn deck', 'burn');
burn.boards.avatar = [{ name: 'Avatar', quantity: 1 }];
burn.boards.mainboard = [{ name: 'Burn', quantity: 4 }];
const draw = { ...burn, id: 'draw', name: 'Draw deck', boards: { ...burn.boards, mainboard: [{ name: 'Draw', quantity: 4 }] } };
const profile = (id: string, name: string, deckId: string): DeckStyleProfile => ({
  id, name, cards: {}, decks: [{ deckId, score: 1 }], subStyles: {},
});
const modes = { styles: { aggro: profile('aggro', 'Aggro', 'burn'), control: profile('control', 'Control', 'draw') } };
const data: DeckStyleAssociationData = {
  version: 'test', generatedAt: '', alpha: 1,
  styles: ['Aggro', 'Control'].map((name) => ({ id: name.toLowerCase(), name, tooltip: '', description: '', subStyles: [] })),
  decks: { burn: { ...burn, avatar: 'Avatar', elements: [] }, draw: { ...draw, avatar: 'Avatar', elements: [] } },
  modes: { primary: modes, fractional: modes },
};

describe('current deck analysis', () => {
  it('counts quantities and future types, excludes spare boards from mana metrics, and reports missing details', () => {
    const deck = { ...burn, boards: { ...burn.boards,
      mainboard: [{ name: 'Burn', quantity: 4 }, { name: 'Draw', quantity: 2 }, { name: 'Land', quantity: 3 },
        { name: 'New ward', quantity: 1 }, { name: 'Preview card', quantity: 2 }],
      collection: [{ name: 'Draw', quantity: 20 }], maybeboard: [{ name: 'Burn', quantity: 10 }],
    } };
    const metrics = getDeckMetrics(deck, cards);
    expect(metrics).toMatchObject({ spells: 7, sites: 3, collection: 20, maybe: 10, uncostedSpells: 1, unknown: ['Preview card'] });
    expect(metrics.averageCost).toBeCloseTo(16 / 6);
    expect(metrics.curve).toEqual([[2, 4], [4, 2]]);
    expect(metrics.types).toContainEqual(['Ward', 1]);
  });

  it('estimates styles from card contents and responds to edits even when a remote deck ID is unchanged', () => {
    const analyze = createDeckStyleAnalyzer(data, cards);
    expect(analyze(burn)).toMatchObject({ closestSimilarity: 1, neighborCount: 1 });
    expect(analyze(burn).profiles[0]).toMatchObject({ id: 'aggro', score: 1, primary: true });
    expect(analyze({ ...draw, id: burn.id }).profiles[0]?.id).toBe('control');
    const mixed = { ...burn, boards: { ...burn.boards, mainboard: [{ name: 'Burn', quantity: 2 }, { name: 'Draw', quantity: 2 }] } };
    expect(analyze(mixed).profiles.map((entry) => entry.score)).toEqual([0.5, 0.5]);
  });

  it('ignores Maybeboard, caps copy saturation, and does not guess a style from an avatar alone', () => {
    const analyze = createDeckStyleAnalyzer(data, cards);
    expect(analyze({ ...burn, boards: { ...burn.boards, maybeboard: draw.boards.mainboard } })).toEqual(analyze(burn));
    expect(analyze({ ...burn, boards: { ...burn.boards, mainboard: [{ name: 'Burn', quantity: 40 }] } })).toEqual(analyze(burn));
    expect(analyze({ ...burn, boards: { ...burn.boards, mainboard: [] } }).profiles).toEqual([]);
    expect(getDeckMetrics(createEmptyDeck('Empty', 'empty'), cards).averageCost).toBeNull();
  });
});
