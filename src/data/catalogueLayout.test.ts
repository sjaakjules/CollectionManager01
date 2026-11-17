import { describe, expect, it } from 'vitest';
import {
  buildCatalogueGroups, createDefaultCatalogueLayout, createSelectionLayout, createSpellbookLayout, ensureCatalogueLayout,
  getLayoutCell, getLayoutLeafAxis,
  getEarliestCardSet, getLayoutStepAxis, insertCatalogueLayoutStep, type CatalogueLayoutCard, type CatalogueLayoutConfig,
} from './catalogueLayout';
import type { CardSet } from './dataModels';
import { required } from '@/utils/required';

const cards: CatalogueLayoutCard[] = [
  { name: 'Zephyr', type: 'Magic', thresholdGroup: 'air', cost: 2 },
  { name: 'Aether', type: 'Magic', thresholdGroup: 'air', cost: 2 },
  { name: 'Breeze', type: 'Magic', thresholdGroup: 'air', cost: 1 },
  { name: 'Mountain', type: 'Site', thresholdGroup: 'earth', cost: null },
  { name: 'Clay', type: 'Magic', thresholdGroup: 'earth', cost: 3 },
];

describe('catalogue layout operations', () => {
  it('retains elemental and Spellbook / Atlas groups after filtering', () => {
    const grouped = buildCatalogueGroups(cards.filter((card) => card.name !== 'Zephyr'), createDefaultCatalogueLayout());
    expect(grouped.children.map((group) => group.label)).toEqual(['Air', 'Earth']);
    expect(grouped.children[1]?.children.map((group) => group.label)).toEqual(['Spellbook', 'Atlas']);
    expect(grouped.children[0]?.children[0]?.children[0]?.cards.map((card) => card.name)).toEqual(['Breeze', 'Aether']);
  });

  it('prioritizes earlier sorts and uses names to break ties consistently', () => {
    const config = ensureCatalogueLayout({ steps: [{ field: 'cost', mode: 'sort', direction: 'desc' }] });
    const first = buildCatalogueGroups(cards, config).cards.map((card) => card.name);
    expect(first).toEqual(['Mountain', 'Clay', 'Aether', 'Zephyr', 'Breeze']);
    expect(buildCatalogueGroups([...cards].reverse(), config).cards.map((card) => card.name)).toEqual(first);
  });

  it('honors a sort before a group when ranking group contents', () => {
    const config = ensureCatalogueLayout({ steps: [
      { field: 'cost', mode: 'sort', direction: 'desc' },
      { field: 'element', mode: 'group' },
    ] });
    expect(buildCatalogueGroups(cards, config).children.map((group) => group.label)).toEqual(['Earth', 'Air']);
  });

  it('reorders and inserts without duplicate fields or lost step settings', () => {
    const defaults = createDefaultCatalogueLayout();
    const moved = insertCatalogueLayoutStep(defaults, 'name', 1);
    expect(moved.steps.map((step) => step.field)).toEqual(['element', 'name', 'family', 'type', 'cost']);
    expect(moved.steps[1]?.mode).toBe('sort');
    const appended = insertCatalogueLayoutStep(moved, 'element', moved.steps.length);
    expect(appended.steps.at(-1)?.field).toBe('element');
    expect(defaults.steps[0]?.field).toBe('element');
    expect(insertCatalogueLayoutStep(appended, 'rarity', 2).steps[2]?.field).toBe('rarity');
  });

  it('sanitizes saved preferences and allows an intentionally empty hierarchy', () => {
    expect(ensureCatalogueLayout(null)).toEqual(createDefaultCatalogueLayout());
    expect(ensureCatalogueLayout({ columns: 100, steps: [null, { field: 'invalid' }, { field: 'cost', mode: 'bad' }, { field: 'cost' }] })).toEqual({
      columns: 16, columnMode: 'limit', steps: [{ field: 'cost', mode: 'group', direction: 'asc', axis: 'horizontal' }],
    });
    expect(ensureCatalogueLayout({ steps: [], columns: 0 })).toEqual({ steps: [], columns: 1, columnMode: 'limit' });
  });

  it('defaults to auto width and round-trips explicit caps and the selection Clean step', () => {
    const selection = createSelectionLayout();
    expect(selection).toEqual({ steps: [], columns: 16, columnMode: 'auto' });
    for (const layout of [createDefaultCatalogueLayout(), createSpellbookLayout('cost'), createSpellbookLayout('threshold'), selection]) {
      expect(layout.columnMode).toBe('auto');
      expect(ensureCatalogueLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
    }
    const cleanSelection = insertCatalogueLayoutStep({ ...selection, clean: true, columnMode: 'limit', columns: 7 }, 'name', 0);
    expect(ensureCatalogueLayout(JSON.parse(JSON.stringify(cleanSelection)))).toEqual(cleanSelection);
    expect(ensureCatalogueLayout({ steps: [], columns: 3, columnMode: 'unknown', clean: 'true' }))
      .toEqual({ steps: [], columns: 3, columnMode: 'limit' });
    expect(ensureCatalogueLayout({ ...selection, clean: false })).toEqual(selection);
  });

  it('uses the same column cap in row-major and column-major traversal', () => {
    const cells = (count: number, columns: number, axis: 'vertical' | 'horizontal') => Array.from({ length: count }, (_, index) => {
      const { column, row } = getLayoutCell(index, count, columns, axis);
      return [column, row];
    });
    expect(cells(6, 3, 'vertical')).toEqual([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]);
    expect(cells(6, 3, 'horizontal')).toEqual([[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]]);
    expect(cells(3, 1, 'vertical')).toEqual([[0, 0], [0, 1], [0, 2]]);
    expect(cells(2, 8, 'vertical')).toEqual([[0, 0], [0, 1]]);
    expect(cells(2, 8, 'horizontal')).toEqual([[0, 0], [1, 0]]);
    expect(cells(5, 4, 'horizontal')).toEqual([[0, 0], [0, 1], [1, 0], [2, 0], [3, 0]]);
    expect(getLayoutCell(1, 2, 8)).toEqual({ column: 1, row: 0 });
    expect(getLayoutLeafAxis({ columns: 8, steps: [] })).toBeUndefined();
  });

  it('restores horizontal directions and handles saved steps without an axis', () => {
    const config = ensureCatalogueLayout({ columns: 2, steps: [
      { field: 'element', mode: 'group', direction: 'desc', axis: 'horizontal' },
      { field: 'threshold', mode: 'sort', direction: 'asc', axis: 'invalid' },
    ] });
    expect(config).toEqual({ columns: 2, columnMode: 'limit', steps: [
      { field: 'element', mode: 'group', direction: 'desc', axis: 'horizontal' },
      { field: 'threshold', mode: 'sort', direction: 'asc', axis: 'horizontal' },
    ] });
    expect(config.steps.map(getLayoutStepAxis)).toEqual(['horizontal', 'horizontal']);
    expect(buildCatalogueGroups(cards, config).step).toEqual(config.steps[0]);
  });

  it('keeps old catalogues laid out across at the top level and down within groups', () => {
    const legacy: CatalogueLayoutConfig = { columns: 10, steps: [
      { field: 'element', mode: 'group', direction: 'asc' },
      { field: 'family', mode: 'group', direction: 'asc' },
      { field: 'cost', mode: 'sort', direction: 'desc' },
    ] };
    const restored = ensureCatalogueLayout(legacy);
    expect(restored.steps.map(getLayoutStepAxis)).toEqual(['horizontal', 'vertical', 'horizontal']);
    const grouped = buildCatalogueGroups(cards, legacy);
    expect(grouped.step?.axis).toBe('horizontal');
    expect(grouped.children[0]?.step?.axis).toBe('vertical');
    expect(getLayoutLeafAxis(legacy)).toBe('horizontal');
    expect(insertCatalogueLayoutStep(legacy, 'threshold', 0).steps.slice(0, 2).map(getLayoutStepAxis))
      .toEqual(['vertical', 'horizontal']);
  });

  it('groups spellbook roles before exact threshold requirements', () => {
    const group = buildCatalogueGroups([
      { ...required(cards[0]), thresholds: { air: 1, earth: 0, fire: 0, water: 0 } },
      { ...required(cards[1]), type: 'Aura', thresholds: { air: 0, earth: 1, fire: 1, water: 0 } },
      { ...required(cards[2]), type: 'Minion', thresholds: { air: 2, earth: 0, fire: 0, water: 0 } },
      { ...required(cards[4]), type: 'Artifact' },
    ], createSpellbookLayout('threshold'));
    expect(group.children.map((child) => child.label)).toEqual(['Minions', 'Magic / Auras', 'Artifacts']);
    expect(group.children.flatMap((child) => child.children.map((threshold) => threshold.label)))
      .toEqual(['Air 2', 'Air 1', 'Earth 1 + Fire 1', 'No threshold']);
  });

  it('sorts sets in release order for groups and sorting steps', () => {
    const expected = [
      'Alpha', 'Beta', 'Arthurian Legends', 'Dragonlord', 'Gothic', 'Frost Mage Vs. Lavamancer',
      "Baldassare's Travels", 'Future set', 'Promo',
    ];
    const entries: CatalogueLayoutCard[] = [...expected].reverse().map((primarySet) => ({
      name: primarySet, type: 'Avatar', thresholdGroup: 'none', cost: null, primarySet,
    }));
    const grouped = buildCatalogueGroups(entries, { columns: 4, steps: [{ field: 'set', mode: 'group', direction: 'asc' }] });
    const sorted = buildCatalogueGroups(entries, { columns: 4, steps: [{ field: 'set', mode: 'sort', direction: 'desc' }] });
    expect(grouped.children.map((child) => child.label)).toEqual(expected);
    expect(sorted.cards.map((card) => card.primarySet)).toEqual([...expected].reverse());
  });

  it('looks through reprints for the first release and falls back to set order without dates', () => {
    const set = (name: string, releasedAt: string): CardSet => ({
      name, releasedAt, variants: [], metadata: { type: 'Avatar', rarity: null, rulesText: '', cost: null,
        attack: null, defence: null, life: null, thresholds: { air: 0, earth: 0, fire: 0, water: 0 } },
    });
    const prints = [set('Zeta', '2032-01-01'), set('Alpha', '2030-01-01'), set('Aardvark', '2031-01-01')];
    expect(getEarliestCardSet(prints)).toBe(prints[1]);
    expect(prints.map((entry) => entry.name)).toEqual(['Zeta', 'Alpha', 'Aardvark']);
    const undated = [set('Gothic', ''), set('Beta', ''), set('Promo', '')];
    expect(getEarliestCardSet(undated)).toBe(undated[1]);
  });
});
