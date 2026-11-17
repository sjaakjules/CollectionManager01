import { describe, expect, it } from 'vitest';
import { createSpellbookLayout, type CatalogueLayoutConfig } from '@/data/catalogueLayout';
import type { Card, Thresholds } from '@/data/dataModels';
import { CARD_SIZE, DRAWN_GRID, getCardCellSpacing, getCardPixelSize, getStackFan, snapCardCenter, snapCardToGrid } from '@/rendering/Grid';
import { required } from '@/utils/required';
import type { CanvasCardInstance } from './canvasAreas';
import { arrangeCardsByLayout } from './cardLayoutPipeline';
import { DECK_SECTION_HEADER_HEIGHT, getMainDeckSectionRects } from './deckBoardLayout';

const metadata = (name: string, type: string, cost: number | null, thresholds: Partial<Thresholds> = {}): Card => ({
  name, elements: '', subTypes: '', sets: [], guardian: { type, cost, rarity: null, rulesText: '',
    attack: null, defence: null, life: null, thresholds: { air: 0, earth: 0, fire: 0, water: 0, ...thresholds } },
});
const instance = (name: string, id = name): CanvasCardInstance => ({ id, cardName: name, x: 5, y: 12.5, board: 'mainboard' });
const region = { x: 0, y: 0, width: 900, height: 600 };
const resolver = (cards: Card[]) => {
  const byName = new Map(cards.map((card) => [card.name, card]));
  return (name: string) => byName.get(name);
};

describe('Spellbook layout presets', () => {
  it('places equal costs next to each other, separates higher costs by a grid cell, and keeps copies together', () => {
    const cards = [metadata('Four', 'Minion', 4), metadata('One', 'Minion', 1), metadata('Also one', 'Minion', 1),
      metadata('Free', 'Minion', 0), metadata('Aura', 'Aura', 0), metadata('Magic', 'Magic', 1), metadata('Artifact', 'Artifact', 1)];
    const instances = [...cards.map(card => instance(card.name)), instance('One', 'copy')];
    const positions = arrangeCardsByLayout(instances, resolver(cards), createSpellbookLayout('cost'), { region });
    const point = (key: string) => required(positions.get(key));
    expect(point('Also one').x - point('Free').x).toBe(3 * DRAWN_GRID.width);
    expect(point('One').x - point('Also one').x).toBe(2 * DRAWN_GRID.width);
    expect(point('Four').x - point('One').x).toBe(3 * DRAWN_GRID.width);
    expect(point('Four').y).toBe(point('Free').y);
    expect(point('copy')).toEqual(point('One'));
    expect(point('Magic').y).toBe(point('Aura').y);
    expect(point('Aura').y).toBeGreaterThan(point('One').y + CARD_SIZE.PORTRAIT.height + getStackFan(2, false).overhang);
    expect(point('Artifact').y).toBeGreaterThan(point('Magic').y + CARD_SIZE.PORTRAIT.height);
    for (const p of positions.values()) {
      const x = p.x + CARD_SIZE.PORTRAIT.width / 2, y = p.y + CARD_SIZE.PORTRAIT.height / 2;
      expect(snapCardCenter(x, y, false)).toEqual({ x, y });
    }
  });

  it('groups exact elemental requirements independently of cost or input order', () => {
    const cards = [metadata('Both', 'Minion', 1, { air: 1, fire: 1 }), metadata('Two air', 'Minion', 1, { air: 2 }),
      metadata('Fire', 'Minion', 2, { fire: 1 }), metadata('Air', 'Minion', 5, { air: 1 }),
      metadata('Unbound', 'Minion', 0), metadata('Lantern', 'Artifact', 1)];
    const positions = arrangeCardsByLayout(cards.map(card => instance(card.name)), resolver(cards), createSpellbookLayout('threshold'), { region });
    const point = (key: string) => required(positions.get(key));
    expect(['Air', 'Two air', 'Fire', 'Both', 'Unbound'].map(key => point(key).x - point('Air').x))
      .toEqual(Array.from({ length: 5 }, (_, index) => index * 3 * DRAWN_GRID.width));
    expect(point('Lantern').y).toBeGreaterThan(point('Unbound').y);
  });

  it.each([10, 1])('aligns stacks and keeps the first row through cost re-sorts at width %i', (columns) => {
    const cards = [metadata('One', 'Minion', 1), metadata('Two', 'Minion', 2), metadata('Three', 'Minion', 3)];
    const instances = [instance('One'), instance('Two'), instance('Two', 'two-copy'),
      instance('Three'), instance('Three', 'three-copy1'), instance('Three', 'three-copy2')];
    const ascending: CatalogueLayoutConfig = { ...createSpellbookLayout('cost'), columnMode: 'limit', columns };
    const descending: CatalogueLayoutConfig = { ...ascending, steps: ascending.steps.map((step) => (
      step.field === 'cost' ? { ...step, direction: 'desc' } : step
    )) };
    const place = (entries: CanvasCardInstance[], layout: CatalogueLayoutConfig, bounds = region) => {
      const positions = arrangeCardsByLayout(entries, resolver(cards), layout, {
        region: bounds, preserveTopRow: true, aspectRatio: columns === 1 ? 0.4 : 16 / 9,
      });
      return entries.map((entry) => ({ ...entry, ...required(positions.get(entry.id)) }));
    };
    const initial = place(instances, ascending);
    const section = required(getMainDeckSectionRects(initial, () => false).spellbook);
    const reversed = place(initial, descending, section);
    const reversedSection = required(getMainDeckSectionRects(reversed, () => false).spellbook);
    const restored = place(reversed, ascending, reversedSection);
    const point = (entries: CanvasCardInstance[], id: string) => required(entries.find((card) => card.id === id));
    if (columns > 1) {
      expect(new Set(initial.map((card) => card.y)).size).toBe(1);
      expect(new Set(reversed.map((card) => card.y)).size).toBe(1);
      expect(point(initial, 'One').x).toBeLessThan(point(initial, 'Three').x);
      expect(point(reversed, 'Three').x).toBeLessThan(point(reversed, 'One').x);
      expect(reversedSection).toEqual(section);
    } else {
      expect(point(initial, 'One').y).toBeLessThan(point(initial, 'Three').y);
      expect(point(reversed, 'Three').y).toBeLessThan(point(reversed, 'One').y);
    }
    expect(point(reversed, 'Three').y).toBe(point(initial, 'One').y);
    expect(restored).toEqual(initial);
  });
});

