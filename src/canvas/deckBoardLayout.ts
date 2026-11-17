import { required } from '@/utils/required';
import type { ActiveBoard } from '@/data/dataModels';
import type { CanvasArea, CanvasAreaBounds, CanvasCardInstance, DeckRegionBounds } from './canvasAreas';
import { CARD_CELL_SPACING, CARD_SIZE, DRAWN_GRID, getStackFan, pixelsToSnapGrid, snapCardCenter } from '@/rendering/Grid';

export const DECK_BOARD_ORDER = ['mainboard', 'collection', 'maybeboard'] as const;
export type DeckZoneBoard = typeof DECK_BOARD_ORDER[number];
export const DECK_BOARD_PADDING = 22;
export const DECK_BOARD_INNER_PADDING = 18;
export const DECK_BOARD_TOP_GAP = DRAWN_GRID.height;
export const DECK_BOARD_GAP = 22;
export const DECK_BOARD_BOTTOM_PADDING = 18;
export const DECK_REGION_TITLE_HEIGHT = 32;
// Title and four-line statistic columns share one row; tabs sit above its edge.
export const DECK_SECTION_HEADER_HEIGHT = DRAWN_GRID.height;
export const DECK_SECTION_MIN_WIDTH = 360;
const DECK_SECTION_COMPACT_WIDTH = 210;
const EMPTY_SECTION_HEIGHT = 76;
const LEGACY_EMPTY_SECTION_HEIGHT = 52;
const MAIN_DECK_SECTIONS = ['spellbook', 'atlas'] as const;
const MAIN_DECK_SECTION_PAIRS = [['spellbook', 'atlas'], ['atlas', 'spellbook']] as const;
type MainDeckSection = typeof MAIN_DECK_SECTIONS[number];
type MainDeckSectionBounds = Partial<Record<MainDeckSection, CanvasAreaBounds>>;
export type MainDeckLabelBounds = Partial<Record<MainDeckSection | 'shared', CanvasAreaBounds[]>>;

export function normalizeDeckRegionBounds(value: unknown): DeckRegionBounds | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: DeckRegionBounds = {};
  for (const key of ['mainboard', 'collection', 'maybeboard', 'spellbook', 'atlas'] as const) {
    const rect = (value as Record<string, unknown>)[key];
    if (!rect || typeof rect !== 'object') continue;
    const record = rect as Record<string, unknown>;
    const numbers = ['x', 'y', 'width', 'height'].map(field => record[field]);
    if (!numbers.every(n => typeof n === 'number' && Number.isFinite(n))) continue;
    const [x, y, width, height] = numbers as number[];
    if (required(width) <= 0 || required(height) <= 0) continue;
    result[key] = {x: required(x), y: required(y), width: required(width), height: required(height)};
  }
  return result;
}

export function unionRegionBounds(a: CanvasAreaBounds, b: CanvasAreaBounds): CanvasAreaBounds {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return {x, y, width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y};
}
export const DECK_COLLECTION_COLUMNS = 10;
// Default/reset Collection layout has ten portrait columns. Manual layouts can
// extend beyond this without wrapping or moving existing cards.
export const DECK_COLLECTION_WIDTH = CARD_SIZE.PORTRAIT.width +
  (DECK_COLLECTION_COLUMNS - 1) * CARD_CELL_SPACING.PORTRAIT.x * DRAWN_GRID.width +
  DECK_BOARD_INNER_PADDING * 2 + DRAWN_GRID.width;
export const DECK_MIN_WIDTH = DECK_COLLECTION_WIDTH + DECK_BOARD_PADDING * 2;
// Runtime regions need a useful title/drop target, not ten blank columns after
// their leftmost card. The ten-column rule belongs to import/reset placement.
export const DECK_COMPACT_BOARD_WIDTH = CARD_SIZE.PORTRAIT.width +
  CARD_CELL_SPACING.PORTRAIT.x * DRAWN_GRID.width + DECK_BOARD_INNER_PADDING * 2;
