import type { CanvasLabel } from '@/data/dataModels';
import type { CanvasArea, CanvasAreaBounds, CanvasCardInstance } from './canvasAreas';
import { CARD_SIZE, SNAP_GRID, STACK_OFFSET, pixelsToSnapGrid, snapCardCenter } from '@/rendering/Grid';
import { normalizeDeckBoard } from './deckBoardLayout';

export const LABEL_CARD_GAP = 12;
type TitleSize = (id: string) => { width: number; height: number };

/** Include the fan above and below a stack, for either card orientation. */
function cardBounds(cards: CanvasCardInstance[], isLandscape: (name: string) => boolean): Map<string, CanvasAreaBounds> {
  const stacks = new Map<string, CanvasCardInstance[]>();
  for (const card of cards) {
    const landscape = isLandscape(card.cardName);
    const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const grid = pixelsToSnapGrid(card.x + size.width / 2, card.y + size.height / 2, landscape);
    const key = `${normalizeDeckBoard(card.board)}:${landscape}:${grid.x},${grid.y}`;
    const stack = stacks.get(key) ?? [];
    stack.push(card);
    stacks.set(key, stack);
  }
  const bounds = new Map<string, CanvasAreaBounds>();
  for (const stack of stacks.values()) for (const card of stack) {
    const size = isLandscape(card.cardName) ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const overhang = (stack.length - 1) * STACK_OFFSET / 2;
    bounds.set(card.id, { x: card.x, y: card.y - overhang, width: size.width, height: size.height + overhang * 2 });
  }
  return bounds;
}

/** A title drop inserts below the heading, leaving existing cards in place.
 * Translate the incoming selection once so its stacks and mixed-card offsets survive.
 */
export function placeCardsBelowLabel(
  cards: CanvasCardInstance[], label: CanvasLabel, area: CanvasArea, labels: CanvasLabel[],
  isLandscape: (name: string) => boolean, titleSize: TitleSize,
): void {
  const anchor = cards[0];
  if (!anchor) return;
  const incoming = [...cardBounds(cards, isLandscape).values()];
  const left = Math.min(...incoming.map(rect => rect.x));
  const top = Math.min(...incoming.map(rect => rect.y));
  const width = Math.max(...incoming.map(rect => rect.x + rect.width)) - left;
  const height = Math.max(...incoming.map(rect => rect.y + rect.height)) - top;
  const contentTop = label.y + titleSize(label.id).height + LABEL_CARD_GAP;
  const landscape = isLandscape(anchor.cardName);
  const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
  const snapped = snapCardCenter(anchor.x + label.x - left + size.width / 2,
    anchor.y + contentTop - top + size.height / 2, landscape);
  const dx = snapped.x - size.width / 2 - anchor.x;
  let dy = snapped.y - size.height / 2 - anchor.y;
  // Nearest-grid snapping may round into the title. Always round clearance outwards.
  if (top + dy < contentTop) dy += Math.ceil((contentTop - top - dy) / SNAP_GRID.height) * SNAP_GRID.height;

  const movingIds = new Set(cards.map(card => card.id));
  const existingBounds = [...cardBounds(area.cards.filter(card => !movingIds.has(card.id)), isLandscape).values()];
  // Normal deck columns have a ten-pixel gutter. Match deck insertion's
  // four-pixel clearance so those deliberately spaced slots remain usable.
  const obstacles = [...existingBounds.map(rect => ({ ...rect, gap: 4 })),
    ...labels.filter(entry => entry.id !== label.id && entry.areaId === area.id).map(entry => ({
      x: entry.x, y: entry.y, ...titleSize(entry.id), gap: LABEL_CARD_GAP,
    }))];
  // A free slot starts either at the heading or just beyond an obstacle. Search
  // those grid-aligned edges in both directions, so a busy row cannot force a
  // group all the way to the far side of the deck when a nearer row is clear.
  const xs = [...new Set([0, ...obstacles.map(rect => Math.max(0,
    Math.ceil((rect.x + rect.width + rect.gap - left - dx) / SNAP_GRID.width) * SNAP_GRID.width))])].sort((a, b) => a - b);
  const ys = [...new Set([0, ...obstacles.map(rect => Math.max(0,
    Math.ceil((rect.y + rect.height + rect.gap - top - dy) / SNAP_GRID.height) * SNAP_GRID.height))])].sort((a, b) => a - b);
  let best = { x: 0, y: 0, distance: Infinity };
  for (const y of ys) {
    if (y * y >= best.distance) break;
    for (const x of xs) {
      const distance = x * x + y * y;
      if (distance >= best.distance) break;
      if (obstacles.some(rect => left + dx + x < rect.x + rect.width + rect.gap &&
        left + dx + x + width + rect.gap > rect.x && top + dy + y < rect.y + rect.height + rect.gap &&
        top + dy + y + height + rect.gap > rect.y)) continue;
      best = { x, y, distance };
    }
  }
  for (const card of cards) { card.x += dx + best.x; card.y += dy + best.y; }
}

