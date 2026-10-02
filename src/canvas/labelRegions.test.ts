import { describe, expect, it } from 'vitest';
import { getLabelCards, getLabelFamily, getLabelRegionBounds, ShakeDetector } from './labelRegions';
import type { CanvasLabel } from '@/data/dataModels';
import type { CanvasArea } from './canvasAreas';

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
