import { required } from '@/utils/required';
import { describe, expect, it } from 'vitest';
import type { Card, CanvasLabel } from '@/data/dataModels';
import type { CanvasArea } from './canvasAreas';
import { chanceOfDrawingLabel, LabelStatisticsCache } from './labelStatistics';

const metadata: Card[] = [['Spell', 'Minion', 4], ['Free', 'Magic', 0], ['Site', 'Site', null], ['Avatar', 'Avatar', null]].map(([name, type, cost]) => ({
  name: String(name), elements: '', subTypes: '', sets: [], guardian: {
    type: String(type), cost: cost as number | null, rarity: null, rulesText: '', attack: null, defence: null, life: null,
    thresholds: { air: 0, earth: 0, fire: 0, water: 0 },
  },
}));
function fixture() {
  const labels: CanvasLabel[] = [
    { id: 'parent', text: 'Engine', areaId: 'deck', board: 'mainboard', x: 0, y: 0 },
    { id: 'child', text: 'Draw', areaId: 'deck', board: 'mainboard', parentLabelId: 'parent', x: 100, y: 100 },
    { id: 'collection', text: 'Extras', areaId: 'deck', board: 'collection', x: 1000, y: 0 },
  ];
  const area: CanvasArea = { id: 'deck', type: 'deck', name: 'Deck', pinned: true,
    bounds: { x: 0, y: 0, width: 2000, height: 2000 }, cards: [
      ...Array.from({ length: 40 }, (_, i) => ({ id: `spell-${i}`, cardName: i === 0 ? 'Free' : 'Spell', x: 0, y: 0,
        labelId: i < 4 ? 'child' : undefined, board: 'mainboard' as const })),
      ...Array.from({ length: 20 }, (_, i) => ({ id: `site-${i}`, cardName: 'Site', x: 0, y: 0,
        labelId: i < 2 ? 'child' : undefined, board: 'mainboard' as const })),
      { id: 'extra', cardName: 'Spell', labelId: 'collection', board: 'collection', x: 1000, y: 0 },
      { id: 'avatar', cardName: 'Avatar', board: 'mainboard', x: 0, y: 0 },
    ] };
  return { labels, area, cache: new LabelStatisticsCache() };
}

describe('label statistics', () => {
  it('counts copies and nested members once, excludes sites from mana, and separates draw pools', () => {
    const { labels, area, cache } = fixture();
    const stats = cache.get(labels, [area], metadata).get('parent');
    expect(stats?.count).toBe(6);
    expect(stats?.meanMana).toBe(3); // free spell + three four-mana spells
    expect(stats?.spellChance).toBeCloseTo(1 - 36 * 35 * 34 / (40 * 39 * 38));
    expect(stats?.siteChance).toBeCloseTo(1 - 18 * 17 * 16 / (20 * 19 * 18));
    expect(stats?.text).toContain('6 cards · avg mana 3.0');
  });
  it('does not invent draw chances for Collection, Maybe or a loose stack', () => {
    const { labels, area, cache } = fixture();
    for (const board of ['collection', 'maybeboard'] as const) {
      required(labels[2]).board = board;
      required(area.cards.find(card => card.id === 'extra')).board = board;
      const stats = cache.get(labels, [area], metadata).get('collection');
      expect(stats).toMatchObject({ count: 1, meanMana: 4, spellChance: null, siteChance: null });
    }
    area.type = 'stack';
    expect(cache.get(labels, [area], metadata).get('child')?.spellChance).toBeNull();
  });
  it('uses active variant copies in both the numerator and denominator', () => {
    const { labels, area, cache } = fixture();
    area.activeDeckVariantId = 'v';
    area.deckVariants = [{ id: 'v', name: 'Small', activeCardIds: ['spell-0', 'spell-10', 'spell-11', 'spell-12'] }];
    expect(cache.get(labels, [area], metadata).get('child')).toMatchObject({ count: 1, meanMana: 0, spellChance: 0.75, siteChance: null });
    required(area.deckVariants[0]).activeCardIds.push('spell-1');
    expect(cache.get(labels, [area], metadata).get('child')?.count).toBe(2);
  });
  it('shows zero active cards when the whole group is excluded from the variant', () => {
    const { labels, area, cache } = fixture();
    area.deckVariants = [{ id: 'empty', name: 'Alternate', activeCardIds: ['spell-10'] }];
    expect(cache.get(labels, [area], metadata).get('child')).toMatchObject({ count: 0, meanMana: null, text: '0 cards' });
  });
  it('omits unknown mana and draw chances when pool metadata is incomplete', () => {
    const { labels, area, cache } = fixture();
    required(area.cards[0]).cardName = 'Unknown';
    expect(cache.get(labels, [area], metadata).get('child')).toMatchObject({ count: 6, meanMana: 4, spellChance: null, siteChance: null });
  });
  it('reuses calculations through dragging and invalidates them for membership changes', () => {
    const { labels, area, cache } = fixture();
    const before = cache.get(labels, [area], metadata);
    required(labels[0]).x += 100;
    required(area.cards[0]).y += 100;
    expect(cache.get(labels, [area], metadata)).toBe(before);
    required(area.cards[0]).labelId = undefined;
    expect(cache.get(labels, [area], metadata)).not.toBe(before);
    expect(cache.get(labels, [area], metadata).get('child')?.count).toBe(5);
  });
  it('handles empty and small decks without invalid probabilities', () => {
    expect(chanceOfDrawingLabel(0, 0)).toBeNull();
    expect(chanceOfDrawingLabel(0, 4)).toBe(0);
    expect(chanceOfDrawingLabel(1, 2)).toBe(1);
    expect(chanceOfDrawingLabel(4, 4)).toBe(1);
  });
});