const LEGACY_MAIN_BOARD_MIN_HEIGHT = CARD_SIZE.PORTRAIT.height + DECK_BOARD_TOP_GAP + 6;
export const DECK_BOARD_MIN_HEIGHT: Record<DeckZoneBoard, number> = {
  mainboard: Math.max(LEGACY_MAIN_BOARD_MIN_HEIGHT,
    EMPTY_SECTION_HEIGHT * 2 + 8 + DECK_BOARD_TOP_GAP + DECK_BOARD_BOTTOM_PADDING),
  collection: CARD_SIZE.PORTRAIT.height + DECK_BOARD_TOP_GAP - 6,
  maybeboard: CARD_SIZE.PORTRAIT.height + DECK_BOARD_TOP_GAP - 6,
};

/** Accept legacy saved canvas instances at the shared schema boundary. */
export function normalizeDeckBoard(board: ActiveBoard | 'sideboard' | null | undefined): DeckZoneBoard {
  if (board === 'sideboard') return 'collection';
  return board === 'collection' || board === 'maybeboard' ? board : 'mainboard';
}

export function getDeckBoardWidth(board: DeckZoneBoard, zoneWidth: number): number {
  return board === 'collection' ? DECK_COLLECTION_WIDTH : zoneWidth - DECK_BOARD_PADDING * 2;
}

function deckCardStackBounds(cards: CanvasCardInstance[], isLandscape: (name: string) => boolean) {
  const stacks = new Map<string, { board: DeckZoneBoard; landscape: boolean; cards: CanvasCardInstance[] }>();
  for (const card of cards) {
    const board = normalizeDeckBoard(card.board);
    const landscape = isLandscape(card.cardName);
    const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const grid = pixelsToSnapGrid(card.x + size.width / 2, card.y + size.height / 2, landscape);
    const key = `${board}:${landscape}:${grid.x},${grid.y}`;
    const stack = stacks.get(key) ?? { board, landscape, cards: [] };
    stack.cards.push(card);
    stacks.set(key, stack);
  }
  return [...stacks.values()].map(({ board, landscape, cards: stack }) => {
    const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const { overhang } = getStackFan(stack.length, landscape);
    const bounds = stack.map((card): CanvasAreaBounds => ({ x: card.x, y: card.y - overhang, width: size.width, height: size.height + 2 * overhang }))
      .reduce(unionRegionBounds);
    return { board, landscape, bounds };
  });
}

function cardExtents(cards: CanvasCardInstance[], isLandscape: (name: string) => boolean) {
  const extents = new Map<DeckZoneBoard, { left: number; top: number; right: number; bottom: number }>();
  for (const { board, bounds } of deckCardStackBounds(cards, isLandscape)) {
    const previous = extents.get(board);
    extents.set(board, {
      left: Math.min(previous?.left ?? Infinity, bounds.x),
      top: Math.min(previous?.top ?? Infinity, bounds.y),
      right: Math.max(previous?.right ?? -Infinity, bounds.x + bounds.width),
      bottom: Math.max(previous?.bottom ?? -Infinity, bounds.y + bounds.height),
    });
  }
  return extents;
}

/** Content-bearing boards follow their cards; empty boards retain ordered drop targets. */
export function getDeckBoardRects(
  bounds: CanvasAreaBounds,
  cards: CanvasCardInstance[],
  headerHeight: number,
  isLandscape: (name: string) => boolean,
  saved: DeckRegionBounds = {},
  labels: MainDeckLabelBounds = {},
): Record<DeckZoneBoard, CanvasAreaBounds> {
  return layoutDeckBoards(bounds, cards, headerHeight, isLandscape, saved, labels);
}