/** Membership is explicit: crossing a drawn outline never silently captures cards. */
export function getLabelFamily(labels: CanvasLabel[], id: string): Set<string> {
  const family = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const label of labels) {
      if (label.parentLabelId && family.has(label.parentLabelId) && !family.has(label.id)) {
        family.add(label.id);
        changed = true;
      }
    }
  }
  return family;
}

export function getLabelCards(labels: CanvasLabel[], id: string, areas: CanvasArea[]): CanvasCardInstance[] {
  const family = getLabelFamily(labels, id);
  return areas.flatMap(area => area.cards.filter(card => card.labelId && family.has(card.labelId)));
}

/** Keep populated titles with their cards when an explicit sort resets positions. */
export function repositionLabelsAfterCardLayout(
  labels: CanvasLabel[], areaId: string, before: CanvasCardInstance[], after: CanvasCardInstance[],
): CanvasLabel[] {
  const nextById = new Map(after.map(card => [card.id, card]));
  let changed = false;
  const next = labels.map(label => {
    if (label.areaId !== areaId) return label;
    const family = getLabelFamily(labels, label.id);
    const members = before.filter(card => card.labelId && family.has(card.labelId) && nextById.has(card.id));
    if (!members.length) return label;
    const nextMembers = members.flatMap(card => {
      const nextCard = nextById.get(card.id);
      return nextCard ? [nextCard] : [];
    });
    const dx = Math.min(...nextMembers.map(card => card.x)) - Math.min(...members.map(card => card.x));
    const dy = Math.min(...nextMembers.map(card => card.y)) - Math.min(...members.map(card => card.y));
    if (!dx && !dy) return label;
    changed = true;
    return { ...label, x: label.x + dx, y: label.y + dy };
  });
  return changed ? next : labels;
}

export function getLabelRegionBounds(
  labels: CanvasLabel[], label: CanvasLabel, areas: CanvasArea[],
  isLandscape: (name: string) => boolean,
  titleSize: TitleSize,
): CanvasAreaBounds | null {
  const cards = getLabelCards(labels, label.id, areas);
  if (!cards.length) return null;
  const family = getLabelFamily(labels, label.id);
  const titles = labels.filter(entry => family.has(entry.id));
  const memberIds = new Set(cards.map(card => card.id));
  const rendered = areas.flatMap(area => [...cardBounds(area.cards, isLandscape)]
    .flatMap(([id, bounds]) => memberIds.has(id) ? [bounds] : []));
  const left = Math.min(...rendered.map(rect => rect.x), ...titles.map(entry => entry.x));
  const top = Math.min(...rendered.map(rect => rect.y), ...titles.map(entry => entry.y));
  const right = Math.max(...rendered.map(rect => rect.x + rect.width), ...titles.map(entry => entry.x + titleSize(entry.id).width));
  const bottom = Math.max(...rendered.map(rect => rect.y + rect.height), ...titles.map(entry => entry.y + titleSize(entry.id).height));
  return { x: left - 14, y: top - 14, width: right - left + 28, height: bottom - top + 28 };
}

/** Three deliberate direction changes detach; tiny pointer noise does not. */
export class ShakeDetector {
  private point = { x: 0, y: 0 };
  private direction = { x: 0, y: 0 };
  private reversals = 0;
  private startTime = 0;
  reset(point: { x: number; y: number }, now: number): void {
    this.point = { ...point };
    this.direction = { x: 0, y: 0 };
    this.reversals = 0;
    this.startTime = now;
  }
  move(point: { x: number; y: number }, now: number): boolean {
    if (now - this.startTime > 900) this.reset(this.point, now);
    const dx = point.x - this.point.x;
    const dy = point.y - this.point.y;
    if (Math.hypot(dx, dy) < 16) return false;
    if (dx * this.direction.x + dy * this.direction.y < -0.5 * Math.hypot(dx, dy) * Math.hypot(this.direction.x, this.direction.y)) this.reversals++;
    this.point = { ...point };
    this.direction = { x: dx, y: dy };
    return this.reversals >= 3;
  }
}
