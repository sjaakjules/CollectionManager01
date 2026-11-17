import type { CanvasLabel } from '@/data/dataModels';
import type { CanvasArea, CanvasAreaBounds, CanvasCardInstance } from './canvasAreas';
import { CARD_SIZE, DRAWN_GRID, SNAP_GRID, getCardCellSpacing, getStackFan, pixelsToSnapGrid, snapCardCenter } from '@/rendering/Grid';
import { required } from '@/utils/required';
import { normalizeDeckBoard } from './deckBoardLayout';

export const LABEL_CARD_GAP = 12;
export const LABEL_HEADING_INSET_X = 10;
export const LABEL_HEADING_INSET_Y = 8;
export const LABEL_HEADING_RESERVED_BOTTOM = 26;
const GRID_ROUNDING_EPSILON = 1e-8;
type HeadingSize = Pick<CanvasAreaBounds, 'width' | 'height'>;
type TitleSize = (id: string) => HeadingSize;
type IsLandscape = (name: string) => boolean;
type SlotExtent = { left: number; right: number; top: number };

function stackFootprintTop(card: CanvasCardInstance, landscape: boolean): number {
  const cardHeight = (landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT).height;
  return card.y + (cardHeight - getCardCellSpacing(landscape).y * SNAP_GRID.height) / 2;
}

function stackGridExtent(card: CanvasCardInstance, landscape: boolean): SlotExtent {
  const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
  const slotWidth = getCardCellSpacing(landscape).x * SNAP_GRID.width;
  const left = card.x + (size.width - slotWidth) / 2;
  const top = stackFootprintTop(card, landscape);
  // Legacy layouts can sit between grid lines. Reserve the entire slot.
  return {
    left: Math.floor(left / DRAWN_GRID.width + GRID_ROUNDING_EPSILON) * DRAWN_GRID.width,
    right: Math.ceil((left + slotWidth) / DRAWN_GRID.width - GRID_ROUNDING_EPSILON) * DRAWN_GRID.width,
    top: Math.floor(top / DRAWN_GRID.height + GRID_ROUNDING_EPSILON) * DRAWN_GRID.height,
  };
}

function unionSlotExtents(a: SlotExtent | undefined, b: SlotExtent): SlotExtent {
  if (!a) return b;
  return { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top) };
}

/** Include the fan above and below a stack, for either card orientation. */
export function cardBounds(cards: CanvasCardInstance[], isLandscape: IsLandscape): Map<string, CanvasAreaBounds> {
  const stacks = new Map<string, { cards: CanvasCardInstance[]; landscape: boolean }>();
  for (const card of cards) {
    const landscape = isLandscape(card.cardName);
    const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const grid = pixelsToSnapGrid(card.x + size.width / 2, card.y + size.height / 2, landscape);
    const key = `${normalizeDeckBoard(card.board)}:${landscape}:${grid.x},${grid.y}`;
    const stack = stacks.get(key) ?? { cards: [], landscape };
    stack.cards.push(card);
    stacks.set(key, stack);
  }
  const bounds = new Map<string, CanvasAreaBounds>();
  for (const { cards: stack, landscape } of stacks.values()) {
    const { overhang } = getStackFan(stack.length, landscape);
    const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    for (const card of stack) {
      bounds.set(card.id, { x: card.x, y: card.y - overhang, width: size.width, height: size.height + overhang * 2 });
    }
  }
  return bounds;
}

