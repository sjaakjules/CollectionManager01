import { describe, expect, it } from 'vitest';
import { buildCatalogueGroups, createDefaultCatalogueLayout, ensureCatalogueLayout, insertCatalogueLayoutStep, type CatalogueLayoutCard } from './catalogueLayout';

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
      columns: 16, steps: [{ field: 'cost', mode: 'group', direction: 'asc' }],
    });
    expect(ensureCatalogueLayout({ steps: [], columns: 0 })).toEqual({ steps: [], columns: 4 });
  });
});
