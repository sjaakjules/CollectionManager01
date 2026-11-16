import { describe, expect, it } from 'vitest';
import { getLabelCards, getLabelFamily, getLabelRegionBounds, placeCardsBelowLabel, LABEL_CARD_GAP, ShakeDetector } from './labelRegions';
import type { CanvasLabel } from '@/data/dataModels';
import type { CanvasArea, CanvasCardInstance } from './canvasAreas';
import { CARD_SIZE, STACK_OFFSET, snapCardCenter } from '@/rendering/Grid';

function required<T>(value: T | undefined | null): T { if (value == null) throw new Error('Missing fixture'); return value; }

const labels: CanvasLabel[] = [
  { id: 'parent', text: 'Engine', x: 100, y: 100, areaId: 'deck', board: 'mainboard' },
  { id: 'child', text: 'Draw', x: 200, y: 200, areaId: 'deck', board: 'mainboard', parentLabelId: 'parent' },
  { id: 'empty', text: 'Loose', x: -5000, y: -5000, areaId: 'deck' },
];
const areas: CanvasArea[] = [{ id: 'deck', name: 'Deck', type: 'deck', pinned: true, bounds: { x: 0, y: 0, width: 1000, height: 1000 }, cards: [
  { id: 'a', cardName: 'Draw card', x: 250, y: 300, board: 'mainboard', labelId: 'child' },
  { id: 'b', cardName: 'Unrelated', x: 260, y: 310, board: 'mainboard' },
] }];

describe('explicit label membership', () => {
  it('includes nested members without capturing unrelated overlapping cards', () => {
    expect([...getLabelFamily(labels, 'parent')]).toEqual(['parent', 'child']);
    expect(getLabelCards(labels, 'parent', areas).map(card => card.id)).toEqual(['a']);
  });
  it('fits cards and nested label titles and ignores empty standalone labels', () => {
    const parent = required(labels[0]);
    const bounds = getLabelRegionBounds(labels, parent, areas, () => false, () => ({ width: 500, height: 36 }));
    expect(bounds?.x).toBe(86);
    expect(bounds?.y).toBe(86);
    expect(required(bounds).x + required(bounds).width).toBeGreaterThanOrEqual(714);
    expect(getLabelRegionBounds(labels, required(labels[2]), areas, () => false, () => ({ width: 200, height: 36 }))).toBeNull();
    expect(getLabelRegionBounds(labels, parent, [{ ...required(areas[0]), cards: [] }], () => false, () => ({ width: 200, height: 36 }))).toBeNull();
  });
  it('terminates safely if an old save contains a cyclic label relationship', () => {
    expect([...getLabelFamily([{ ...required(labels[0]), parentLabelId: 'child' }, required(labels[1])], 'parent')]).toEqual(['parent', 'child']);
  });
});