function layoutLabelBands(labels: CanvasLabel[], areas: CanvasArea[], isLandscape: IsLandscape) {
  const bands = new Map<string, CanvasAreaBounds>();
  const slots = new Map<string, SlotExtent>();
  if (!labels.length) return { bands, slots };
  const children = new Map<string, CanvasLabel[]>();
  const labelsById = new Map(labels.map((label) => [label.id, label]));
  for (const label of labels) {
    const parent = label.parentLabelId ? labelsById.get(label.parentLabelId) : undefined;
    if (!parent || parent.areaId !== label.areaId) continue;
    const siblings = children.get(parent.id) ?? [];
    siblings.push(label);
    children.set(parent.id, siblings);
  }
  for (const area of areas) for (const card of area.cards) {
    if (!card.labelId || labelsById.get(card.labelId)?.areaId !== area.id) continue;
    const extent = stackGridExtent(card, isLandscape(card.cardName));
    slots.set(card.labelId, unionSlotExtents(slots.get(card.labelId), extent));
  }

  const visiting = new Set<string>();
  const placed = new Set<string>();
  function place(label: CanvasLabel): SlotExtent | undefined {
    if (visiting.has(label.id)) return undefined;
    if (placed.has(label.id)) return slots.get(label.id);
    visiting.add(label.id);
    let extent = slots.get(label.id);
    let childBandTop = Infinity;
    for (const child of children.get(label.id) ?? []) {
      const childExtent = place(child);
      if (!childExtent) continue;
      extent = unionSlotExtents(extent, childExtent);
      childBandTop = Math.min(childBandTop, required(bands.get(child.id)).y);
    }
    if (extent) {
      slots.set(label.id, extent);
      bands.set(label.id, {
        x: extent.left,
        y: Math.min(extent.top, childBandTop) - DRAWN_GRID.height,
        width: extent.right - extent.left,
        height: DRAWN_GRID.height,
      });
    }
    visiting.delete(label.id);
    placed.add(label.id);
    return extent;
  }
  for (const label of labels) place(label);
  return { bands, slots };
}

/** Reserve one grid row per populated heading above its cards and nested headings. */
export function getLabelHeadingBands(labels: CanvasLabel[], areas: CanvasArea[], isLandscape: IsLandscape): Map<string, CanvasAreaBounds> {
  return layoutLabelBands(labels, areas, isLandscape).bands;
}

export function clampLabelHeadingPosition(band: CanvasAreaBounds, point: { x: number; y: number }, size: HeadingSize): CanvasAreaBounds {
  const left = band.x + LABEL_HEADING_INSET_X;
  const top = band.y + LABEL_HEADING_INSET_Y;
  const availableWidth = band.width - LABEL_HEADING_INSET_X * 2;
  const availableHeight = band.height - LABEL_HEADING_INSET_Y - LABEL_HEADING_RESERVED_BOTTOM;
  const width = Math.min(size.width, availableWidth);
  const height = Math.min(size.height, availableHeight);
  return {
    x: Math.max(left, Math.min(point.x, left + availableWidth - width)),
    y: Math.max(top, Math.min(point.y, top + availableHeight - height)),
    width,
    height,
  };
}

export function getLabelHeadingLayout(labels: CanvasLabel[], areas: CanvasArea[], isLandscape: IsLandscape,
  titleSize: TitleSize, bands: ReadonlyMap<string, CanvasAreaBounds> = getLabelHeadingBands(labels, areas, isLandscape)) {
  const headings = new Map<string, CanvasAreaBounds>();
  for (const label of labels) {
    const size = titleSize(label.id);
    const band = bands.get(label.id);
    if (!band) {
      headings.set(label.id, { x: label.x, y: label.y, ...size });
      continue;
    }
    headings.set(label.id, clampLabelHeadingPosition(band, band, size));
  }
  return { headings, bands };
}

export function getLabelHeadingBounds(labels: CanvasLabel[], areas: CanvasArea[], isLandscape: IsLandscape,
  titleSize: TitleSize): Map<string, CanvasAreaBounds> {
  return getLabelHeadingLayout(labels, areas, isLandscape, titleSize).headings;
}

/** A title drop inserts below the heading, leaving existing cards in place.
 * Translate the incoming selection once so its stacks and mixed-card offsets survive.
 */