function layoutDeckBoards(
  bounds: CanvasAreaBounds,
  cards: CanvasCardInstance[],
  headerHeight: number,
  isLandscape: (name: string) => boolean,
  saved: DeckRegionBounds = {},
  labels: MainDeckLabelBounds = {},
  legacySectionHeaders = false,
): Record<DeckZoneBoard, CanvasAreaBounds> {
  const extents = cardExtents(cards, isLandscape);
  // Main encloses its physical children, including their own title bands.
  const mainOrigin = saved.mainboard ?? { x: bounds.x + DECK_BOARD_PADDING, y: bounds.y + headerHeight + DECK_BOARD_PADDING };
  const children = Object.values(layoutMainDeckSections(cards, isLandscape, saved, labels, mainOrigin, legacySectionHeaders).rects);
  if (children.length) extents.set('mainboard', {
    left: Math.min(...children.map(rect => rect.x)),
    top: Math.min(...children.map(rect => rect.y)),
    right: Math.max(...children.map(rect => rect.x + rect.width)),
    bottom: Math.max(...children.map(rect => rect.y + rect.height)),
  });
  let top = bounds.y + headerHeight + DECK_BOARD_PADDING;
  const rect = (board: DeckZoneBoard): CanvasAreaBounds => {
    const content = extents.get(board);
    const x = content ? content.left - DECK_BOARD_INNER_PADDING : bounds.x + DECK_BOARD_PADDING;
    const y = content ? content.top - DECK_BOARD_TOP_GAP : top;
    const minWidth = !content && board === 'collection'
      ? DECK_COLLECTION_WIDTH : DECK_COMPACT_BOARD_WIDTH;
    const width = Math.max(minWidth,
      content ? content.right + DECK_BOARD_INNER_PADDING - x : 0);
    const minHeight = legacySectionHeaders && board === 'mainboard' ? LEGACY_MAIN_BOARD_MIN_HEIGHT : DECK_BOARD_MIN_HEIGHT[board];
    const height = Math.max(minHeight,
      content ? content.bottom + DECK_BOARD_BOTTOM_PADDING - y : 0);
    const requested = saved[board];
    const result = requested
      ? content ? unionRegionBounds({x, y, width, height}, requested)
        : {...requested, width: Math.max(DECK_COMPACT_BOARD_WIDTH, requested.width), height: Math.max(minHeight, requested.height)}
      : { x, y, width, height };
    top = Math.max(top, result.y + result.height) + DECK_BOARD_GAP;
    return result;
  };
  return { mainboard: rect('mainboard'), collection: rect('collection'), maybeboard: rect('maybeboard') };
}

/** Derive a frame from current contents, including empty boards, without moving cards. */
export function getDeckAreaBounds(
  zone: Pick<CanvasArea, 'bounds' | 'cards' | 'deckRegionBounds'>,
  headerHeight: number,
  isLandscape: (name: string) => boolean,
  preserveTopLeft = false,
): CanvasAreaBounds {
  const initial = getDeckBoardRects(zone.bounds, zone.cards, headerHeight, isLandscape, zone.deckRegionBounds);
  const anchored = DECK_BOARD_ORDER.filter(board => zone.deckRegionBounds?.[board] || zone.cards.some(card => normalizeDeckBoard(card.board) === board));
  let x = zone.bounds.x;
  let y = zone.bounds.y;
  if (anchored.length > 0 && !preserveTopLeft) {
    x = Math.min(...anchored.map(board => initial[board].x)) - DECK_BOARD_PADDING;
    let precedingEmptyHeight = 0;
    const candidateTops: number[] = [];
    let sawContent = false;
    for (const board of DECK_BOARD_ORDER) {
      if (anchored.includes(board)) {
        candidateTops.push(initial[board].y - (sawContent ? 0 : precedingEmptyHeight));
        sawContent = true;
      } else if (!sawContent) {
        precedingEmptyHeight += DECK_BOARD_MIN_HEIGHT[board] + DECK_BOARD_GAP;
      }
    }
    y = Math.min(...candidateTops) - headerHeight - DECK_BOARD_PADDING;
  }
  const rects = getDeckBoardRects({ ...zone.bounds, x, y }, zone.cards, headerHeight, isLandscape, zone.deckRegionBounds);
  const right = Math.max(...DECK_BOARD_ORDER.map((board) => rects[board].x + rects[board].width));
  const bottom = Math.max(...DECK_BOARD_ORDER.map((board) => rects[board].y + rects[board].height));
  const minWidth = Object.keys(zone.deckRegionBounds ?? {}).length ? 550 : DECK_MIN_WIDTH;
  return { x, y, width: Math.max(minWidth, right + DECK_BOARD_PADDING - x), height: bottom + DECK_BOARD_PADDING - y };
}

