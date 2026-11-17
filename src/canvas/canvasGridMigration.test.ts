import { describe, expect, it } from 'vitest';
import { createGuestUserData, type Card } from '@/data/dataModels';
import { DRAWN_GRID, snapCardToGrid } from '@/rendering/Grid';
import { required } from '@/utils/required';
import type { CanvasArea } from './canvasAreas';
import { CANVAS_GRID_VERSION, migrateCanvasGrid } from './canvasGridMigration';

function fixture(cell = 55, gridVersion?: 2 | 3) {
  const bounds = { x: -4 * cell, y: -cell, width: 10 * cell, height: 12 * cell };
  const regions = { spellbook: { x: 0, y: 0, width: 4 * cell, height: 5 * cell },
    atlas: { x: 4 * cell, y: 2 * cell, width: 4 * cell, height: 3 * cell } };
  const label = { id: 'label', text: 'Opening spells', areaId: 'deck', x: cell, y: 0, board: 'mainboard' as const };
  const spell = { x: 2 * cell - 50, y: 2.5 * cell - 70 };
  const site = { x: 3.5 * cell - 70, y: 3 * cell - 50 };
  const phoneSpell = { x: spell.x + cell, y: spell.y + cell };
  const phoneSite = { x: site.x + cell, y: site.y + cell };
  const phoneLabel = { x: 2 * cell, y: cell };
  const area: CanvasArea = {
    id: 'deck', name: 'Deck', type: 'deck', pinned: true, bounds,
    deckRegionBounds: regions,
    cards: [
      { id: 'spell', cardName: 'Spell', board: 'mainboard', ...spell, labelId: label.id },
      { id: 'spell-copy', cardName: 'Spell', board: 'mainboard', ...spell, labelId: label.id },
      { id: 'site', cardName: 'Site', board: 'mainboard', ...site },
    ],
    deckVariants: [{ id: 'v', name: 'Variant', activeCardIds: ['spell', 'site'] }],
    activeDeckVariantId: 'v',
    layoutProfiles: { source: 'desktop', desktop: {
      bounds, regions, cards: { spell, site }, labels: { label: { x: cell, y: 0 } },
    }, phone: {
      bounds: { ...bounds, x: -5 * cell }, regions, cards: { spell: phoneSpell, site: phoneSite },
      labels: { label: phoneLabel },
    } },
    sectionLayouts: { atlas: { activeId: 'default', tabs: [
      { id: 'default', name: 'Default' },
      { id: 'archived', name: 'Archived', mode: 'custom', cardLabels: { site: 'atlas-label' }, positions: { source: 'phone',
        phone: { cards: { site: phoneSite }, labels: { 'atlas-label': phoneLabel } },
      } },
    ] } },
  };
  return { ...createGuestUserData('guest'), gridVersion, canvasAreas: [area], canvasLabels: [label,
    { id: 'free', text: 'Nearby', x: -2 * cell, y: 3 * cell },
  ] };
}

describe('canvas grid migration', () => {
  it.each([[undefined, 55], [2, 75], [3, 65]] as const)('migrates cards, frames, labels and saved positions once from v%s', (gridVersion, oldCell) => {
    const oldData = fixture(oldCell, gridVersion);
    const original = structuredClone(oldData);
    const newData = migrateCanvasGrid(oldData);
    expect(oldData).toEqual(original);
    expect(newData.gridVersion).toBe(CANVAS_GRID_VERSION);
    expect(migrateCanvasGrid(newData)).toBe(newData);

    const area = required(newData.canvasAreas?.[0]);
    const oldArea = required(oldData.canvasAreas[0]);
    const cell = DRAWN_GRID.width;
    const spell = { x: 2 * cell - 50, y: 2.5 * cell - 70 };
    const site = { x: 3.5 * cell - 70, y: 3 * cell - 50 };
    const phoneSpell = { x: spell.x + cell, y: spell.y + cell };
    const phoneSite = { x: site.x + cell, y: site.y + cell };
    const phoneLabel = { x: 2 * cell, y: cell };
    expect(area.bounds).toEqual({ x: -4 * cell, y: -cell, width: 10 * cell, height: 12 * cell });
    expect(area.deckRegionBounds?.atlas).toEqual({ x: 4 * cell, y: 2 * cell, width: 4 * cell, height: 3 * cell });
    expect(area.cards.map(({ x, y }) => ({ x, y }))).toEqual([spell, spell, site]);
    for (const [index, { x, y, ...identity }] of area.cards.entries()) {
      expect({ x, y }).toEqual(snapCardToGrid(x, y, identity.cardName === 'Site'));
      expect({ ...required(oldArea.cards[index]), x, y }).toEqual({ ...identity, x, y });
    }
    expect(area.deckVariants).toEqual(oldArea.deckVariants);
    expect(area.activeDeckVariantId).toBe(oldArea.activeDeckVariantId);
    expect(area.layoutProfiles?.desktop?.cards).toEqual({ spell, site });
    expect(area.layoutProfiles?.phone).toMatchObject({ bounds: { x: -5 * cell },
      regions: { atlas: { x: 4 * cell, y: 2 * cell } },
      cards: { spell: phoneSpell, site: phoneSite }, labels: { label: phoneLabel },
    });
    expect(area.sectionLayouts?.atlas?.tabs.find(tab => tab.id === 'archived')).toMatchObject({ mode: 'custom',
      cardLabels: { site: 'atlas-label' }, positions: { phone: {
        cards: { site: phoneSite }, labels: { 'atlas-label': phoneLabel },
      } },
    });
    expect(newData.canvasLabels).toEqual([
      { ...required(oldData.canvasLabels[0]), x: cell, y: 0 },
      { ...required(oldData.canvasLabels[1]), x: -2 * cell, y: 3 * cell },
    ]);
  });

  it('uses loaded card metadata to preserve fractional placement for older off-grid cards', () => {
    const oldData = fixture();
    const site = required(required(oldData.canvasAreas[0]).cards[2]);
    // This old position falls on the portrait lattice, so the catalogue is needed to identify its card center.
    site.x = 5;
    site.y = 12.5;
    const metadata: Card = { name: 'Site', elements: '', subTypes: '', sets: [], guardian: {
      cost: null, type: 'Site', rarity: null, rulesText: '', attack: null, defence: null, life: null,
      thresholds: { air: 0, earth: 0, fire: 0, water: 0 },
    } };
    const next = required(migrateCanvasGrid(oldData, [metadata]).canvasAreas?.[0]?.cards[2]);
    expect(next.x + 70).toBeCloseTo((site.x + 70) * DRAWN_GRID.width / 55);
    expect(next.y + 50).toBeCloseTo((site.y + 50) * DRAWN_GRID.height / 55);
  });
});
