/**
 * Grid system for card layout and snapping
 *
 * Three overlapping grids:
 * 1. DRAWN GRID: 55×55px - visual grid lines (can be changed independently)
 * 2. PORTRAIT SNAP GRID: Same spacing, offset vertically by half grid height
 *    - Portrait cards snap their CENTER to intersections of this grid
 * 3. LANDSCAPE SNAP GRID: Same spacing, offset horizontally by half grid width
 *    - Landscape cards snap their CENTER to intersections of this grid
 *
 * Cards are always drawn from their CENTER point at grid intersections.
 * This allows the drawn grid to be changed (even non-square) without affecting snapping.
 */

import type { CardType, ThresholdGroup, CardRarity } from '@/data/dataModels';

// ============================================================================
// Grid Constants
// ============================================================================

/** Drawn grid dimensions (visual only - can be changed to non-square) */
export const DRAWN_GRID = {
  width: 55,
  height: 55,
} as const;

/** Snap grid spacing (matches drawn grid but could differ) */
export const SNAP_GRID = {
  width: DRAWN_GRID.width,
  height: DRAWN_GRID.height,
} as const;

/**
 * Snap grid offsets from drawn grid origin
 * - Portrait: offset down by half grid height (cards sit between horizontal lines)
 * - Landscape: offset right by half grid width (cards sit between vertical lines)
 */
export const SNAP_GRID_OFFSET = {
  PORTRAIT: {
    x: 0,
    y: SNAP_GRID.height / 2, // 27.5px down
  },
  LANDSCAPE: {
    x: SNAP_GRID.width / 2, // 27.5px right
    y: 0,
  },
} as const;

// ============================================================================
// Card Constants
// ============================================================================

/** Card drawn dimensions in pixels (100×140 maintains TCG aspect ratio) */
export const CARD_SIZE = {
  PORTRAIT: { width: 100, height: 140 },
  LANDSCAPE: { width: 140, height: 100 },
} as const;

/** Card spacing in snap grid cells (how many cells between card centers) */
export const CARD_CELL_SPACING = {
  PORTRAIT: { x: 2, y: 3 },  // Centers are 2 cells apart horizontally, 3 vertically
  LANDSCAPE: { x: 3, y: 2 }, // Centers are 3 cells apart horizontally, 2 vertically
} as const;

// ============================================================================
// Layout Constants
// ============================================================================

/**
 * Stack offset in pixels - when multiple cards are at the same position,
 * each subsequent card is offset by this amount to show a peek of cards underneath
 */
export const STACK_OFFSET = 15; // Small offset to show cards are stacked

/** Grid line appearance */
export const GRID_LINE = {
  COLOR: 0x3a3a4e,
  ALPHA: 0.3,
  WIDTH: 1,
} as const;

/** Group spacing in grid units */
export const GROUP_GAP_UNITS = 4;     // 4 empty grids between element groups horizontally
export const SUBGROUP_GAP_UNITS = 1;  // 1 empty grid between card types vertically

/** Cards per row in each group */
export const CARDS_PER_ROW = {
  SPELL: 12,
  SITE: 8,
  AVATAR: 12,
} as const;

/** Avatar set order (for sorting) */
export const AVATAR_SET_ORDER = [
  'Alpha',
  'Beta',
  'Arthurian Legends',
  'Dragonlord',
  'Gothic',
  'Promotional',
] as const;

/** Rarity order for sorting (None/precon first, then by rarity) */
export const RARITY_ORDER: Record<string, number> = {
  'None': 0,
  'Ordinary': 1,
  'Exceptional': 2,
  'Elite': 3,
  'Unique': 4,
};

// ============================================================================
// Types
// ============================================================================

export interface GridPosition {
  x: number;
  y: number;
}

/** Position represents the CENTER of the card */
export interface CardLayoutInfo {
  name: string;
  position: GridPosition; // CENTER position
  isLandscape: boolean;
  thresholdGroup: ThresholdGroup;
  type: CardType;
  cost: number;
}