/** Fit frames and open missing gaps without changing memberships or internal group offsets. */
export function fitDeckBoardSections(zone: CanvasArea, headerHeight: number, isLandscape: (name: string) => boolean): boolean {
  if (zone.type !== 'deck') return false;
  const moved = !zone.deckRegionBounds && separateDeckRegions(zone, headerHeight, isLandscape);
  const upgraded = zone.deckRegionBounds === undefined;
  zone.deckRegionBounds ??= {};
  const bounds = getDeckAreaBounds(zone, headerHeight, isLandscape);
  const changed = upgraded || moved || Object.entries(bounds).some(([key, value]) => zone.bounds[key as keyof CanvasAreaBounds] !== value);
  zone.bounds = bounds;
  return changed;
}

/** Open only missing title/border gaps in older layouts, preserving each group's internal grid. */
function separateDeckRegions(zone: CanvasArea, headerHeight: number, isLandscape: (name: string) => boolean): boolean {
  let changed = false;
  const separate = (regions: Array<{rect: CanvasAreaBounds; members: CanvasCardInstance[]}>) => {
    regions.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    regions.forEach((region, index) => {
      for (const earlier of regions.slice(0, index)) {
        const a = earlier.rect, b = region.rect;
        if (a.x >= b.x + b.width + DECK_BOARD_GAP || b.x >= a.x + a.width + DECK_BOARD_GAP) continue;
        const overlap = a.y + a.height + DECK_BOARD_GAP - b.y;
        if (overlap <= 0) continue;
        const dy = Math.ceil(overlap / DRAWN_GRID.height) * DRAWN_GRID.height;
        for (const card of region.members) card.y += dy;
        region.rect.y += dy;
        changed = true;
      }
    });
  };
  // The extra room for statistics is optional in an existing arrangement. A
  // legacy save without rectangles still gets only its original title gaps.
  const children = layoutMainDeckSections(zone.cards, isLandscape, {}, {}, undefined, true).rects;
  separate((['spellbook', 'atlas'] as const).flatMap(key => children[key] ? [{rect: required(children[key]), members: zone.cards.filter(card => normalizeDeckBoard(card.board) === 'mainboard' && isLandscape(card.cardName) === (key === 'atlas'))}] : []));
  const rects = layoutDeckBoards(zone.bounds, zone.cards, headerHeight, isLandscape, zone.deckRegionBounds, {}, true);
  separate(DECK_BOARD_ORDER.filter(board => zone.cards.some(card => normalizeDeckBoard(card.board) === board))
    .map(board => ({rect: rects[board], members: zone.cards.filter(card => normalizeDeckBoard(card.board) === board)})));
  return changed;
}