export function placeCardsBelowLabel(
  cards: CanvasCardInstance[], label: CanvasLabel, area: CanvasArea, labels: CanvasLabel[],
  isLandscape: IsLandscape, titleSize: TitleSize,
): void {
  const anchor = cards[0];
  if (!anchor) return;
  const incoming = [...cardBounds(cards, isLandscape).values()];
  const left = Math.min(...incoming.map(rect => rect.x));
  const top = Math.min(...incoming.map(rect => rect.y));
  const width = Math.max(...incoming.map(rect => rect.x + rect.width)) - left;
  const height = Math.max(...incoming.map(rect => rect.y + rect.height)) - top;
  const movingIds = new Set(cards.map(card => card.id));
  const existing = area.cards.filter(card => !movingIds.has(card.id));
  const areaLabels = [label, ...labels.filter(entry => entry.id !== label.id && entry.areaId === area.id)];
  const existingAreas = [{ ...area, cards: existing }];
  const { bands, slots } = layoutLabelBands(areaLabels, existingAreas, isLandscape);
  const { headings } = getLabelHeadingLayout(areaLabels, existingAreas, isLandscape, titleSize, bands);
  const heading = required(headings.get(label.id));
  const contentTop = slots.get(label.id)?.top ?? heading.y + heading.height + LABEL_CARD_GAP;
  const contentGridTop = Math.ceil(contentTop / DRAWN_GRID.height - GRID_ROUNDING_EPSILON) * DRAWN_GRID.height;
  const footprintTop = Math.min(...cards.map(card => stackFootprintTop(card, isLandscape(card.cardName))));
  const clearanceTop = Math.min(top, footprintTop);
  const landscape = isLandscape(anchor.cardName);
  const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
  const snapped = snapCardCenter(anchor.x + heading.x - left + size.width / 2,
    anchor.y + contentGridTop - clearanceTop + size.height / 2, landscape);
  const dx = snapped.x - size.width / 2 - anchor.x;
  const nearestDy = snapped.y - size.height / 2 - anchor.y;
  // Nearest-grid snapping may round into the title. Always round clearance outwards.
  const gridDeficit = (contentGridTop - clearanceTop - nearestDy) / SNAP_GRID.height;
  const dy = nearestDy + Math.max(0, Math.ceil(gridDeficit - GRID_ROUNDING_EPSILON)) * SNAP_GRID.height;

  const existingBounds = [...cardBounds(existing, isLandscape).values()];
  // Match deck insertion's four-pixel clearance so normal slots remain usable.
  const obstacles = [...existingBounds.map(rect => ({ ...rect, gap: 4 })),
    ...[...headings].filter(([id]) => id !== label.id).map(([id, rect]) => ({
      ...(bands.get(id) ?? rect), gap: bands.has(id) ? 0 : LABEL_CARD_GAP,
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
  const ownerId = labels.find(label => label.id === id)?.areaId;
  let changed = true;
  while (changed) {
    changed = false;
    for (const label of labels) {
      if (label.areaId === ownerId && label.parentLabelId && family.has(label.parentLabelId) && !family.has(label.id)) {
        family.add(label.id);
        changed = true;
      }
    }
  }
  return family;
}

export function getLabelCards(labels: CanvasLabel[], id: string, areas: CanvasArea[]): CanvasCardInstance[] {
  const ownerId = labels.find(label => label.id === id)?.areaId;
  const family = getLabelFamily(labels, id);
  return areas.find(area => area.id === ownerId)?.cards.filter(card => card.labelId && family.has(card.labelId)) ?? [];
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
  isLandscape: IsLandscape,
  _titleSize: TitleSize,
  _headings?: ReadonlyMap<string, CanvasAreaBounds>,
  rendered?: ReadonlyMap<string, CanvasAreaBounds>,
  bands?: ReadonlyMap<string, CanvasAreaBounds>,
): CanvasAreaBounds | null {
  const area = areas.find(entry => entry.id === label.areaId);
  if (!area) return null;
  const band = (bands ?? getLabelHeadingBands(labels, [area], isLandscape)).get(label.id);
  if (!band) return null;
  const family = getLabelFamily(labels, label.id);
  const cards = area.cards.filter(card => card.labelId && family.has(card.labelId));
  const renderedCards = rendered ?? cardBounds(area.cards, isLandscape);
  const rects = cards.flatMap(card => renderedCards.get(card.id) ?? []);
  const bottom = Math.max(band.y + band.height, ...rects.map(rect => rect.y + rect.height + 14));
  return { ...band, height: bottom - band.y };
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