// ============================================================================
// Grid Math - Snap Grid Operations
// ============================================================================

/**
 * Get the snap grid offset for a card type
 */
export function getSnapGridOffset(isLandscape: boolean): GridPosition {
  return isLandscape ? { ...SNAP_GRID_OFFSET.LANDSCAPE } : { ...SNAP_GRID_OFFSET.PORTRAIT };
}

/**
 * Convert snap grid coordinates to pixel position (card CENTER)
 * @param gridX - Snap grid column
 * @param gridY - Snap grid row
 * @param isLandscape - Whether the card is landscape
 * @returns Pixel position of the card CENTER
 */
export function snapGridToPixels(gridX: number, gridY: number, isLandscape: boolean): GridPosition {
  const offset = getSnapGridOffset(isLandscape);
  return {
    x: offset.x + gridX * SNAP_GRID.width,
    y: offset.y + gridY * SNAP_GRID.height,
  };
}

/**
 * Convert pixel position to snap grid coordinates
 * @param x - Pixel x (card center)
 * @param y - Pixel y (card center)
 * @param isLandscape - Whether the card is landscape
 * @returns Snap grid coordinates
 */
export function pixelsToSnapGrid(x: number, y: number, isLandscape: boolean): GridPosition {
  const offset = getSnapGridOffset(isLandscape);
  return {
    x: Math.round((x - offset.x) / SNAP_GRID.width),
    y: Math.round((y - offset.y) / SNAP_GRID.height),
  };
}

/**
 * Snap a card's center position to the nearest snap grid intersection
 * @param centerX - Current center X position
 * @param centerY - Current center Y position
 * @param isLandscape - Whether the card is landscape
 * @returns Snapped center position
 */
export function snapCardCenter(centerX: number, centerY: number, isLandscape: boolean): GridPosition {
  const gridPos = pixelsToSnapGrid(centerX, centerY, isLandscape);
  return snapGridToPixels(gridPos.x, gridPos.y, isLandscape);
}

/**
 * Snap a card position (given as top-left) to the nearest snap grid intersection
 * Returns the new top-left position after snapping the center
 */
export function snapCardToGrid(x: number, y: number, isLandscape: boolean): GridPosition {
  const cardSize = getCardPixelSize(isLandscape);
  const centerX = x + cardSize.width / 2;
  const centerY = y + cardSize.height / 2;

  const snappedCenter = snapCardCenter(centerX, centerY, isLandscape);

  return {
    x: snappedCenter.x - cardSize.width / 2,
    y: snappedCenter.y - cardSize.height / 2,
  };
}

// ============================================================================
// Grid Math - Drawn Grid Operations (for visual grid rendering)
// ============================================================================

/** Snap a pixel position to the nearest drawn grid intersection */
export function snapToDrawnGrid(x: number, y: number): GridPosition {
  return {
    x: Math.round(x / DRAWN_GRID.width) * DRAWN_GRID.width,
    y: Math.round(y / DRAWN_GRID.height) * DRAWN_GRID.height,
  };
}

/** Convert drawn grid coordinates to pixel position */
export function drawnGridToPixels(gridX: number, gridY: number): GridPosition {
  return {
    x: gridX * DRAWN_GRID.width,
    y: gridY * DRAWN_GRID.height,
  };
}

// ============================================================================
// Card Helpers
// ============================================================================

/** Get card pixel size based on orientation */
export function getCardPixelSize(isLandscape: boolean): { width: number; height: number } {
  return isLandscape ? { ...CARD_SIZE.LANDSCAPE } : { ...CARD_SIZE.PORTRAIT };
}

/** Get card cell spacing based on orientation */
export function getCardCellSpacing(isLandscape: boolean): { x: number; y: number } {
  return isLandscape ? { ...CARD_CELL_SPACING.LANDSCAPE } : { ...CARD_CELL_SPACING.PORTRAIT };
}