/** Fill free slots or extend right, leaving all existing cards and other boards in place. */
export function placeNewDeckCards(
  zone: CanvasArea,
  additions: CanvasCardInstance[],
  isLandscape: (name: string) => boolean,
): void {
  const headerHeight = CARD_SIZE.PORTRAIT.height + 16 + DRAWN_GRID.height;
  const rects = getDeckBoardRects(zone.bounds, zone.cards, headerHeight, isLandscape, zone.deckRegionBounds);
  const occupied = [...zone.cards];
  for (const addition of additions) {
    const board = normalizeDeckBoard(addition.board);
    addition.board = board;
    const sameCard = occupied.find((card) => normalizeDeckBoard(card.board) === board && card.cardName === addition.cardName && !card.labelId);
    if (sameCard) {
      addition.x = sameCard.x;
      addition.y = sameCard.y;
      occupied.push(addition);
      continue;
    }
    const landscape = isLandscape(addition.cardName);
    const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const spacing = landscape ? CARD_CELL_SPACING.LANDSCAPE : CARD_CELL_SPACING.PORTRAIT;
    const rect = rects[board];
    const sameType = occupied.filter((card) => normalizeDeckBoard(card.board) === board && isLandscape(card.cardName) === landscape);
    const startX = sameType.length ? Math.min(...sameType.map((card) => card.x)) : rect.x + DECK_BOARD_INNER_PADDING;
    let startY = sameType.length ? Math.min(...sameType.map((card) => card.y)) : rect.y + DECK_BOARD_TOP_GAP;
    let lastRowY = rect.y + rect.height - DECK_BOARD_BOTTOM_PADDING - size.height;
    if (board === 'mainboard') {
      if (sameType.length) {
        // Spellbook vacancies must not be searched through the Atlas (or vice
        // versa). Grow a full orientation row sideways without moving cards.
        lastRowY = Math.max(...sameType.map((card) => card.y));
      } else {
        const opposite = occupied.filter((card) => normalizeDeckBoard(card.board) === board);
        const oppositeBounds = cardExtents(opposite, isLandscape).get(board);
        if (oppositeBounds) {
          // Retain a full title gap even if snapping moves the new row inward.
          const sectionGap = DECK_BOARD_TOP_GAP + DECK_BOARD_BOTTOM_PADDING + DECK_BOARD_GAP + DRAWN_GRID.height;
          startY = landscape ? oppositeBounds.bottom + sectionGap : oppositeBounds.top - size.height - sectionGap;
        }
        lastRowY = startY;
      }
    }
    const rows = Math.max(1, Math.floor((lastRowY - startY) / (spacing.y * DRAWN_GRID.height)) + 1);
    // A new free column is guaranteed after the rightmost occupied card.
    const maxRight = Math.max(rect.x + rect.width, ...occupied.map((card) => card.x + (isLandscape(card.cardName) ? CARD_SIZE.LANDSCAPE.width : CARD_SIZE.PORTRAIT.width)));
    const columns = Math.ceil((maxRight - startX) / (spacing.x * DRAWN_GRID.width)) + 2;
    let placed = false;
    for (let col = 0; col < columns && !placed; col++) {
      for (let row = 0; row < rows; row++) {
        const snap = snapCardCenter(startX + col * spacing.x * DRAWN_GRID.width + size.width / 2,
          startY + row * spacing.y * DRAWN_GRID.height + size.height / 2, landscape);
        const x = sameType.length ? startX + col * spacing.x * DRAWN_GRID.width : snap.x - size.width / 2;
        const y = sameType.length ? startY + row * spacing.y * DRAWN_GRID.height : snap.y - size.height / 2;
        if (occupied.some((card) => {
          const other = isLandscape(card.cardName) ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
          return x < card.x + other.width + 4 && x + size.width + 4 > card.x && y < card.y + other.height + 4 && y + size.height + 4 > card.y;
        })) continue;
        addition.x = x;
        addition.y = y;
        placed = true;
        break;
      }
    }
    occupied.push(addition);
  }
}

function overlapsHorizontally(a: CanvasAreaBounds, b: CanvasAreaBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x;
}

function overlapsRegion(a: CanvasAreaBounds, b: CanvasAreaBounds): boolean {
  return a.y < b.y + b.height && a.y + a.height > b.y && overlapsHorizontally(a, b);
}

function sectionHeaderTop(frame: CanvasAreaBounds, contentTop: number, obstacles: CanvasAreaBounds[]): number {
  const desired = contentTop - DECK_SECTION_HEADER_HEIGHT;
  const nearest = Math.max(-Infinity, ...obstacles.filter(bounds => overlapsHorizontally(frame, bounds) && bounds.y < contentTop)
    .map(bounds => bounds.y + bounds.height));
  // Prefer the normal frame gap, but use part of it for the title when the
  // gap is cramped. An existing overlap can leave no strip at all.
  const padded = Math.min(nearest + DECK_BOARD_BOTTOM_PADDING + DECK_BOARD_GAP, contentTop - DECK_REGION_TITLE_HEIGHT);
  return Math.min(contentTop, Math.max(desired, nearest, padded));
}

function getSectionHeaderBounds(frame: CanvasAreaBounds, contentTop: number, bandTop: number,
  obstacles: CanvasAreaBounds[]): CanvasAreaBounds {
  const y = frame.y;
  let bottom = Math.min(contentTop, y + DECK_SECTION_HEADER_HEIGHT);
  for (const obstacle of obstacles) {
    if (obstacle.y < bottom && obstacle.y + obstacle.height > y && overlapsHorizontally(frame, obstacle)) {
      bottom = Math.max(y, obstacle.y);
    }
  }
  if (bottom - y < DECK_REGION_TITLE_HEIGHT && bandTop > y && contentTop - bandTop >= DECK_REGION_TITLE_HEIGHT) {
    const available = getSectionHeaderBounds({ ...frame, y: bandTop }, contentTop, bandTop, obstacles);
    if (available.height > bottom - y) return available;
  }
  return { x: frame.x, y, width: frame.width, height: Math.max(0, bottom - y) };
}

