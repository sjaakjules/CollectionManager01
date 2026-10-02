import type { ActiveBoard } from '@/data/dataModels';
import type { CanvasArea, CanvasAreaBounds, CanvasCardInstance } from './canvasAreas';
import { CARD_CELL_SPACING, CARD_SIZE, DRAWN_GRID, snapCardCenter } from '@/rendering/Grid';

export const DECK_BOARD_ORDER = ['mainboard', 'collection', 'maybeboard'] as const;
export type DeckZoneBoard = typeof DECK_BOARD_ORDER[number];
export const DECK_BOARD_PADDING = 14;
export const DECK_BOARD_INNER_PADDING = 12;
export const DECK_BOARD_TOP_GAP = DRAWN_GRID.height;
export const DECK_BOARD_GAP = 10;
export const DECK_BOARD_BOTTOM_PADDING = 10;
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
export const DECK_BOARD_MIN_HEIGHT: Record<DeckZoneBoard, number> = {
  mainboard: CARD_SIZE.PORTRAIT.height + DECK_BOARD_TOP_GAP + 6,
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

function cardExtents(cards: CanvasCardInstance[], isLandscape: (name: string) => boolean) {
  const extents = new Map<DeckZoneBoard, { left: number; top: number; right: number; bottom: number }>();
  for (const card of cards) {
    const board = normalizeDeckBoard(card.board);
    const size = isLandscape(card.cardName) ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const bounds = extents.get(board) ?? { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    bounds.left = Math.min(bounds.left, card.x);
    bounds.top = Math.min(bounds.top, card.y);
    bounds.right = Math.max(bounds.right, card.x + size.width);
    bounds.bottom = Math.max(bounds.bottom, card.y + size.height);
    extents.set(board, bounds);
  }
  return extents;
}

/** Content-bearing boards follow their cards; empty boards retain ordered drop targets. */
export function getDeckBoardRects(
  bounds: CanvasAreaBounds,
  cards: CanvasCardInstance[],
  headerHeight: number,
  isLandscape: (name: string) => boolean,
): Record<DeckZoneBoard, CanvasAreaBounds> {
  const extents = cardExtents(cards, isLandscape);
  let top = bounds.y + headerHeight + DECK_BOARD_PADDING;
  const rect = (board: DeckZoneBoard): CanvasAreaBounds => {
    const content = extents.get(board);
    const x = content ? content.left - DECK_BOARD_INNER_PADDING : bounds.x + DECK_BOARD_PADDING;
    const y = content ? content.top - DECK_BOARD_TOP_GAP : top;
    const minWidth = !content && board === 'collection'
      ? DECK_COLLECTION_WIDTH : DECK_COMPACT_BOARD_WIDTH;
    const width = Math.max(minWidth,
      content ? content.right + DECK_BOARD_INNER_PADDING - x : 0);
    const height = Math.max(DECK_BOARD_MIN_HEIGHT[board],
      content ? content.bottom + DECK_BOARD_BOTTOM_PADDING - y : 0);
    const result = { x, y, width, height };
    top = Math.max(top, y + height) + DECK_BOARD_GAP;
    return result;
  };
  return { mainboard: rect('mainboard'), collection: rect('collection'), maybeboard: rect('maybeboard') };
}

/** Derive a frame from current contents, including empty boards, without moving cards. */
export function getDeckAreaBounds(
  zone: Pick<CanvasArea, 'bounds' | 'cards'>,
  headerHeight: number,
  isLandscape: (name: string) => boolean,
  preserveTopLeft = false,
): CanvasAreaBounds {
  const extents = cardExtents(zone.cards, isLandscape);
  let x = zone.bounds.x;
  let y = zone.bounds.y;
  if (extents.size > 0 && !preserveTopLeft) {
    x = Math.min(...Array.from(extents.values(), (value) => value.left)) - DECK_BOARD_INNER_PADDING - DECK_BOARD_PADDING;
    let precedingEmptyHeight = 0;
    const candidateTops: number[] = [];
    let sawContent = false;
    for (const board of DECK_BOARD_ORDER) {
      const content = extents.get(board);
      if (content) {
        candidateTops.push(content.top - DECK_BOARD_TOP_GAP - (sawContent ? 0 : precedingEmptyHeight));
        sawContent = true;
      } else if (!sawContent) {
        precedingEmptyHeight += DECK_BOARD_MIN_HEIGHT[board] + DECK_BOARD_GAP;
      }
    }
    y = Math.min(...candidateTops) - headerHeight - DECK_BOARD_PADDING;
  }
  const rects = getDeckBoardRects({ ...zone.bounds, x, y }, zone.cards, headerHeight, isLandscape);
  const right = Math.max(...DECK_BOARD_ORDER.map((board) => rects[board].x + rects[board].width));
  const bottom = Math.max(...DECK_BOARD_ORDER.map((board) => rects[board].y + rects[board].height));
  return { x, y, width: Math.max(DECK_MIN_WIDTH, right + DECK_BOARD_PADDING - x), height: bottom + DECK_BOARD_PADDING - y };
}

/** Reconcile saved frames without changing any card positions or memberships. */
export function fitDeckBoardSections(zone: CanvasArea, headerHeight: number, isLandscape: (name: string) => boolean): boolean {
  if (zone.type !== 'deck') return false;
  const bounds = getDeckAreaBounds(zone, headerHeight, isLandscape);
  const changed = Object.entries(bounds).some(([key, value]) => zone.bounds[key as keyof CanvasAreaBounds] !== value);
  zone.bounds = bounds;
  return changed;
}

/** Fill free slots or extend right, leaving all existing cards and other boards in place. */
export function placeNewDeckCards(
  zone: CanvasArea,
  additions: CanvasCardInstance[],
  isLandscape: (name: string) => boolean,
): void {
  const headerHeight = CARD_SIZE.PORTRAIT.height + 16 + DRAWN_GRID.height;
  const rects = getDeckBoardRects(zone.bounds, zone.cards, headerHeight, isLandscape);
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
        if (opposite.length) {
          // Retain a full title gap even if snapping moves the new row inward.
          const sectionGap = DECK_BOARD_TOP_GAP + DRAWN_GRID.height / 2;
          startY = landscape
            ? Math.max(...opposite.map((card) => card.y + CARD_SIZE.PORTRAIT.height)) + sectionGap
            : Math.min(...opposite.map((card) => card.y)) - size.height - sectionGap;
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

/** Main's physical orientation regions follow its cards without changing membership. */
export function getMainDeckSectionRects(
  cards: CanvasCardInstance[],
  isLandscape: (name: string) => boolean,
): { spellbook?: CanvasAreaBounds; atlas?: CanvasAreaBounds } {
  const result: { spellbook?: CanvasAreaBounds; atlas?: CanvasAreaBounds } = {};
  for (const [key, landscape] of [['spellbook', false], ['atlas', true]] as const) {
    const members = cards.filter((card) => normalizeDeckBoard(card.board) === 'mainboard' && isLandscape(card.cardName) === landscape);
    if (!members.length) continue;
    const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const left = Math.min(...members.map((card) => card.x));
    const top = Math.min(...members.map((card) => card.y));
    const right = Math.max(...members.map((card) => card.x + size.width));
    const bottom = Math.max(...members.map((card) => card.y + size.height));
    result[key] = { x:left-DECK_BOARD_INNER_PADDING, y:top-DECK_BOARD_TOP_GAP/2,
      width:right-left+DECK_BOARD_INNER_PADDING*2, height:bottom-top+DECK_BOARD_TOP_GAP/2+DECK_BOARD_BOTTOM_PADDING };
  }
  return result;
}
