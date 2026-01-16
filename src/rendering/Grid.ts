/**
 * Grid system for card layout and snapping
 *
 * Grid unit: 55px (visible as faint background grid)
 * Cards occupy 2×3 grid cells (portrait) or 3×2 (landscape)
 * Cards are centered within their cell area
 * Stacked cards are offset to show underlying card names
 */

import type { CardType, ThresholdGroup, CardRarity } from '@/data/dataModels';

// ============================================================================
// Constants
// ============================================================================

/** Base grid unit in pixels (55×55 grid cells) */
export const GRID_UNIT = 55;

/** Card dimensions in grid cells */
export const CARD_CELLS = {
  PORTRAIT: { width: 2, height: 3 },   // 110×165 pixels
  LANDSCAPE: { width: 3, height: 2 },  // 165×110 pixels
} as const;

/** Card dimensions in pixels (derived from grid cells) */
export const CARD_SIZE = {
  PORTRAIT: {
    width: CARD_CELLS.PORTRAIT.width * GRID_UNIT,   // 110px
    height: CARD_CELLS.PORTRAIT.height * GRID_UNIT, // 165px
  },
  LANDSCAPE: {
    width: CARD_CELLS.LANDSCAPE.width * GRID_UNIT,   // 165px
    height: CARD_CELLS.LANDSCAPE.height * GRID_UNIT, // 110px
  },
} as const;

/**
 * Stack offset in grid units - when multiple cards are at the same position,
 * each subsequent card is offset by this amount to show the name of cards underneath
 * Note: Sites offset upward (names on bottom), Spells offset downward (names on top)
 */
export const STACK_OFFSET_UNITS = 10;
export const STACK_OFFSET = STACK_OFFSET_UNITS * GRID_UNIT; // 550px - very spread out for visibility

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

export interface CardLayoutInfo {
  name: string;
  position: GridPosition;
  isLandscape: boolean;
  thresholdGroup: ThresholdGroup;
  type: CardType;
  cost: number;
}

// ============================================================================
// Grid Math
// ============================================================================

/** Snap a pixel position to the nearest grid cell (top-left corner) */
export function snapToGrid(x: number, y: number): GridPosition {
  return {
    x: Math.round(x / GRID_UNIT) * GRID_UNIT,
    y: Math.round(y / GRID_UNIT) * GRID_UNIT,
  };
}

/** Convert grid coordinates to pixel position */
export function gridToPixels(gridX: number, gridY: number): GridPosition {
  return {
    x: gridX * GRID_UNIT,
    y: gridY * GRID_UNIT,
  };
}

/** Convert pixel position to grid coordinates */
export function pixelsToGrid(x: number, y: number): GridPosition {
  return {
    x: Math.floor(x / GRID_UNIT),
    y: Math.floor(y / GRID_UNIT),
  };
}

/** Get card pixel size based on orientation */
export function getCardPixelSize(isLandscape: boolean): { width: number; height: number } {
  return isLandscape ? { ...CARD_SIZE.LANDSCAPE } : { ...CARD_SIZE.PORTRAIT };
}

/** Get card cell size based on orientation */
export function getCardCellSize(isLandscape: boolean): { width: number; height: number } {
  return isLandscape ? { ...CARD_CELLS.LANDSCAPE } : { ...CARD_CELLS.PORTRAIT };
}

/**
 * Get the position to place a card centered within its grid cells
 * @param gridX - Left grid column
 * @param gridY - Top grid row
 * @param isLandscape - Whether the card is landscape
 * @returns Pixel position with card centered in its cell area
 */
export function getCardPositionInCells(
  gridX: number,
  gridY: number,
  _isLandscape: boolean
): GridPosition {
  // Card occupies cells from (gridX, gridY) to (gridX + cellWidth, gridY + cellHeight)
  // Card is drawn to fill these cells exactly
  return {
    x: gridX * GRID_UNIT,
    y: gridY * GRID_UNIT,
  };
}

/**
 * Snap a card position to align with grid cells
 * Returns the top-left position of the grid cell area the card should occupy
 */
export function snapCardToGrid(x: number, y: number, isLandscape: boolean): GridPosition {
  // Find which grid cell the center of the card is closest to
  const cardSize = getCardPixelSize(isLandscape);
  const centerX = x + cardSize.width / 2;
  const centerY = y + cardSize.height / 2;

  // Snap to grid cell that would contain this center
  const gridX = Math.round((centerX - cardSize.width / 2) / GRID_UNIT);
  const gridY = Math.round((centerY - cardSize.height / 2) / GRID_UNIT);

  return {
    x: gridX * GRID_UNIT,
    y: gridY * GRID_UNIT,
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

/**
 * Calculate card layout positions
 * Cards are positioned in grid cells with no gaps within groups
 * Gaps: 1 grid unit between types vertically, 4 grid units between elements horizontally
 */
export function calculateCardLayout(config: LayoutConfig): CardLayoutInfo[] {
  const result: CardLayoutInfo[] = [];

  const avatars = config.cards.filter((c) => c.type === 'Avatar');
  const nonAvatars = config.cards.filter((c) => c.type !== 'Avatar');

  const grouped = groupCards(nonAvatars);

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
      const cellSize = getCardCellSize(isLandscape);

      // Layout cards in rows - NO gaps between cards within a group
      for (let i = 0; i < sorted.length; i++) {
        const card = sorted[i]!;
        const col = i % cardsPerRow;
        const row = Math.floor(i / cardsPerRow);

        // Each card occupies cellSize.width x cellSize.height grid cells
        // Cards are placed directly adjacent (no gaps)
        const gridX = currentGridX + col * cellSize.width;
        const gridY = currentGridY + row * cellSize.height;

        const position = getCardPositionInCells(gridX, gridY, isLandscape);

        result.push({
          name: card.name,
          position,
          isLandscape,
          thresholdGroup: card.thresholdGroup,
          type: card.type,
          cost: card.cost,
        });

        // Track max width for this group
        const cardRight = (col + 1) * cellSize.width;
        if (cardRight > maxGroupGridWidth) {
          maxGroupGridWidth = cardRight;
        }
      }

      // Move Y down for next type subgroup
      // Add 1 grid unit gap between card types
      const rows = Math.ceil(sorted.length / cardsPerRow);
      currentGridY += rows * cellSize.height + SUBGROUP_GAP_UNITS;
    }

    // Move X right for next threshold group
    // Add 4 grid units gap between element groups
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
    const cellSize = getCardCellSize(false); // Avatars are portrait

    for (let i = 0; i < sortedAvatars.length; i++) {
      const avatar = sortedAvatars[i]!;
      const col = i % cardsPerRow;
      const row = Math.floor(i / cardsPerRow);

      const gridX = currentGridX + col * cellSize.width;
      const gridY = row * cellSize.height;

      const position = getCardPositionInCells(gridX, gridY, false);

      result.push({
        name: avatar.name,
        position,
        isLandscape: false,
        thresholdGroup: avatar.thresholdGroup,
        type: 'Avatar',
        cost: avatar.cost,
      });
    }
  }

  return result;
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
    if (!result.has(card.thresholdGroup)) {
      result.set(card.thresholdGroup, new Map());
    }

    const typeMap = result.get(card.thresholdGroup)!;
    if (!typeMap.has(card.type)) {
      typeMap.set(card.type, []);
    }

    typeMap.get(card.type)!.push(card);
  }

  return result;
}
