import { required } from '@/utils/required';
import type { CanvasAreaBounds, DeckRegionBounds, DeckRegionId } from './canvasAreas';
import { DRAWN_GRID } from '@/rendering/Grid';
import { DECK_BOARD_GAP, DECK_BOARD_INNER_PADDING, DECK_BOARD_TOP_GAP, DECK_BOARD_BOTTOM_PADDING, DECK_REGION_TITLE_HEIGHT, unionRegionBounds } from './deckBoardLayout';

export const DECK_REGION_NAMES: Record<DeckRegionId, string> = {
  mainboard: 'Main', collection: 'Collection', maybeboard: 'Maybe', spellbook: 'Spellbook', atlas: 'Atlas',
};
export type RegionEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export interface DeckRegionHit { id: DeckRegionId; edge?: RegionEdge }
export interface RegionDelta { x: number; y: number }
export interface DeckRegionPlan {
  rects: DeckRegionBounds;
  deltas: Partial<Record<DeckRegionId, RegionDelta>>;
  hint: string;
}
const children: DeckRegionId[] = ['spellbook', 'atlas'];
const boards: DeckRegionId[] = ['mainboard', 'collection', 'maybeboard'];
const snap = (n: number) => Math.round(n / DRAWN_GRID.width) * DRAWN_GRID.width;
const clearGap = (n: number) => Math.ceil(n / DRAWN_GRID.width) * DRAWN_GRID.width;
const copyRects = (rects: DeckRegionBounds): DeckRegionBounds => Object.fromEntries(
  Object.entries(rects).map(([key, rect]) => [key, {...rect}]),
);

export function hitDeckRegion(rects: DeckRegionBounds, point: RegionDelta, zoom: number, touch = false): DeckRegionHit | null {
  const tolerance = Math.min(18, (touch ? 12 : 6) / Math.max(0.05, zoom));
  for (const id of [...children, ...boards]) {
    const rect = rects[id];
    if (!rect || point.x < rect.x - tolerance || point.x > rect.x + rect.width + tolerance ||
      point.y < rect.y - tolerance || point.y > rect.y + rect.height + tolerance) continue;
    const n = Math.abs(point.y - rect.y) <= tolerance;
    const s = Math.abs(point.y - rect.y - rect.height) <= tolerance;
    const w = Math.abs(point.x - rect.x) <= tolerance;
    const e = Math.abs(point.x - rect.x - rect.width) <= tolerance;
    const edge = `${n ? 'n' : s ? 's' : ''}${w ? 'w' : e ? 'e' : ''}`;
    if (edge) return {id, edge: edge as RegionEdge};
    if (point.y <= rect.y + DECK_REGION_TITLE_HEIGHT && point.x <= rect.x + Math.min(rect.width, 160)) return {id};
  }
  return null;
}

function intersects(a: CanvasAreaBounds, b: CanvasAreaBounds): boolean {
  return a.x < b.x + b.width + DECK_BOARD_GAP && a.x + a.width + DECK_BOARD_GAP > b.x &&
    a.y < b.y + b.height + DECK_BOARD_GAP && a.y + a.height + DECK_BOARD_GAP > b.y;
}