/**
 * Get the CENTER position for a card at a given grid cell
 * @param cellX - Cell column (in card spacing units, not raw grid)
 * @param cellY - Cell row (in card spacing units, not raw grid)
 * @param isLandscape - Whether the card is landscape
 * @returns Pixel position of the card CENTER
 */
export function getCardCenterPosition(cellX: number, cellY: number, isLandscape: boolean): GridPosition {
  const spacing = getCardCellSpacing(isLandscape);
  const gridX = cellX * spacing.x;
  const gridY = cellY * spacing.y;
  return snapGridToPixels(gridX, gridY, isLandscape);
}

// ============================================================================
// Legacy compatibility - these map to the new system
// ============================================================================

/** @deprecated Use SNAP_GRID.width instead */
export const GRID_UNIT = SNAP_GRID.width;

/** @deprecated Use getCardCellSpacing instead */
export function getCardCellSize(isLandscape: boolean): { width: number; height: number } {
  const spacing = getCardCellSpacing(isLandscape);
  return { width: spacing.x, height: spacing.y };
}

/** @deprecated Use drawnGridToPixels instead */
export function gridToPixels(gridX: number, gridY: number): GridPosition {
  return drawnGridToPixels(gridX, gridY);
}

/** @deprecated Use snapToDrawnGrid instead */
export function snapToGrid(x: number, y: number): GridPosition {
  return snapToDrawnGrid(x, y);
}

/** @deprecated Use pixelsToSnapGrid instead */
export function pixelsToGrid(x: number, y: number): GridPosition {
  return {
    x: Math.floor(x / DRAWN_GRID.width),
    y: Math.floor(y / DRAWN_GRID.height),
  };
}

// ============================================================================
// Layout Calculation
// ============================================================================

const THRESHOLD_GROUP_ORDER: ThresholdGroup[] = [
  'air',
  'earth',
  'fire',
  'water',
  'multiple',
  'none',
];

const TYPE_ORDER: CardType[] = ['Minion', 'Magic', 'Aura', 'Artifact', 'Site'];

export interface LayoutConfig {
  cards: Array<{
    name: string;
    type: CardType;
    thresholdGroup: ThresholdGroup;
    cost: number;
    isLandscape: boolean;
    primarySet?: string;
    rarity?: CardRarity | null;
  }>;
}

export interface ContentBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LayoutResult {
  cards: CardLayoutInfo[];
  bounds: ContentBounds;
}

/**
 * Calculate card layout positions (returns CENTER positions)
 * Cards are positioned on their snap grid with proper spacing
 */
