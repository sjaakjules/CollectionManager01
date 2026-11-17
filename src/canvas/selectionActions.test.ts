import { describe, expect, it } from 'vitest';
import type { Card, CanvasLabel, Thresholds } from '@/data/dataModels';
import { CARD_SIZE, SNAP_GRID, snapCardToGrid } from '@/rendering/Grid';
import { required } from '@/utils/required';
import type { CanvasArea, CanvasCardInstance } from './canvasAreas';
import { cardBounds } from './labelRegions';
import { cleanUpDeckSelection, getDeckSelectionActions, quickSortDeckSelection } from './selectionActions';

function metadata(name: string, cost: number | null, power: number | null, type = 'Minion', pips: Partial<Thresholds> = {}): Card {
  return { name, sets: [], elements: '', subTypes: '', guardian: {
    cost, attack: power, type, rarity: null, rulesText: '', defence: null, life: null,
    thresholds: { air: 0, earth: 0, fire: 0, water: 0, ...pips },
  } };
}

function card(id: string, cardName: string, x: number, y: number, options: {
  board?: CanvasCardInstance['board']; labelId?: string; landscape?: boolean;
} = {}): CanvasCardInstance {
  return { id, cardName, board: options.board ?? 'mainboard', labelId: options.labelId,
    ...snapCardToGrid(x, y, options.landscape ?? false) };
}

function deck(cards: CanvasCardInstance[], activeCardIds = cards.map((entry) => entry.id)): CanvasArea {
  return { id: 'deck', name: 'Deck', pinned: true, type: 'deck', cards,
    bounds: { x: 0, y: 0, width: 2300, height: 2800 },
    deckVariants: [{ id: 'variant', name: 'Variant', activeCardIds }], activeDeckVariantId: 'variant',
  };
}

function keys(cards: CanvasCardInstance[]): Set<string> {
  return new Set(cards.map((entry) => `deck:${entry.id}`));
}

const point = ({ x, y }: CanvasCardInstance) => ({ x, y });
const readingOrder = (a: CanvasCardInstance, b: CanvasCardInstance) => a.y - b.y || a.x - b.x;

describe('quick sorting selected stacks', () => {
  it('sorts by the card on top in the active variant and uses exactly the existing stack positions', () => {
    const cards = [metadata('Strong', 1, 8), metadata('Weak', 1, 0), metadata('Medium', 1, 4)];
    const common = { labelId: 'spells' };
    const strong = card('strong', 'Strong', 450, 600, common);
    const weak = card('weak', 'Weak', strong.x, strong.y, common);
    const medium = card('medium', 'Medium', 750, 600, common);
    const area = deck([strong, weak, medium], ['strong', 'medium']);
    const labels: CanvasLabel[] = [{ id: 'spells', text: 'Spells', areaId: 'deck', x: 450, y: 350 }];
    const saved = structuredClone(area);
    const result = quickSortDeckSelection([area], labels, keys(area.cards), cards, 'power');
    const planned = required(result.areas[0]);
    expect(planned.cards.map(point)).toEqual([point(medium), point(medium), point(strong)]);
    expect(planned.cards.map((entry) => entry.id)).toEqual(['strong', 'weak', 'medium']);
    expect(planned.deckVariants).toBe(area.deckVariants);
    expect(planned.cards.map((entry) => entry.labelId)).toEqual(['spells', 'spells', 'spells']);
    expect(result.labels).toBe(labels);
    expect(area).toEqual(saved);
  });

  it('preserves legacy offsets within a stack and leaves partial stacks and other partitions in place', () => {
    const cards = [metadata('A', 4, 1), metadata('Z', 2, 2), metadata('Site', null, null, 'Site')];
    const snappedLeft = card('left', 'Z', 450, 600, { labelId: 'active' });
    const left = { ...snappedLeft, x: snappedLeft.x + 6, y: snappedLeft.y + 5 };
    const leftCopy = { ...left, id: 'left-copy', y: left.y + 6 };
    const snappedRight = card('right', 'A', 1050, 600, { labelId: 'active' });
    const right = { ...snappedRight, x: snappedRight.x - 11, y: snappedRight.y - 14 };
    const partial = card('partial', 'A', 750, 600, { labelId: 'active' });
    const unselected = { ...partial, id: 'unselected' };
    const collection = card('collection', 'A', 300, 600, { board: 'collection', labelId: 'active' });
    const otherLabel = card('other', 'A', 150, 600, { labelId: 'another' });
    const site = card('site', 'Site', 150, 600, { landscape: true, labelId: 'active' });
    const area = deck([left, leftCopy, partial, unselected, right, collection, otherLabel, site]);
    const selected = keys(area.cards.filter((entry) => entry !== unselected));
    const next = required(quickSortDeckSelection([area], [], selected, cards, 'name').areas[0]).cards;
    expect(point(required(next[0]))).toEqual(point(right));
    expect(point(required(next[1]))).toEqual({ x: right.x, y: right.y + 6 });
    expect(point(required(next[4]))).toEqual(point(left));
    for (const index of [2, 3, 5, 6, 7]) expect(next[index]).toBe(area.cards[index]);
  });

  it('keeps a legacy stack together when translating to the exact target would split it', () => {
    const cards = [metadata('A', 4, 1), metadata('Z', 2, 2)];
    const left = card('left', 'Z', 450, 600);
    const copy = { ...left, id: 'copy', y: left.y + SNAP_GRID.height / 3 };
    const snappedRight = card('right', 'A', 1050, 600);
    const right = { ...snappedRight, y: snappedRight.y + SNAP_GRID.height / 3 };
    const area = deck([left, copy, right]);
    expect(quickSortDeckSelection([area], [], keys(area.cards), cards, 'name').areas[0]).toBe(area);
  });

  it('offers only applicable actions for a single stack, partial stack, or complete stacks', () => {
    const cards = [metadata('A', 1, 1), metadata('Pilot', null, null, 'Avatar')];
    const first = card('first', 'A', 450, 600);
    const firstCopy = { ...first, id: 'first-copy' };
    const second = card('second', 'A', 750, 600);
    const secondCopy = { ...second, id: 'second-copy' };
    const pilot = card('pilot', 'Pilot', 900, 150, { board: 'avatar' });
    const area = deck([first, firstCopy, second, secondCopy, pilot]);
    expect(getDeckSelectionActions([area], keys([first, pilot]), cards))
      .toEqual({ canLayout: false, canQuickSort: false, canCleanUp: false });
    expect(getDeckSelectionActions([area], keys([first, firstCopy, pilot]), cards))
      .toEqual({ canLayout: false, canQuickSort: false, canCleanUp: false });
    expect(getDeckSelectionActions([area], keys([first, firstCopy, second, pilot]), cards))
      .toEqual({ canLayout: true, canQuickSort: false, canCleanUp: true });
    expect(getDeckSelectionActions([area], keys(area.cards), cards))
      .toEqual({ canLayout: true, canQuickSort: true, canCleanUp: true });
  });
});

