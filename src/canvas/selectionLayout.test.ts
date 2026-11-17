import { describe, expect, it } from 'vitest';
import type { Card, CanvasLabel } from '@/data/dataModels';
import { createSelectionLayout, type CatalogueLayoutConfig } from '@/data/catalogueLayout';
import { getCardCellSpacing, getCardPixelSize, SNAP_GRID, snapCardToGrid } from '@/rendering/Grid';
import { required } from '@/utils/required';
import type { CanvasArea, CanvasAreaBounds, CanvasCardInstance } from './canvasAreas';
import { cardBounds, getLabelHeadingBounds, LABEL_CARD_GAP } from './labelRegions';
import { arrangeDeckSelection } from './selectionLayout';
import { deckStackPositionKey, getDeckStackPosition } from './cardStacks';

const layout: CatalogueLayoutConfig = { columns: 6, steps: [
  { field: 'cost', mode: 'sort', direction: 'asc', axis: 'horizontal' },
] };
const groupedLayout: CatalogueLayoutConfig = { columns: 16, columnMode: 'auto', steps: [
  { field: 'cost', mode: 'group', direction: 'asc', axis: 'horizontal' },
  { field: 'type', mode: 'sort', direction: 'desc', axis: 'vertical' },
] };

function metadata(name: string, type: string, cost: number | null): Card {
  return { name, elements: '', subTypes: '', sets: [], guardian: {
    type, cost, rarity: null, rulesText: '', attack: null, defence: null, life: null,
    thresholds: { air: 0, earth: 0, fire: 0, water: 0 },
  } };
}

const cards = [metadata('Early', 'Minion', 1), metadata('Late', 'Magic', 5),
  metadata('Alpine', 'Site', null), metadata('Wetland', 'Site', null), metadata('Pilot', 'Avatar', null)];
const isLandscape = (name: string) => cards.some(card => card.name === name && card.guardian.type === 'Site');

function instance(id: string, cardName: string, x: number, y: number, board: CanvasCardInstance['board'] = 'mainboard',
  labelId?: string): CanvasCardInstance {
  return { id, cardName, board, ...snapCardToGrid(x, y, isLandscape(cardName)), ...(labelId ? { labelId } : {}) };
}

function zone(id: string, cards: CanvasCardInstance[], x = 0): CanvasArea {
  return { id, name: id, pinned: true, type: 'deck', cards,
    bounds: { x, y: 0, width: 850, height: 1900 },
    deckVariants: [{ id: 'variant', name: 'Variant', activeCardIds: cards.filter(card => card.board === 'mainboard').map(card => card.id) }],
    activeDeckVariantId: 'variant',
  };
}