function getHeaderAboveSharedLabels(
  header: CanvasAreaBounds, shared: CanvasAreaBounds[], obstacles: CanvasAreaBounds[],
): CanvasAreaBounds | undefined {
  const labels = shared.filter(label => overlapsHorizontally(header, label));
  const occupiedBottom = Math.max(-Infinity, ...obstacles.filter(rect =>
    rect.y < header.y + header.height && overlapsHorizontally(header, rect))
    .map(rect => rect.y + rect.height));

  let candidate = header;
  while (candidate.height >= DECK_REGION_TITLE_HEIGHT) {
    const bottom = Math.min(Infinity, ...labels.filter(label =>
      label.y < candidate.y + candidate.height && label.y + label.height > candidate.y).map(label => label.y));
    if (bottom === Infinity) return candidate;
    const y = Math.min(bottom, Math.max(bottom - DECK_SECTION_HEADER_HEIGHT, occupiedBottom));
    candidate = { ...header, y, height: bottom - y };
  }
  return undefined;
}

function layoutMainDeckSections(
  cards: CanvasCardInstance[],
  isLandscape: (name: string) => boolean,
  saved: DeckRegionBounds,
  labels: MainDeckLabelBounds,
  mainOrigin: { x: number; y: number } | undefined,
  legacySectionHeaders: boolean,
): { rects: MainDeckSectionBounds; headers: MainDeckSectionBounds } {
  const rects: MainDeckSectionBounds = {};
  const headers: MainDeckSectionBounds = {};
  const preferredHeaders: MainDeckSectionBounds = {};
  const stacks = deckCardStackBounds(cards, isLandscape);
  const shared = labels.shared ?? [];
  const obstacles: Record<MainDeckSection, CanvasAreaBounds[]> = { spellbook: [], atlas: [] };
  for (const [key, sibling] of MAIN_DECK_SECTION_PAIRS) {
    const belongs = (stack: typeof stacks[number]) => stack.board === 'mainboard' && stack.landscape === (key === 'atlas');
    const members = [...(labels[key] ?? []), ...stacks.filter(belongs).map(stack => stack.bounds)];
    obstacles[key] = [...(labels[sibling] ?? []), ...stacks.filter(stack => !belongs(stack)).map(stack => stack.bounds)];
    const manual = saved[key];
    if (!members.length) {
      if (manual) rects[key] = { ...manual, width: mainOrigin ? Math.max(manual.width, DECK_SECTION_COMPACT_WIDTH) : manual.width };
      continue;
    }
    const content = members.reduce(unionRegionBounds);
    const padded = { x: content.x - DECK_BOARD_INNER_PADDING, y: content.y,
      width: content.width + DECK_BOARD_INNER_PADDING * 2, height: content.height + DECK_BOARD_BOTTOM_PADDING };
    const frame = manual ? unionRegionBounds(padded, manual) : padded;
    if (mainOrigin) frame.width = Math.max(frame.width, DECK_SECTION_COMPACT_WIDTH);
    const bandTop = legacySectionHeaders ? content.y - DECK_BOARD_TOP_GAP : sectionHeaderTop(frame, content.y, obstacles[key]);
    const top = Math.min(frame.y, bandTop);
    const rect = { ...frame, y: top, height: frame.y + frame.height - top };
    rects[key] = rect;
    const header = getSectionHeaderBounds(rect, content.y, bandTop, [...obstacles[key], ...shared]);
    headers[key] = header;
    if (shared.length && header.height < DECK_SECTION_HEADER_HEIGHT) {
      preferredHeaders[key] = getSectionHeaderBounds({ ...rect, y: bandTop }, content.y, bandTop, obstacles[key]);
    }
  }
  // Restore space lost to a shared label when there is room immediately
  // above it. A different card section still limits how far we can move.
  for (const [key, sibling] of MAIN_DECK_SECTION_PAIRS) {
    const preferred = preferredHeaders[key];
    const header = headers[key];
    const rect = rects[key];
    if (!preferred || !header || !rect || preferred.height <= header.height) continue;
    const siblingFrame = rects[sibling];
    const candidate = getHeaderAboveSharedLabels(preferred, shared, siblingFrame
      ? [...obstacles[key], siblingFrame] : obstacles[key]);
    if (!candidate || candidate.height <= header.height) continue;
    headers[key] = candidate;
    rects[key] = unionRegionBounds(rect, candidate);
  }
  // Empty sections have room for their title and tabs, within Main's compact width.
  if (mainOrigin) {
    for (const [key, sibling] of MAIN_DECK_SECTION_PAIRS) {
      if (rects[key]) continue;
      const neighbour = rects[sibling];
      let y = neighbour ? neighbour.y + neighbour.height + 8 : mainOrigin.y + DECK_BOARD_TOP_GAP;
      const x = neighbour?.x ?? mainOrigin.x + DECK_BOARD_INNER_PADDING;
      const height = legacySectionHeaders ? LEGACY_EMPTY_SECTION_HEIGHT : EMPTY_SECTION_HEIGHT;
      if (neighbour && (key === 'spellbook' || stacks.some(stack => {
        if (stack.board === 'mainboard') return false;
        const bounds = stack.bounds;
        return overlapsHorizontally({ x, y, width: DECK_SECTION_COMPACT_WIDTH, height }, bounds) &&
          y < bounds.y + bounds.height && y + height + DECK_BOARD_TOP_GAP > bounds.y;
      }))) y = neighbour.y - height - 8;
      rects[key] = { x, y, width: DECK_SECTION_COMPACT_WIDTH, height };
    }
  }
  for (const key of MAIN_DECK_SECTIONS) {
    const rect = rects[key];
    if (!rect || headers[key]) continue;
    const bottom = rect.y + rect.height;
    headers[key] = getSectionHeaderBounds(rect, bottom, sectionHeaderTop(rect, bottom, obstacles[key]),
      [...obstacles[key], ...shared]);
  }
  // Widen compact headings after both sections have claimed their space.
  if (mainOrigin && !legacySectionHeaders) {
    for (const [key, sibling] of MAIN_DECK_SECTION_PAIRS) {
      const rect = rects[key], header = headers[key], siblingFrame = rects[sibling];
      if (!rect || !header?.height || rect.width >= DECK_SECTION_MIN_WIDTH) continue;
      const extraWidth = DECK_SECTION_MIN_WIDTH - rect.width;
      const blockers = siblingFrame ? [...obstacles[key], siblingFrame] : obstacles[key];
      const freeEdge = [rect.x + rect.width, rect.x - extraWidth].find(x => {
        const edge = { ...rect, x, width: extraWidth };
        const headingEdge = { ...header, x, width: extraWidth };
        return !blockers.some(blocker => overlapsRegion(edge, blocker)) &&
          !shared.some(label => overlapsRegion(headingEdge, label));
      });
      if (freeEdge === undefined) continue;
      const x = Math.min(freeEdge, rect.x);
      rects[key] = { ...rect, x, width: DECK_SECTION_MIN_WIDTH };
      headers[key] = { ...header, x, width: DECK_SECTION_MIN_WIDTH };
    }
  }
  return { rects, headers };
}

/** The available header strip accounts for the neighbouring stacks and label rows. */
export function getMainDeckSectionLayout(
  cards: CanvasCardInstance[],
  isLandscape: (name: string) => boolean,
  saved: DeckRegionBounds = {},
  labels: MainDeckLabelBounds = {},
  mainOrigin?: { x: number; y: number },
): { rects: MainDeckSectionBounds; headers: MainDeckSectionBounds } {
  return layoutMainDeckSections(cards, isLandscape, saved, labels, mainOrigin, false);
}

/** Main's physical orientation regions follow its cards without changing membership. */
export function getMainDeckSectionRects(
  cards: CanvasCardInstance[],
  isLandscape: (name: string) => boolean,
  saved: DeckRegionBounds = {},
  labels: MainDeckLabelBounds = {},
  mainOrigin?: { x: number; y: number },
): MainDeckSectionBounds {
  return getMainDeckSectionLayout(cards, isLandscape, saved, labels, mainOrigin).rects;
}