/** A pure proposal: cards/saves remain untouched until the pointer is released. */
export function planDeckRegionMove(original: DeckRegionBounds, id: DeckRegionId, delta: RegionDelta, allowInsertion = true): DeckRegionPlan {
  const rects = copyRects(original);
  const start = original[id];
  const plan: DeckRegionPlan = {rects, deltas: {}, hint: `Move ${DECK_REGION_NAMES[id]}`};
  if (!start) return plan;
  const moveTo = (key: DeckRegionId, x: number, y: number) => {
    const from = original[key];
    if (!from) return;
    const move = {x: snap(x - from.x), y: snap(y - from.y)};
    plan.deltas[key] = move;
    rects[key] = {...from, x: from.x + move.x, y: from.y + move.y};
    if (key === 'mainboard') for (const child of children) {
      const frame = original[child];
      if (frame) rects[child] = {...frame, x: frame.x + move.x, y: frame.y + move.y};
    }
  };
  moveTo(id, start.x + delta.x, start.y + delta.y);
  const siblings = (children.includes(id) ? children : boards).filter(key => key !== id && original[key]);
  let active = required(rects[id]);
  const grab = {x: start.x + delta.x + Math.min(active.width / 2, 80), y: start.y + delta.y + DECK_REGION_TITLE_HEIGHT / 2};
  const target = allowInsertion && siblings.find(key => {
    const rect = required(original[key]);
    return grab.x >= rect.x && grab.x <= rect.x + rect.width && grab.y >= rect.y && grab.y <= rect.y + rect.height;
  });
  let axis: 'x' | 'y' = 'y';
  if (target) {
    const rect = required(original[target]);
    const fractionX = (grab.x - rect.x) / rect.width;
    const fractionY = (grab.y - rect.y) / rect.height;
    const beside = fractionY > 0.25 && fractionY < 0.75 && (fractionX < 0.2 || fractionX > 0.8);
    axis = beside ? 'x' : 'y';
    const before = beside ? fractionX < 0.5 : grab.y < rect.y + rect.height / 2;
    if (beside) {
      const x = before ? rect.x : start.x + clearGap(rect.x + rect.width + DECK_BOARD_GAP - start.x);
      moveTo(id, x, rect.y);
    } else {
      const y = before ? rect.y : start.y + clearGap(rect.y + rect.height + DECK_BOARD_GAP - start.y);
      moveTo(id, rect.x, y);
    }
    plan.hint = `${DECK_REGION_NAMES[id]} ${beside ? (before ? 'left of' : 'right of') : (before ? 'before' : 'after')} ${DECK_REGION_NAMES[target]}`;
  }
  active = required(rects[id]);
  // Only displaced neighbours flow onward, in their existing order. There is
  // no size-sorting or global optimization of a saved deck arrangement.
  const placed = [active];
  siblings.sort((a, b) => required(original[a])[axis] - required(original[b])[axis]);
  for (const key of siblings) {
    let rect = required(rects[key]);
    for (const occupied of placed) {
      if (!intersects(rect, occupied)) continue;
      if (axis === 'x') moveTo(key, rect.x + clearGap(occupied.x + occupied.width + DECK_BOARD_GAP - rect.x), rect.y);
      else moveTo(key, rect.x, rect.y + clearGap(occupied.y + occupied.height + DECK_BOARD_GAP - rect.y));
      rect = required(rects[key]);
    }
    placed.push(rect);
  }
  if (children.includes(id)) {
    const body = children.flatMap(key => rects[key] ? [required(rects[key])] : []).reduce(unionRegionBounds);
    const parent = {x: body.x - DECK_BOARD_INNER_PADDING, y: body.y - DECK_BOARD_TOP_GAP,
      width: body.width + DECK_BOARD_INNER_PADDING * 2, height: body.height + DECK_BOARD_TOP_GAP + DECK_BOARD_BOTTOM_PADDING};
    rects.mainboard = parent;
    // Growing Main must also preview any Collection/Maybe displacement.
    const placedBoards = [parent];
    for (const key of ['collection', 'maybeboard'] as const) {
      let rect = rects[key];
      if (!rect) continue;
      for (const occupied of placedBoards) if (intersects(rect, occupied)) {
        moveTo(key, rect.x, rect.y + clearGap(occupied.y + occupied.height + DECK_BOARD_GAP - rect.y));
        rect = required(rects[key]);
      }
      placedBoards.push(rect);
    }
  }
  return plan;
}

/** Border-only resize: never cross the padded content or nested region minimum. */
export function resizeDeckRegion(start: CanvasAreaBounds, minimum: CanvasAreaBounds, edge: RegionEdge, delta: RegionDelta): CanvasAreaBounds {
  let left = start.x, top = start.y, right = start.x + start.width, bottom = start.y + start.height;
  if (edge.includes('w')) left = Math.min(start.x + snap(delta.x), minimum.x);
  if (edge.includes('e')) right = Math.max(right + snap(delta.x), minimum.x + minimum.width);
  if (edge.includes('n')) top = Math.min(start.y + snap(delta.y), minimum.y);
  if (edge.includes('s')) bottom = Math.max(bottom + snap(delta.y), minimum.y + minimum.height);
  return {x: left, y: top, width: right - left, height: bottom - top};
}