describe('card layout geometry', () => {
  it('turns the primary sort and group axes independently', () => {
    const cards = [metadata('A', 'Minion', 0), metadata('B', 'Minion', 0), metadata('C', 'Magic', 0)];
    const instances = cards.map((card) => instance(card.name));
    const layout: CatalogueLayoutConfig = { columns: 1, steps: [
      { field: 'type', mode: 'group', direction: 'asc', axis: 'horizontal' },
      { field: 'name', mode: 'sort', direction: 'desc', axis: 'vertical' },
    ] };
    const positions = arrangeCardsByLayout(instances, resolver(cards), layout, { region });
    const second = required(positions.get('A'));
    const first = required(positions.get('B'));
    const nextGroup = required(positions.get('C'));
    expect(first.x).toBe(second.x);
    expect(first.y).toBeLessThan(second.y);
    expect(nextGroup.x - first.x).toBeGreaterThanOrEqual(CARD_SIZE.PORTRAIT.width + DRAWN_GRID.width);
    expect(nextGroup.y).toBe(first.y);
  });

  it('honors narrower group widths inside an already wide region', () => {
    const cards = ['A', 'B', 'C'].map((name) => metadata(name, 'Minion', 0));
    const instances = cards.map((card) => instance(card.name));
    const layout = createSpellbookLayout('cost');
    const narrow = arrangeCardsByLayout(instances, resolver(cards), { ...layout, columns: 1, columnMode: 'limit' }, { region });
    const wide = arrangeCardsByLayout(instances, resolver(cards), layout, { region });
    expect(new Set([...narrow.values()].map((point) => point.x)).size).toBe(1);
    expect(new Set([...wide.values()].map((point) => point.y)).size).toBe(1);
    expect(required(narrow.get('C')).y).toBeGreaterThan(required(narrow.get('A')).y);
  });

  it('uses the width limit within each leaf while fitting the entire cost layout to the viewport', () => {
    const cards = Array.from({ length: 24 }, (_, index) => metadata(`Card ${index}`, 'Minion', Math.floor(index / 4)));
    const instances = cards.map((card) => instance(card.name));
    const layout: CatalogueLayoutConfig = { columns: 2, columnMode: 'limit', steps: [
      { field: 'cost', mode: 'group', direction: 'asc', axis: 'horizontal' },
      { field: 'type', mode: 'sort', direction: 'desc', axis: 'vertical' },
    ] };
    const wide = arrangeCardsByLayout(instances, resolver(cards), layout, { region, aspectRatio: 2 });
    const tall = arrangeCardsByLayout(instances, resolver(cards), layout, { region, aspectRatio: 0.5 });
    const width = (positions: ReadonlyMap<string, { x: number; y: number }>) => {
      const xs = [...positions.values()].map((point) => point.x);
      return Math.max(...xs) - Math.min(...xs) + CARD_SIZE.PORTRAIT.width;
    };
    expect(width(wide)).toBeGreaterThan(width(tall));
    expect(new Set([...wide.values()].map((point) => point.x)).size).toBeGreaterThan(layout.columns);
    for (let cost = 0; cost < 6; cost++) {
      const group = cards.filter((card) => card.guardian.cost === cost).map((card) => required(wide.get(card.name)));
      expect(new Set(group.map((point) => point.x)).size).toBeLessThanOrEqual(layout.columns);
    }
  });

  it('balances vertical sorting in larger cost groups on a wide canvas', () => {
    const cards = Array.from({ length: 40 }, (_, index) => metadata(`Card ${index}`, 'Minion', Math.floor(index / 8)));
    const layout: CatalogueLayoutConfig = { columns: 16, columnMode: 'auto', steps: [
      { field: 'cost', mode: 'group', direction: 'asc', axis: 'horizontal' },
      { field: 'type', mode: 'sort', direction: 'desc', axis: 'vertical' },
    ] };
    const placed = arrangeCardsByLayout(cards.map((card) => instance(card.name)), resolver(cards), layout, { region, aspectRatio: 2 });
    const xs = [...placed.values()].map((point) => point.x);
    const ys = [...placed.values()].map((point) => point.y);
    expect(Math.max(...xs) - Math.min(...xs) + CARD_SIZE.PORTRAIT.width)
      .toBeGreaterThan(Math.max(...ys) - Math.min(...ys) + CARD_SIZE.PORTRAIT.height);
    const firstCost = cards.slice(0, 8).map((card) => required(placed.get(card.name)));
    expect(new Set(firstCost.map((point) => point.x)).size).toBeGreaterThan(1);
  });

  it('does not mix identical names under different labels; retains unknown cards and orientation', () => {
    const instances = [
      { ...instance('Minion', 'first'), labelId: 'one' },
      { ...instance('Minion', 'second'), labelId: 'two' },
      { ...instance('Minion', 'copy'), labelId: 'one', board: null },
      instance('Site'), instance('Unknown'),
    ].map((entry) => Object.freeze(entry));
    const cards = [metadata('Minion', 'Minion', 1), metadata('Site', 'Site', null)];
    const origin = { x: -41, y: -108 };
    const positions = arrangeCardsByLayout(instances, resolver(cards), { columns: 3, steps: [] }, { region, origin });
    expect(positions.size).toBe(instances.length);
    expect(positions.get('first')).toEqual(positions.get('copy'));
    expect(positions.get('first')).not.toEqual(positions.get('second'));
    for (const entry of instances) {
      const point = required(positions.get(entry.id));
      expect(snapCardToGrid(point.x, point.y, entry.cardName === 'Site')).toEqual(point);
      expect(point.x).toBeGreaterThanOrEqual(origin.x);
      expect(point.y).toBeGreaterThanOrEqual(origin.y);
    }
  });

  it.each([false, true])('fits full fans in consecutive rows when layout wraps (landscape=%s)', landscape => {
    const type = landscape ? 'Site' : 'Minion';
    const cards = [metadata('A', type, 0), metadata('B', type, 0)];
    const count = 7;
    const instances = cards.flatMap(({ name }) => [instance(name),
      ...Array.from({ length: count - 1 }, (_, n) => instance(name, `${name}-copy${n}`))]);
    const { overhang } = getStackFan(count, landscape);
    const layout: CatalogueLayoutConfig = { ...createSpellbookLayout('cost'), columns: 1, columnMode: 'limit' };
    const positions = arrangeCardsByLayout(instances, resolver(cards), layout, { region });
    const upper = required(positions.get('A'));
    const lower = required(positions.get('B'));
    expect(upper.y - overhang).toBeGreaterThanOrEqual(region.y + DECK_SECTION_HEADER_HEIGHT);
    expect(lower.y - upper.y).toBe(getCardCellSpacing(landscape).y * DRAWN_GRID.height);
    expect(lower.y - overhang).toBe(upper.y + getCardPixelSize(landscape).height + overhang);
    const laidOut = instances.map((entry) => ({ ...entry, ...required(positions.get(entry.id)) }));
    const section = required(getMainDeckSectionRects(laidOut, () => landscape)[landscape ? 'atlas' : 'spellbook']);
    expect(arrangeCardsByLayout(laidOut, resolver(cards), layout, { region: section })).toEqual(positions);
  });
});