export function calculateCardLayout(config: LayoutConfig): LayoutResult {
  const cards: CardLayoutInfo[] = [];

  // Track content bounds
  let contentLeft = Infinity;
  let contentTop = Infinity;
  let contentRight = -Infinity;
  let contentBottom = -Infinity;

  const updateBounds = (centerX: number, centerY: number, isLandscape: boolean) => {
    const cardSize = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const left = centerX - cardSize.width / 2;
    const top = centerY - cardSize.height / 2;
    const right = left + cardSize.width;
    const bottom = top + cardSize.height;

    contentLeft = Math.min(contentLeft, left);
    contentTop = Math.min(contentTop, top);
    contentRight = Math.max(contentRight, right);
    contentBottom = Math.max(contentBottom, bottom);
  };

  const avatars = config.cards.filter((c) => c.type === 'Avatar');
  const nonAvatars = config.cards.filter((c) => c.type !== 'Avatar');

  const grouped = groupCards(nonAvatars);

  // Track position in snap grid units (not pixels)
  let currentGridX = 0;

  for (const thresholdGroup of THRESHOLD_GROUP_ORDER) {
    const thresholdCards = grouped.get(thresholdGroup);
    if (!thresholdCards || thresholdCards.size === 0) continue;

    let maxGroupGridWidth = 0;
    let currentGridY = 0;

    for (const type of TYPE_ORDER) {
      const typeCards = thresholdCards.get(type);
      if (!typeCards || typeCards.length === 0) continue;

      const sorted = [...typeCards].sort((a, b) => a.cost - b.cost);
      const isLandscape = type === 'Site';
      const cardsPerRow = isLandscape ? CARDS_PER_ROW.SITE : CARDS_PER_ROW.SPELL;
      const spacing = getCardCellSpacing(isLandscape);

      for (const [i, card] of sorted.entries()) {
        const col = i % cardsPerRow;
        const row = Math.floor(i / cardsPerRow);

        // Calculate snap grid position
        const gridX = currentGridX + col * spacing.x;
        const gridY = currentGridY + row * spacing.y;

        // Convert to pixel CENTER position
        const position = snapGridToPixels(gridX, gridY, isLandscape);

        cards.push({
          name: card.name,
          position,
          isLandscape,
          thresholdGroup: card.thresholdGroup,
          type: card.type,
          cost: card.cost,
        });

        updateBounds(position.x, position.y, isLandscape);

        // Track max width for this group
        const cardRight = (col + 1) * spacing.x;
        if (cardRight > maxGroupGridWidth) {
          maxGroupGridWidth = cardRight;
        }
      }

      // Move Y down for next type subgroup
      const rows = Math.ceil(sorted.length / cardsPerRow);
      currentGridY += rows * spacing.y + SUBGROUP_GAP_UNITS;
    }

    // Move X right for next threshold group
    currentGridX += maxGroupGridWidth + GROUP_GAP_UNITS;
  }

  // Layout avatars
  if (avatars.length > 0) {
    const sortedAvatars = [...avatars].sort((a, b) => {
      const aSetIndex = getAvatarSetIndex(a.primarySet);
      const bSetIndex = getAvatarSetIndex(b.primarySet);

      if (aSetIndex !== bSetIndex) {
        return aSetIndex - bSetIndex;
      }

      const aRarityIndex = RARITY_ORDER[a.rarity ?? 'None'] ?? 0;
      const bRarityIndex = RARITY_ORDER[b.rarity ?? 'None'] ?? 0;

      return aRarityIndex - bRarityIndex;
    });

    const cardsPerRow = CARDS_PER_ROW.AVATAR;
    const spacing = getCardCellSpacing(false); // Avatars are portrait

    for (const [i, avatar] of sortedAvatars.entries()) {
      const col = i % cardsPerRow;
      const row = Math.floor(i / cardsPerRow);

      const gridX = currentGridX + col * spacing.x;
      const gridY = row * spacing.y;

      const position = snapGridToPixels(gridX, gridY, false);

      cards.push({
        name: avatar.name,
        position,
        isLandscape: false,
        thresholdGroup: avatar.thresholdGroup,
        type: 'Avatar',
        cost: avatar.cost,
      });

      updateBounds(position.x, position.y, false);
    }
  }

  // Default bounds if no cards
  const bounds: ContentBounds = {
    left: contentLeft === Infinity ? 0 : contentLeft,
    top: contentTop === Infinity ? 0 : contentTop,
    right: contentRight === -Infinity ? 0 : contentRight,
    bottom: contentBottom === -Infinity ? 0 : contentBottom,
  };

  return { cards, bounds };
}

function getAvatarSetIndex(setName?: string): number {
  if (!setName) return AVATAR_SET_ORDER.length;
  const index = AVATAR_SET_ORDER.indexOf(setName as typeof AVATAR_SET_ORDER[number]);
  return index >= 0 ? index : AVATAR_SET_ORDER.length;
}

function groupCards(
  cards: LayoutConfig['cards']
): Map<ThresholdGroup, Map<CardType, LayoutConfig['cards']>> {
  const result = new Map<ThresholdGroup, Map<CardType, LayoutConfig['cards']>>();

  for (const card of cards) {
    let thresholdMap = result.get(card.thresholdGroup);
    if (!thresholdMap) {
      thresholdMap = new Map();
      result.set(card.thresholdGroup, thresholdMap);
    }

    let typeList = thresholdMap.get(card.type);
    if (!typeList) {
      typeList = [];
      thresholdMap.set(card.type, typeList);
    }

    typeList.push(card);
  }

  return result;
}