function overlaps(a: CanvasAreaBounds, b: CanvasAreaBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe('selection layout planning', () => {
  it('leaves the saved placement and labels alone until a step or Clean is added', () => {
    const areas = [zone('deck', [instance('one', 'Late', 5, 292.5), instance('two', 'Early', 505, 712.5)])];
    const labels = [{ id: 'heading', text: 'Heading', x: 5, y: 240, areaId: 'deck' }];
    const result = arrangeDeckSelection(areas, labels, new Set(['deck:one', 'deck:two']), cards, createSelectionLayout(), 2);
    expect(result.areas).toBe(areas);
    expect(result.labels).toBe(labels);
  });

  it('leaves inactive tab headings out of selection placement obstacles', () => {
    const instances = [instance('late', 'Late', 600, 600), instance('early', 'Early', 600, 900)];
    const areas = [zone('deck', instances)];
    const keys = new Set(instances.map(card => `deck:${card.id}`));
    const inactive: CanvasLabel = { id: 'inactive', text: 'Inactive', x: 0, y: 500, areaId: 'deck',
      deckSectionLayout: { section: 'spellbook', id: 'cost' } };
    const titleSize = () => ({ width: 1200, height: 500 });
    const visible = arrangeDeckSelection(areas, [], keys, cards, groupedLayout, 2, titleSize);
    const withInactive = arrangeDeckSelection(areas, [inactive], keys, cards, groupedLayout, 2, titleSize);
    expect(withInactive.areas).toEqual(visible.areas);
    expect(withInactive.labels[0]).toBe(inactive);
  });

  it('applies multiple sorts to the original slots in the first sort’s reading direction', () => {
    const metadataCards = [metadata('High', 'Minion', 5), metadata('Low A', 'Magic', 1),
      metadata('Low M', 'Magic', 1), metadata('Low Z', 'Aura', 1)];
    const slots = [instance('high', 'High', 300, 400), instance('a', 'Low A', 600, 400),
      instance('z', 'Low Z', 300, 800), instance('m', 'Low M', 600, 800)];
    const area = zone('deck', slots);
    const result = arrangeDeckSelection([area], [], new Set(slots.map((card) => `deck:${card.id}`)), metadataCards, {
      columns: 1, columnMode: 'limit', steps: [
        { field: 'cost', mode: 'sort', direction: 'asc', axis: 'vertical' },
        { field: 'name', mode: 'sort', direction: 'desc', axis: 'horizontal' },
      ],
    }, 3);
    const point = ({ x, y }: CanvasCardInstance) => ({ x, y });
    expect(required(result.areas[0]).cards.map(point)).toEqual([slots[3], slots[2], slots[0], slots[1]].map((card) => point(required(card))));
  });

  it('moves selected fragments as physical stacks and merges matching copies only with Clean', () => {
    const first = instance('first', 'Early', 300, 450);
    const mixed = { ...instance('mixed', 'Late', first.x, first.y), y: first.y + 5 };
    const still = { ...first, id: 'still' };
    const other = instance('copy', 'Early', 540, 1000);
    const area = zone('deck', [first, mixed, still, other]);
    const selected = new Set(['deck:first', 'deck:mixed', 'deck:copy']);
    const existing = required(arrangeDeckSelection([area], [], selected, cards, groupedLayout, 2).areas[0]).cards;
    const cleaned = required(arrangeDeckSelection([area], [], selected, cards, { ...groupedLayout, clean: true }, 2).areas[0]).cards;
    const slot = (card: CanvasCardInstance | undefined) => deckStackPositionKey(getDeckStackPosition(required(card), isLandscape));
    expect(slot(existing[0])).toBe(slot(existing[1]));
    expect(slot(existing[0])).not.toBe(slot(existing[2]));
    expect(slot(existing[0])).not.toBe(slot(existing[3]));
    expect(required(existing[1]).y - required(existing[0]).y).toBe(5);
    expect(slot(cleaned[0])).toBe(slot(cleaned[3]));
    expect(slot(cleaned[0])).not.toBe(slot(cleaned[1]));
    expect(cleaned[2]).toBe(still);
  });

  it('keeps IDs, boards, labels and variants when arranging cards in several decks', () => {
    const first = zone('first', [
      instance('late', 'Late', 5, 292.5, 'mainboard', 'spells'),
      instance('early', 'Early', 225, 512.5, 'mainboard', 'spells'),
      instance('collection', 'Late', 5, 952.5, 'collection', 'collection-label'),
      instance('maybe', 'Early', 5, 1392.5, 'maybeboard'),
      instance('untouched', 'Early', 665, 292.5, 'mainboard', 'spells'),
    ]);
    const second = zone('second', [
      instance('late', 'Late', 1205, 292.5, 'mainboard', 'second-spells'),
      instance('early', 'Early', 1425, 512.5, 'mainboard', 'second-spells'),
    ], 1200);
    const outside: CanvasArea = { ...zone('outside', [instance('late', 'Late', -1000, 290)]), type: 'stack' };
    const labels: CanvasLabel[] = [
      { id: 'spells', text: 'Spells', areaId: 'first', board: 'mainboard', x: 5, y: 200 },
      { id: 'collection-label', parentLabelId: 'spells', text: 'Copies', areaId: 'first', board: 'collection', x: 5, y: 840 },
      { id: 'second-spells', text: 'Main', areaId: 'second', board: 'mainboard', x: 1205, y: 200 },
    ];
    const areas = [first, second, outside];
    const before = structuredClone({ areas, labels });
    const keys = new Set(['first:late', 'first:early', 'first:collection', 'first:maybe', 'second:late', 'second:early', 'outside:late']);
    const plan = arrangeDeckSelection(areas, labels, keys, cards, layout);
    expect({ areas, labels }).toEqual(before);
    expect(plan.areas[2]).toBe(outside);
    expect(plan.areas[0]?.cards.find(card => card.id === 'untouched')).toBe(first.cards[4]);
    for (const source of [first, second]) {
      const next = required(plan.areas.find(area => area.id === source.id));
      expect(next.deckVariants).toEqual(source.deckVariants);
      expect(next.activeDeckVariantId).toBe(source.activeDeckVariantId);
      expect(next.cards.map(({ id, cardName, board, labelId }) => ({ id, cardName, board, labelId })))
        .toEqual(source.cards.map(({ id, cardName, board, labelId }) => ({ id, cardName, board, labelId })));
      expect(required(next.cards[1]).x).toBeLessThan(required(next.cards[0]).x);
    }
    expect(plan.labels.map(({ id, areaId, board, parentLabelId }) => ({ id, areaId, board, parentLabelId })))
      .toEqual(labels.map(({ id, areaId, board, parentLabelId }) => ({ id, areaId, board, parentLabelId })));
  });

  it.each([false, true])('preserves duplicate stack positions and clears an untouched stack (site=%s)', landscape => {
    const primary = landscape ? 'Alpine' : 'Early';
    const other = landscape ? 'Wetland' : 'Late';
    const selected = Array.from({ length: 3 }, (_, i) => instance(`selected-${i}`, primary, 5, 292.5));
    const first = required(selected[0]);
    const obstacleX = first.x + getCardCellSpacing(landscape).x * SNAP_GRID.width;
    const obstacle = Array.from({ length: 3 }, (_, i) => instance(`obstacle-${i}`, other, obstacleX, first.y));
    const area = zone('deck', [...selected, instance('second', other, 500, 750), ...obstacle]);
    const keys = new Set([...selected.map(card => `deck:${card.id}`), 'deck:second']);
    const result = arrangeDeckSelection([area], [], keys, cards, layout);
    const placed = required(result.areas[0]).cards;
    const rendered = cardBounds(placed, isLandscape);
    expect(placed.slice(0, 3).map(card => ({ x: card.x, y: card.y }))).toEqual(
      Array.from({ length: 3 }, () => ({ x: required(placed[0]).x, y: required(placed[0]).y })),
    );
    expect(required(rendered.get('selected-0')).height).toBeGreaterThan(getCardPixelSize(landscape).height);
    expect(placed.slice(-3)).toEqual(obstacle);
    for (const touched of placed.filter(card => keys.has(`deck:${card.id}`))) {
      for (const still of obstacle) {
        expect(overlaps(required(rendered.get(touched.id)), required(rendered.get(still.id)))).toBe(false);
      }
    }
  });

  it('stays centered near the selection when a chain of obstacles extends down the canvas', () => {
    const { width, height } = SNAP_GRID;
    const first = instance('first', 'Early', 5, 292.5);
    const second = instance('second', 'Late', first.x, first.y + 4 * height);
    const avatar = instance('avatar', 'Pilot', first.x + 2 * width, first.y, 'avatar');
    const blockers = Array.from({ length: 25 }, (_, index) => (
      instance(`obstacle-${index}`, 'Late', first.x + 2 * width, first.y + index * 2 * height)
    ));
    const area = zone('deck', [first, second, avatar, ...blockers]);
    const result = arrangeDeckSelection([area], [], new Set(['deck:first', 'deck:second', 'deck:avatar']), cards, groupedLayout);
    const placed = required(result.areas[0]).cards;
    expect(placed[2]).toBe(avatar);
    for (const [index, blocker] of blockers.entries()) expect(placed[index + 3]).toBe(blocker);
    const arrangedFirst = required(placed[0]);
    const arrangedSecond = required(placed[1]);
    expect(arrangedFirst.x).toBeLessThan(arrangedSecond.x);
    const dx = (arrangedFirst.x + arrangedSecond.x - first.x - second.x) / 2;
    const dy = (arrangedFirst.y + arrangedSecond.y - first.y - second.y) / 2;
    expect(Math.abs(dx)).toBeLessThanOrEqual(2.5 * width);
    expect(Math.abs(dy)).toBeLessThanOrEqual(2.5 * height);
    const blockedSlots = new Set(blockers.map((card) => deckStackPositionKey(getDeckStackPosition(card, isLandscape))));
    for (const card of [arrangedFirst, arrangedSecond]) {
      expect(blockedSlots.has(deckStackPositionKey(getDeckStackPosition(card, isLandscape)))).toBe(false);
    }
  });

  it('fits fully selected labels together around the old selection while leaving partial families local', () => {
    const fullIds = ['draw', 'misc', 'boost'];
    const rows = fullIds.flatMap((labelId, row) => [
      instance(`${labelId}-early`, 'Early', 600, 420 + row * 580, 'mainboard', labelId),
      instance(`${labelId}-late`, 'Late', 600, 680 + row * 580, 'mainboard', labelId),
    ]);
    const partial = [instance('child-early', 'Early', 1600, 900, 'mainboard', 'child'),
      instance('child-late', 'Late', 1600, 1250, 'mainboard', 'child')];
    const untouched = instance('still', 'Early', 1790, 1000, 'mainboard', 'parent');
    const parent: CanvasLabel = { id: 'parent', text: 'Parent', x: 1550, y: 700, areaId: 'deck' };
    const labels: CanvasLabel[] = [...fullIds.map((id, row) => ({
      id, text: id, x: required(rows[row * 2]).x, y: required(rows[row * 2]).y - 42, areaId: 'deck',
    })), parent, { id: 'child', text: 'Child', x: 1600, y: 840, areaId: 'deck', parentLabelId: parent.id }];
    const titleSize = () => ({ width: 210, height: 30 });
    const result = arrangeDeckSelection([zone('deck', [...rows, ...partial, untouched])], labels,
      new Set([...rows, ...partial].map((card) => `deck:${card.id}`)), cards, groupedLayout, 3,
      titleSize);
    const placed = required(result.areas[0]).cards;
    const full = placed.filter((card) => fullIds.includes(card.labelId ?? ''));
    const span = (entries: CanvasCardInstance[], axis: 'x' | 'y') => (
      Math.max(...entries.map((card) => card[axis])) - Math.min(...entries.map((card) => card[axis]))
    );
    expect(span(full, 'x')).toBeGreaterThan(span(full, 'y'));
    const center = (entries: CanvasCardInstance[], axis: 'x' | 'y') => Math.min(...entries.map((card) => card[axis])) + span(entries, axis) / 2;
    expect(Math.abs(center(full, 'y') - center(rows, 'y'))).toBeLessThanOrEqual(2.5 * SNAP_GRID.height);
    expect(new Set(full.map((card) => card.labelId))).toEqual(new Set(fullIds));
    expect(placed.at(-1)).toBe(untouched);
    expect(result.labels.find((label) => label.id === parent.id)).toBe(parent);
    const headings = getLabelHeadingBounds(result.labels, result.areas, isLandscape, titleSize);
    const childHeading = required(headings.get('child'));
    const parentHeading = required(headings.get('parent'));
    expect(parentHeading.y + parentHeading.height + LABEL_CARD_GAP).toBeLessThanOrEqual(childHeading.y);
    for (const label of result.labels.filter((entry) => fullIds.includes(entry.id))) {
      for (const card of full.filter((entry) => entry.labelId !== label.id)) {
        expect(overlaps(required(headings.get(label.id)),
          required(cardBounds(full, isLandscape).get(card.id)))).toBe(false);
      }
    }
  });

  it('clears a measured label heading above an enlarged four-copy fan', () => {
    const copies = Array.from({ length: 4 }, (_, index) => instance(`copy-${index}`, 'Early', 600, 700 + index * 200, 'mainboard', 'copies'));
    const first = required(copies[0]);
    const label: CanvasLabel = { id: 'copies', text: 'Copies', areaId: 'deck', x: first.x, y: first.y - 36 };
    const titleSize = () => ({ width: 120, height: 30 });
    const result = arrangeDeckSelection([zone('deck', copies)], [label], new Set(copies.map((card) => `deck:${card.id}`)), cards,
      { ...createSelectionLayout(), clean: true }, 2, titleSize);
    const placed = required(result.areas[0]).cards;
    const face = required(cardBounds(placed, isLandscape).get(first.id));
    const heading = required(getLabelHeadingBounds(result.labels, result.areas, isLandscape, titleSize).get(label.id));
    expect(face.height).toBeGreaterThan(getCardPixelSize(false).height);
    expect(heading.y + heading.height + LABEL_CARD_GAP).toBeLessThanOrEqual(face.y);
    expect(required(result.labels[0]).y - required(placed[0]).y).toBe(label.y - first.y);
  });
});