describe('cleaning up selected cards', () => {
  it('leaves a single physical stack intact even when different cards share its position', () => {
    const cards = [metadata('A', 1, 1), metadata('B', 2, 1)];
    const first = card('first', 'A', 450, 600);
    const second = { ...first, id: 'second', cardName: 'B', y: first.y + 5 };
    const areas = [deck([first, second])];
    const labels: CanvasLabel[] = [];
    const selected = keys([first, second]);
    expect(getDeckSelectionActions(areas, selected, cards).canCleanUp).toBe(false);
    const result = cleanUpDeckSelection(areas, labels, selected, cards, 2);
    expect(result.areas).toBe(areas);
    expect(result.labels).toBe(labels);
  });

  it('merges same-name stacks while retaining copies in different labels, sections and decks', () => {
    const cards = [metadata('A', 1, 1), metadata('Site', null, null, 'Site')];
    const first = card('first', 'A', 450, 600, { labelId: 'group' });
    const second = { ...first, id: 'second' };
    const third = card('third', 'A', 1050, 1200, { labelId: 'group' });
    const otherLabel = card('other-label', 'A', 150, 600, { labelId: 'different' });
    const collection = card('collection', 'A', 450, 1500, { board: 'collection', labelId: 'group' });
    const atlas = card('atlas', 'Site', 150, 300, { landscape: true, labelId: 'group' });
    const differentDeck = { ...deck([card('other-deck', 'A', 1650, 2400, { labelId: 'group' })]), id: 'different' };
    const area = deck([first, second, third, otherLabel, collection, atlas]);
    const selected = keys(area.cards);
    selected.add('different:other-deck');
    const areas = [area, differentDeck];
    expect(getDeckSelectionActions(areas, keys([first, otherLabel, collection, atlas]), cards).canCleanUp).toBe(false);
    expect(getDeckSelectionActions(areas, new Set(['deck:first', 'different:other-deck']), cards).canCleanUp).toBe(false);
    expect(getDeckSelectionActions(areas, selected, cards).canCleanUp).toBe(true);
    const result = cleanUpDeckSelection(areas, [], selected, cards, 2);
    const arranged = required(result.areas[0]);
    expect(arranged.cards.slice(0, 3).map(point)).toEqual(Array.from({ length: 3 }, () => point(required(arranged.cards[0]))));
    expect(arranged.cards[3]).toBe(otherLabel);
    expect(arranged.cards[4]).toBe(collection);
    expect(arranged.cards[5]).toBe(atlas);
    expect(result.areas[1]).toBe(differentDeck);
    expect(arranged.deckVariants).toBe(area.deckVariants);
    expect(getDeckSelectionActions(result.areas, selected, cards).canCleanUp).toBe(false);
  });

  it('fits a compact cost-sorted rectangle to the viewport and keeps fanned copies and memberships', () => {
    const cards = Array.from({ length: 12 }, (_, i) => metadata(`Spell ${i}`, 12 - i, 1));
    const selected = cards.map((entry, i) => card(entry.name, entry.name, 300 + i % 4 * 450,
      600 + Math.floor(i / 4) * 450, { labelId: 'spells' }));
    const low = required(cards.at(-1));
    selected.push(card('copy1', low.name, 825, 600, { labelId: 'spells' }),
      card('copy2', low.name, 450, 1800, { labelId: 'spells' }));
    const untouched = card('untouched', 'Spell 0', 2100, 2100, { board: 'maybeboard' });
    const area = deck([...selected, untouched]);
    const labels: CanvasLabel[] = [{ id: 'spells', text: 'Spells', areaId: 'deck', x: 300, y: 450 }];
    const wide = cleanUpDeckSelection([area], labels, keys(selected), cards, 16 / 9);
    const tall = cleanUpDeckSelection([area], labels, keys(selected), cards, 9 / 16);
    const wideArea = required(wide.areas[0]);
    function footprint(entries: CanvasCardInstance[]) {
      const rendered = [...cardBounds(entries.filter((entry) => entry !== untouched), () => false).values()];
      const width = Math.max(...rendered.map((bounds) => bounds.x + bounds.width)) - Math.min(...rendered.map((bounds) => bounds.x));
      const height = Math.max(...rendered.map((bounds) => bounds.y + bounds.height)) - Math.min(...rendered.map((bounds) => bounds.y));
      return { width, height, rendered };
    }
    const wideFootprint = footprint(wideArea.cards);
    const tallFootprint = footprint(required(tall.areas[0]).cards);
    expect(wideFootprint.width).toBeGreaterThan(wideFootprint.height);
    expect(tallFootprint.width).toBeLessThan(tallFootprint.height);
    expect(wideFootprint.width).toBeLessThan(4 * 450);
    const sorted = wideArea.cards.filter((entry) => entry !== untouched && !entry.id.startsWith('copy')).sort(readingOrder);
    expect(sorted.map((entry) => entry.cardName)).toEqual(cards.map((entry) => entry.name).reverse());
    const stack = wideArea.cards.filter((entry) => entry.cardName === low.name);
    expect(stack.map(point)).toEqual(Array.from({ length: 3 }, () => point(required(stack[0]))));
    const fan = required(cardBounds(wideArea.cards, () => false).get('copy1'));
    expect(fan.height).toBeGreaterThan(CARD_SIZE.PORTRAIT.height);
    for (const bounds of wideFootprint.rendered.filter((entry) => entry.y > fan.y && entry.x === fan.x)) {
      expect(bounds.y).toBeGreaterThanOrEqual(fan.y + fan.height);
    }
    expect(wideArea.cards.at(-1)).toBe(untouched);
    expect(wideArea.cards.map(({ id, board, labelId }) => ({ id, board, labelId })))
      .toEqual(area.cards.map(({ id, board, labelId }) => ({ id, board, labelId })));
    expect(wideArea.deckVariants).toBe(area.deckVariants);
    expect(wide.labels.map((label) => label.id)).toEqual(['spells']);
  });

  it('sorts Atlas stacks by element on the landscape grid', () => {
    const cards = [metadata('Wetland', null, null, 'Site', { water: 1 }),
      metadata('Cavern', null, null, 'Site', { earth: 1 }), metadata('Alpine', null, null, 'Site', { air: 1 })];
    const entries = cards.map((entry, index) => card(entry.name, entry.name, 450 + index * 2 * SNAP_GRID.width,
      675 + index * SNAP_GRID.height, { landscape: true }));
    const planned = required(cleanUpDeckSelection([deck(entries)], [], keys(entries), cards, 2).areas[0]).cards;
    expect([...planned].sort(readingOrder).map((entry) => entry.cardName)).toEqual(['Alpine', 'Cavern', 'Wetland']);
    for (const entry of planned) expect(point(entry)).toEqual(snapCardToGrid(entry.x, entry.y, true));
  });
});