describe('dropping cards beneath a label heading', () => {
  const label: CanvasLabel = { id: 'heading', text: 'Keep together', x: 211, y: 187, areaId: 'deck', board: 'mainboard' };
  const titleSize = () => ({ width: 120, height: 21 });
  const isLandscape = (name: string) => name === 'Site';
  const area = (cards: CanvasCardInstance[]): CanvasArea => ({ ...required(areas[0]), cards });

  it.each(['Spell', 'Site'])('reserves the title and gap above a six-card %s stack, including its upward fan', name => {
    const cards: CanvasCardInstance[] = Array.from({ length: 6 }, (_, index) => ({
      id: String(index), cardName: name, x: 160, y: 145, board: 'mainboard', labelId: label.id,
    }));
    placeCardsBelowLabel(cards, label, area(cards), [label], isLandscape, titleSize);
    const first = required(cards[0]);
    expect(cards.every(card => card.x === first.x && card.y === first.y)).toBe(true);
    expect(first.y - 5 * STACK_OFFSET / 2).toBeGreaterThanOrEqual(label.y + titleSize().height + LABEL_CARD_GAP);
    const size = name === 'Site' ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const center = { x: first.x + size.width / 2, y: first.y + size.height / 2 };
    expect(snapCardCenter(center.x, center.y, name === 'Site')).toEqual(center);
    const region = required(getLabelRegionBounds([label], label, [area(cards)], isLandscape, titleSize));
    expect(region.y).toBeLessThan(label.y);
    expect(region.y + region.height).toBeGreaterThan(first.y + size.height + 5 * STACK_OFFSET / 2);
  });

  it('keeps a mixed selection and its offsets intact while clearing the heading', () => {
    const cards: CanvasCardInstance[] = [
      { id: 'spell', cardName: 'Spell', x: 10, y: 80, board: 'mainboard' },
      { id: 'site', cardName: 'Site', x: 300, y: 20, board: 'mainboard' },
    ];
    placeCardsBelowLabel(cards, label, area([]), [label], isLandscape, titleSize);
    const spell = required(cards[0]), site = required(cards[1]);
    expect(site.x - spell.x).toBe(290);
    expect(site.y - spell.y).toBe(-60);
    expect(Math.min(spell.y, site.y)).toBeGreaterThanOrEqual(label.y + titleSize().height + LABEL_CARD_GAP);
  });

  it('places a later drop beside existing members without moving or covering them', () => {
    const first: CanvasCardInstance[] = Array.from({ length: 4 }, (_, i) => ({
      id: `old-${i}`, cardName: 'Site', x: 100, y: 100, board: 'mainboard', labelId: label.id,
    }));
    const zone = area(first);
    placeCardsBelowLabel(first, label, zone, [label], isLandscape, titleSize);
    const before = structuredClone(first);
    const next: CanvasCardInstance = { id: 'next', cardName: 'Spell', x: 170, y: 80, board: 'mainboard' };
    // Catalogue additions are already in the area when membership is applied.
    zone.cards.push(next);
    placeCardsBelowLabel([next], label, zone, [label], isLandscape, titleSize);
    expect(zone.cards.slice(0, 4)).toEqual(before);
    expect(next.x).toBeGreaterThanOrEqual(required(before[0]).x + CARD_SIZE.LANDSCAPE.width + LABEL_CARD_GAP);
    expect(next.y).toBeGreaterThanOrEqual(label.y + titleSize().height + LABEL_CARD_GAP);
    const placed = { ...next };
    placeCardsBelowLabel([next], label, zone, [label], isLandscape, titleSize);
    expect(next).toEqual(placed);
  });

  it('keeps a nested label title clear when inserting into its parent', () => {
    const child: CanvasLabel = { ...label, id: 'child-heading', y: 230, parentLabelId: label.id };
    const card: CanvasCardInstance = { id: 'new', cardName: 'Spell', x: 200, y: 170 };
    placeCardsBelowLabel([card], label, area([]), [label, child], isLandscape, titleSize);
    expect(card.x >= child.x + titleSize().width + LABEL_CARD_GAP ||
      card.y >= child.y + titleSize().height + LABEL_CARD_GAP).toBe(true);
  });

  it('uses a nearby clear row instead of extending a label across a busy deck', () => {
    const occupied: CanvasCardInstance[] = Array.from({ length: 10 }, (_, i) => ({
      id: `existing-${i}`, cardName: 'Spell', x: 170 + i * 110, y: 250, board: 'mainboard',
    }));
    const before = structuredClone(occupied);
    const card: CanvasCardInstance = { id: 'incoming', cardName: 'Spell', x: 100, y: 100, board: 'mainboard' };
    placeCardsBelowLabel([card], label, area(occupied), [label], isLandscape, titleSize);
    expect(Math.abs(card.x - label.x)).toBeLessThan(55);
    expect(card.y).toBeGreaterThanOrEqual(250 + CARD_SIZE.PORTRAIT.height + 4);
    expect(occupied).toEqual(before);
  });

  it('fills a normal deck-column vacancy instead of demanding a wider gutter', () => {
    const heading = { ...label, x: 5, y: 0 };
    const occupied: CanvasCardInstance[] = [5, 225].map((x, i) => ({
      id: `existing-${i}`, cardName: 'Spell', x, y: 67.5, board: 'mainboard',
    }));
    const card: CanvasCardInstance = { id: 'incoming', cardName: 'Spell', x: 0, y: 0, board: 'mainboard' };
    placeCardsBelowLabel([card], heading, area(occupied), [heading], isLandscape, titleSize);
    expect(card).toMatchObject({ x: 115, y: 67.5 });
  });
});

describe('shake to detach', () => {
  it('requires three substantial reversals within the gesture window', () => {
    const shake = new ShakeDetector();
    shake.reset({ x: 0, y: 0 }, 0);
    expect(shake.move({ x: 40, y: 0 }, 100)).toBe(false);
    expect(shake.move({ x: 0, y: 0 }, 200)).toBe(false);
    expect(shake.move({ x: 40, y: 0 }, 300)).toBe(false);
    expect(shake.move({ x: 0, y: 0 }, 400)).toBe(true);
  });
  it('ignores pointer noise and slow changes of direction', () => {
    const shake = new ShakeDetector();
    shake.reset({ x: 0, y: 0 }, 0);
    for (let i = 1; i <= 20; i++) expect(shake.move({ x: i % 2 ? 5 : -5, y: 0 }, i * 30)).toBe(false);
    expect(shake.move({ x: 100, y: 0 }, 1500)).toBe(false);
    expect(shake.move({ x: 0, y: 0 }, 2600)).toBe(false);
  });
});
