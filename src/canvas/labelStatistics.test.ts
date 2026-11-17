import { required } from '@/utils/required';
import { describe, expect, it } from 'vitest';
import type { Card, CanvasLabel } from '@/data/dataModels';
import type { CanvasArea, CanvasCardInstance } from './canvasAreas';
import { chanceOfDrawingLabel, formatLabelStatistics, LabelStatisticsCache } from './labelStatistics';

const cardMetadata: [name: string, type: string, cost: number | null, subTypes?: string][] = [
  ['Spell', 'Minion', 4], ['Free', 'Magic', 0], ['Site', 'Site', null], ['Avatar', 'Avatar', null],
  ['Aaj-kegon Ghost Crabs', 'Minion', 2, 'Beast, Spirit'], ['Anui Undine', 'Minion', 5, 'Spirit'],
  ['Caelestis', 'Minion', 7, 'Dragon, Spirit'], ['Spirit Artifact', 'Artifact', 3, 'Spirit'],
  ['Spirit Site', 'Site', null, 'Spirit'],
];
const metadata: Card[] = cardMetadata.map(([name, type, cost, subTypes = '']) => ({
  name, elements: '', subTypes, sets: [], guardian: {
    type, cost, rarity: null, rulesText: '', attack: null, defence: null, life: null,
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

function compositionFixture() {
  const { labels, area, cache } = fixture();
  const card = (id: string, cardName: string, labelId?: string): CanvasCardInstance => ({ id, cardName, labelId, x: 0, y: 0 });
  area.cards = [
    card('crabs', 'Aaj-kegon Ghost Crabs', 'child'), card('undine', 'Anui Undine', 'child'),
    card('dragon', 'Caelestis'), card('minion', 'Spell'), card('magic', 'Free'), card('site', 'Site'),
  ];
  return { labels, area, cache, card };
}

describe('label statistics', () => {
  it('counts copies and nested members once, excludes sites from mana, and separates draw pools', () => {
    const { labels, area, cache } = fixture();
    const stats = cache.get(labels, [area], metadata).get('parent');
    expect(stats?.count).toBe(6);
    expect(stats?.meanMana).toBe(3); // free spell + three four-mana spells
    expect(stats?.spellChance).toBeCloseTo(1 - 36 * 35 * 34 / (40 * 39 * 38));
    expect(stats?.spellChanceSix).toBeCloseTo(1 - 34 * 33 * 32 * 31 / (40 * 39 * 38 * 37));
    expect(stats?.siteChance).toBeCloseTo(1 - 18 * 17 * 16 / (20 * 19 * 18));
    expect(stats?.siteChanceSix).toBeCloseTo(1 - 14 * 13 / (20 * 19));
    expect(stats?.text).toBe('6 cards · avg mana 3.0\n≥1 in 3/6: spells 28%/49% · sites 28%/52%');
    expect(stats?.tooltip).toContain('Spells use the Spellbook and sites use the Atlas.');
    expect(stats?.extras).toEqual([]);
  });
  it('shows a shared type without a common subtype', () => {
    const { labels, area, cache } = compositionFixture();
    required(area.cards.find(card => card.id === 'minion')).labelId = 'child';
    expect(cache.get(labels, [area], metadata).get('parent')?.extras).toEqual(['Minions 3/4 (75%)']);
  });
  it('shows a shared subtype across nested labels using all minions on their board', () => {
    const { labels, area, cache } = compositionFixture();
    const stats = cache.get(labels, [area], metadata).get('parent');
    expect(stats).toMatchObject({
      count: 2,
      text: '2 cards · avg mana 3.5\n≥1 in 3/6: 90%/100%',
      extras: ['Spirits 2/4 (50%)'],
    });
    expect(stats?.tooltip).toContain('Shares compare this group with all minions in Main.');
  });
  it('carefully separates minion subtype shares from the spell draw pool', () => {
    const { labels, area, cache, card } = compositionFixture();
    area.cards.push(card('artifact-1', 'Spirit Artifact'), card('artifact-2', 'Spirit Artifact'),
      card('spirit-site', 'Spirit Site'));
    expect(cache.get(labels, [area], metadata).get('parent')).toMatchObject({
      extras: ['Spirits 2/4 (50%)'],
      text: '2 cards · avg mana 3.5\n≥1 in 3/6: 71%/100%',
    });
  });
  it('omits composition for mixed types even when members share a subtype', () => {
    const { labels, area, cache, card } = compositionFixture();
    const spiritSite = card('spirit-site', 'Spirit Site');
    area.cards.push(card('artifact', 'Spirit Artifact', 'child'), spiritSite);
    expect(cache.get(labels, [area], metadata).get('child')?.extras).toEqual([]);

    spiritSite.labelId = 'child';
    expect(cache.get(labels, [area], metadata).get('child')?.extras).toEqual([]);
  });
  it('resolves composition from active variant members and active comparison cards', () => {
    const { labels, area, cache } = compositionFixture();
    required(area.cards.find(card => card.id === 'magic')).labelId = 'child';
    expect(cache.get(labels, [area], metadata).get('child')?.extras).toEqual([]);
    area.deckVariants = [
      { id: 'full', name: 'Full', activeCardIds: area.cards.map(card => card.id) },
      { id: 'v', name: 'Small', activeCardIds: ['crabs', 'undine', 'minion', 'site'] },
    ];
    area.activeDeckVariantId = 'v';
    const stats = cache.get(labels, [area], metadata);
    expect(stats.get('child')?.extras).toEqual(['Spirits 2/3 (67%)']);
    expect(stats.get('parent')?.extras).toEqual(['Spirits 2/3 (67%)']);
  });
  it('uses the owner board and avoids cross-board or cross-area memberships', () => {
    const { labels, area, cache, card } = compositionFixture();
    required(labels.find(label => label.id === 'collection')).parentLabelId = 'parent';
    labels.push({ id: 'maybe', text: 'Possibilities', areaId: 'deck', board: 'maybeboard', x: 0, y: 0 },
      { id: 'other', text: 'Another deck', areaId: 'other-deck', parentLabelId: 'parent', x: 0, y: 0 });
    area.cards.push(
      { ...card('extra', 'Anui Undine', 'collection'), board: 'collection' },
      { ...card('extra-2', 'Caelestis', 'child'), board: 'collection' },
      { ...card('maybe-1', 'Anui Undine', 'maybe'), board: 'maybeboard' },
      { ...card('maybe-2', 'Spell'), board: 'maybeboard' },
      { ...card('avatar', 'Unknown avatar'), board: 'avatar' },
      card('cross-area', 'Free', 'other'),
    );
    const otherDeck = { ...area, id: 'other-deck', cards: [card('other-dragon', 'Caelestis', 'parent')] };
    const stats = cache.get(labels, [area, otherDeck], metadata);
    expect(stats.get('parent')?.extras).toEqual(['Spirits 2/4 (50%)']);
    expect(stats.get('collection')).toMatchObject({ count: 1, spellChance: null, spellChanceSix: null, siteChance: null, siteChanceSix: null,
      extras: ['Spirits 1/2 (50%)'] });
    expect(stats.get('collection')?.tooltip).toContain('all minions in Collection');
    expect(stats.get('maybe')).toMatchObject({ count: 1, spellChance: null, spellChanceSix: null, siteChance: null, siteChanceSix: null,
      extras: ['Spirits 1/2 (50%)'] });
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
    expect(cache.get(labels, [area], metadata).get('child')).toMatchObject({
      count: 1, meanMana: 0, spellChance: 0.75, spellChanceSix: 1, siteChance: null, siteChanceSix: null,
    });
    required(area.deckVariants[0]).activeCardIds.push('spell-1');
    expect(cache.get(labels, [area], metadata).get('child')?.count).toBe(2);
  });
  it('shows zero active cards when the whole group is excluded from the variant', () => {
    const { labels, area, cache } = fixture();
    area.deckVariants = [{ id: 'empty', name: 'Alternate', activeCardIds: ['spell-10'] }];
    expect(cache.get(labels, [area], metadata).get('child')).toMatchObject({ count: 0, meanMana: null, text: '0 cards', extras: [] });
  });
  it('omits unknown mana and draw chances when pool metadata is incomplete', () => {
    const { labels, area, cache } = fixture();
    required(area.cards[0]).cardName = 'Unknown';
    expect(cache.get(labels, [area], metadata).get('child')).toMatchObject({
      count: 6, meanMana: 4, spellChance: null, spellChanceSix: null, siteChance: null, siteChanceSix: null, extras: [],
    });
  });
  it('omits shares when an unknown comparison card could belong to the same type', () => {
    const { labels, area, cache } = compositionFixture();
    required(area.cards.find(card => card.id === 'minion')).cardName = 'Unknown';
    expect(cache.get(labels, [area], metadata).get('child')).toMatchObject({ count: 2, meanMana: 3.5,
      spellChance: null, siteChance: null, extras: [] });
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

describe('formatting canvas label statistics', () => {
  const measure = (text: string) => text.length;

  it('shows full baseline and composition on the two available lines', () => {
    const { labels, area, cache } = compositionFixture();
    const stats = required(cache.get(labels, [area], metadata).get('parent'));
    expect(formatLabelStatistics(stats, 45, measure)).toBe(
      '2 cards · avg mana 3.5 · Spirits 2/4 (50%)\n≥1 in 3/6: 90%/100%',
    );
  });

  it('fits an extra on the second line when it fits there and drops it when neither line has space', () => {
    const { labels, area, cache } = compositionFixture();
    const stats = required(cache.get(labels, [area], metadata).get('parent'));
    expect(formatLabelStatistics(stats, 39, measure)).toBe(
      '2 cards · avg mana 3.5\n≥1 in 3/6: 90%/100% · Spirits 2/4 (50%)',
    );
    expect(formatLabelStatistics(stats, 30, measure)).toBe(stats.text);
  });

  it('compacts the baseline for a narrow heading with no optional metrics', () => {
    const { labels, area, cache } = compositionFixture();
    const stats = required(cache.get(labels, [area], metadata).get('parent'));
    expect(formatLabelStatistics(stats, 20, measure)).toBe('2 cards · avg 3.5\n≥1 in 3/6: 90%/100%');
  });

  it('uses the spare line for a complete owner-board metric', () => {
    const { labels, area, cache } = fixture();
    const stats = required(cache.get(labels, [area], metadata).get('collection'));
    expect(formatLabelStatistics(stats, 34, measure)).toBe('1 card · avg mana 4.0\nMinions 1/1 (100%)');
  });

  it('keeps both draw pools named even when the renderer must fit the baseline at a smaller size', () => {
    const { labels, area, cache } = fixture();
    const stats = required(cache.get(labels, [area], metadata).get('parent'));
    expect(formatLabelStatistics(stats, 20, measure)).toBe(
      '6 cards · avg 3.0\n≥1 in 3/6: spells 28/49% · sites 28/52%',
    );
  });
});
