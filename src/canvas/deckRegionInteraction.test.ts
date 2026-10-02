import { required } from '@/utils/required';
import { describe, expect, it } from 'vitest';
import type { DeckRegionBounds } from './canvasAreas';
import { hitDeckRegion, planDeckRegionMove, resizeDeckRegion, type RegionEdge } from './deckRegionInteraction';

const regions: DeckRegionBounds = {
  spellbook: {x: 40, y: 100, width: 500, height: 180},
  atlas: {x: 40, y: 350, width: 500, height: 170},
  mainboard: {x: 22, y: 45, width: 536, height: 493},
  collection: {x: 22, y: 600, width: 800, height: 300},
  maybeboard: {x: 22, y: 950, width: 300, height: 210},
};

describe('deck region proposals', () => {
  it('previews Atlas before Spellbook and displaces neighbours without mutating the saved layout', () => {
    const before = structuredClone(regions);
    const plan = planDeckRegionMove(regions, 'atlas', {x: 0, y: -250});
    expect(plan.hint).toBe('Atlas before Spellbook');
    expect(required(plan.rects.atlas).y + required(plan.rects.atlas).height + 22).toBeLessThanOrEqual(required(plan.rects.spellbook).y);
    expect(required(plan.rects.mainboard).y).toBeLessThan(required(plan.rects.atlas).y - 32);
    expect(Object.values(plan.deltas).every(move => move.x % 55 === 0 && move.y % 55 === 0)).toBe(true);
    expect(regions).toEqual(before);
  });

  it('can place Collection beside Main without moving unrelated regions', () => {
    const plan = planDeckRegionMove(regions, 'collection', {x: 605, y: -550});
    expect(required(plan.rects.collection).x).toBeGreaterThan(required(regions.mainboard).x + required(regions.mainboard).width + 22);
    expect(plan.deltas.mainboard).toBeUndefined();
    expect(plan.deltas.maybeboard).toBeUndefined();
  });

  it('translates Main with both children and preserves their relative positions', () => {
    const plan = planDeckRegionMove(regions, 'mainboard', {x: -550, y: -330});
    expect(required(plan.rects.spellbook).x - required(plan.rects.mainboard).x).toBe(required(regions.spellbook).x - required(regions.mainboard).x);
    expect(required(plan.rects.atlas).y - required(plan.rects.spellbook).y).toBe(required(regions.atlas).y - required(regions.spellbook).y);
  });

  it.each(['n','s','e','w','ne','nw','se','sw'] as RegionEdge[])('clamps %s resizing around the padded content', edge => {
    const start = {x: 0, y: 0, width: 550, height: 550};
    const minimum = {x: 55, y: 55, width: 330, height: 330};
    const resized = resizeDeckRegion(start, minimum, edge, {x: edge.includes('w') ? 1000 : -1000, y: edge.includes('n') ? 1000 : -1000});
    expect(resized.x).toBeLessThanOrEqual(minimum.x);
    expect(resized.y).toBeLessThanOrEqual(minimum.y);
    expect(resized.x + resized.width).toBeGreaterThanOrEqual(minimum.x + minimum.width);
    expect(resized.y + resized.height).toBeGreaterThanOrEqual(minimum.y + minimum.height);
  });

  it('finds region titles and corners while leaving the card interior alone', () => {
    expect(hitDeckRegion(regions, {x: 90, y: 118}, 1)).toEqual({id: 'spellbook'});
    expect(hitDeckRegion(regions, {x: 540, y: 280}, 1)).toEqual({id: 'spellbook', edge: 'se'});
    expect(hitDeckRegion(regions, {x: 200, y: 210}, 1, true)).toBeNull();
  });
});
