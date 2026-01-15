/**
 * Grid system for card layout and snapping
 *
 * Base grid unit: 400px
 * Portrait cards: 2 units wide
 * Landscape cards: 3 units wide
 */

import type { CardType, ThresholdGroup } from '@/data/dataModels';

// ============================================================================
// Constants
// ============================================================================

export const GRID_UNIT = 400;

export const CARD_DIMENSIONS = {
  PORTRAIT: { width: 744, height: 1039 },
  LANDSCAPE: { width: 1039, height: 744 },
} as const;

// Cards scale to fit grid units
export const CARD_GRID_SIZE = {
  PORTRAIT: { widthUnits: 2, heightUnits: 3 },
  LANDSCAPE: { widthUnits: 3, heightUnits: 2 },
} as const;

// Group spacing
export const GROUP_GAP_UNITS = 4;
export const SUBGROUP_GAP_UNITS = 1;

// Cards per row in each group
export const CARDS_PER_ROW = {
  SPELL: 12,
  SITE: 8,
} as const;

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

export function snapToGrid(x: number, y: number): GridPosition {
  return {
    x: Math.round(x / GRID_UNIT) * GRID_UNIT,
    y: Math.round(y / GRID_UNIT) * GRID_UNIT,
  };
}

export function gridToPixels(gridX: number, gridY: number): GridPosition {
  return {
    x: gridX * GRID_UNIT,
    y: gridY * GRID_UNIT,
  };
}

export function pixelsToGrid(x: number, y: number): GridPosition {
  return {
    x: Math.floor(x / GRID_UNIT),
    y: Math.floor(y / GRID_UNIT),
  };
}

export function getCardPixelSize(isLandscape: boolean): { width: number; height: number } {
  const gridSize = isLandscape ? CARD_GRID_SIZE.LANDSCAPE : CARD_GRID_SIZE.PORTRAIT;
  return {
    width: gridSize.widthUnits * GRID_UNIT,
    height: gridSize.heightUnits * GRID_UNIT,
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
  }>;
}

export function calculateCardLayout(config: LayoutConfig): CardLayoutInfo[] {
  const result: CardLayoutInfo[] = [];

  // Separate avatars (they go in their own group)
  const avatars = config.cards.filter((c) => c.type === 'Avatar');
  const nonAvatars = config.cards.filter((c) => c.type !== 'Avatar');

  // Group cards by threshold, then by type, then sort by cost
  const grouped = groupCards(nonAvatars);

  let currentX = 0;

  // Layout each threshold group
  for (const thresholdGroup of THRESHOLD_GROUP_ORDER) {
    const thresholdCards = grouped.get(thresholdGroup);
    if (!thresholdCards || thresholdCards.size === 0) continue;

    let maxGroupWidth = 0;
    let currentY = 0;

    // Layout each type subgroup within the threshold group
    for (const type of TYPE_ORDER) {
      const typeCards = thresholdCards.get(type);
      if (!typeCards || typeCards.length === 0) continue;

      // Sort by cost
      const sorted = [...typeCards].sort((a, b) => a.cost - b.cost);
      const isLandscape = type === 'Site';
      const cardsPerRow = isLandscape ? CARDS_PER_ROW.SITE : CARDS_PER_ROW.SPELL;
      const cardGridSize = isLandscape ? CARD_GRID_SIZE.LANDSCAPE : CARD_GRID_SIZE.PORTRAIT;

      // Layout cards in rows
      for (let i = 0; i < sorted.length; i++) {
        const card = sorted[i]!;
        const col = i % cardsPerRow;
        const row = Math.floor(i / cardsPerRow);

        const position: GridPosition = {
          x: (currentX + col * cardGridSize.widthUnits) * GRID_UNIT,
          y: (currentY + row * cardGridSize.heightUnits) * GRID_UNIT,
        };

        result.push({
          name: card.name,
          position,
          isLandscape,
          thresholdGroup: card.thresholdGroup,
          type: card.type,
          cost: card.cost,
        });

        // Track max width for this group
        const cardRight = col * cardGridSize.widthUnits + cardGridSize.widthUnits;
        if (cardRight > maxGroupWidth) {
          maxGroupWidth = cardRight;
        }
      }

      // Move Y down for next subgroup
      const rows = Math.ceil(sorted.length / cardsPerRow);
      currentY += rows * cardGridSize.heightUnits + SUBGROUP_GAP_UNITS;
    }

    // Move X right for next threshold group
    currentX += maxGroupWidth + GROUP_GAP_UNITS;
  }

  // Layout avatars in their own group
  if (avatars.length > 0) {
    let avatarY = 0;
    for (const avatar of avatars) {
      result.push({
        name: avatar.name,
        position: { x: currentX * GRID_UNIT, y: avatarY },
        isLandscape: false,
        thresholdGroup: avatar.thresholdGroup,
        type: 'Avatar',
        cost: avatar.cost,
      });
      avatarY += CARD_GRID_SIZE.PORTRAIT.heightUnits * GRID_UNIT;
    }
  }

  return result;
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
