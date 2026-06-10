/**
 * Grid system for card layout and snapping
 *
 * Three overlapping grids:
 * 1. DRAWN GRID: 55×55px - visual grid lines (can be changed independently)
 * 2. PORTRAIT SNAP GRID: Same spacing, offset so portrait cards sit centered
 *    inside a 2×3 block of drawn grid cells
 * 3. LANDSCAPE SNAP GRID: Same spacing, offset so site cards sit centered
 *    inside a 3×2 block of drawn grid cells
 *
 * Cards are always drawn from their CENTER point at grid intersections.
 * This allows the drawn grid to be changed (even non-square) without affecting snapping.
 */

import type { CardType, ThresholdGroup, CardRarity } from "@/data/dataModels";

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
 * Snap grid offsets from drawn grid origin.
 * These are the repeated center positions for the visible 2×3 portrait and
 * 3×2 landscape card blocks.
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

/**
 * Deck avatar display size (larger than standard portrait cards).
 * Height is fixed to 4 snap-grid units.
 */
export const DECK_AVATAR_SIZE = {
  height: SNAP_GRID.height * 4,
  width: Math.round(
    (CARD_SIZE.PORTRAIT.width / CARD_SIZE.PORTRAIT.height) *
      SNAP_GRID.height *
      4,
  ),
} as const;

/** Card spacing in snap grid cells (how many cells between card centers) */
export const CARD_CELL_SPACING = {
  PORTRAIT: { x: 2, y: 3 }, // Centers are 2 cells apart horizontally, 3 vertically
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
  ALPHA: 0.45,
  WIDTH: 1,
} as const;

/** Group spacing in grid units */
export const GROUP_GAP_UNITS = 4; // 4 empty grids between element groups horizontally
export const SUBGROUP_GAP_UNITS = 3; // 3 empty grids between card types vertically (room for type label)

/** Cards per row in each group */
export const CARDS_PER_ROW = {
  SPELL: 12,
  SITE: 8,
  AVATAR: 12,
} as const;

/** Avatar set order (for sorting) */
export const AVATAR_SET_ORDER = [
  "Alpha",
  "Beta",
  "Arthurian Legends",
  "Dragonlord",
  "Gothic",
  "Promotional",
] as const;

/** Rarity order for sorting (None/precon first, then by rarity) */
export const RARITY_ORDER: Record<string, number> = {
  None: 0,
  Ordinary: 1,
  Exceptional: 2,
  Elite: 3,
  Unique: 4,
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
  cost: number | null;
}

// ============================================================================
// Grid Math - Snap Grid Operations
// ============================================================================

/**
 * Get the snap grid offset for a card type
 */
export function getSnapGridOffset(isLandscape: boolean): GridPosition {
  return isLandscape
    ? { ...SNAP_GRID_OFFSET.LANDSCAPE }
    : { ...SNAP_GRID_OFFSET.PORTRAIT };
}

/**
 * Convert snap grid coordinates to pixel position (card CENTER)
 * @param gridX - Snap grid column
 * @param gridY - Snap grid row
 * @param isLandscape - Whether the card is landscape
 * @returns Pixel position of the card CENTER
 */
export function snapGridToPixels(
  gridX: number,
  gridY: number,
  isLandscape: boolean,
): GridPosition {
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
export function pixelsToSnapGrid(
  x: number,
  y: number,
  isLandscape: boolean,
): GridPosition {
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
export function snapCardCenter(
  centerX: number,
  centerY: number,
  isLandscape: boolean,
): GridPosition {
  const gridPos = pixelsToSnapGrid(centerX, centerY, isLandscape);
  return snapGridToPixels(gridPos.x, gridPos.y, isLandscape);
}

/**
 * Snap a card position (given as top-left) to the nearest snap grid intersection
 * Returns the new top-left position after snapping the center
 */
export function snapCardToGrid(
  x: number,
  y: number,
  isLandscape: boolean,
): GridPosition {
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
export function getCardPixelSize(isLandscape: boolean): {
  width: number;
  height: number;
} {
  return isLandscape ? { ...CARD_SIZE.LANDSCAPE } : { ...CARD_SIZE.PORTRAIT };
}

/** Get card cell spacing based on orientation */
export function getCardCellSpacing(isLandscape: boolean): {
  x: number;
  y: number;
} {
  return isLandscape
    ? { ...CARD_CELL_SPACING.LANDSCAPE }
    : { ...CARD_CELL_SPACING.PORTRAIT };
}

/**
 * Get the CENTER position for a card at a given grid cell
 * @param cellX - Cell column (in card spacing units, not raw grid)
 * @param cellY - Cell row (in card spacing units, not raw grid)
 * @param isLandscape - Whether the card is landscape
 * @returns Pixel position of the card CENTER
 */
export function getCardCenterPosition(
  cellX: number,
  cellY: number,
  isLandscape: boolean,
): GridPosition {
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
export function getCardCellSize(isLandscape: boolean): {
  width: number;
  height: number;
} {
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
  "air",
  "earth",
  "fire",
  "water",
  "none",
  "multiple",
];

const TYPE_ORDER: CardType[] = ["Minion", "Magic", "Aura", "Artifact", "Site"];
const SHELF_TYPE_ROW_ORDER: CardType[] = [
  "Avatar",
  "Minion",
  "Magic",
  "Artifact",
  "Aura",
  "Site",
];

const TYPE_LABELS: Record<CardType, string> = {
  Avatar: "Avatars",
  Minion: "Minions",
  Magic: "Magic",
  Aura: "Auras",
  Artifact: "Artifacts",
  Site: "Sites",
};

export type CollectionLayoutVariant = "wide" | "portrait";

export interface LayoutCardInput {
  name: string;
  type: CardType;
  thresholdGroup: ThresholdGroup;
  cost: number | null;
  isLandscape: boolean;
  primarySet?: string;
  rarity?: CardRarity | null;
}

export interface LayoutConfig {
  cards: LayoutCardInput[];
  mode?: "grouped" | "filteredFlat" | "preserveFlat" | "typeRows";
  layoutVariant?: CollectionLayoutVariant;
}

export interface ContentBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type HeaderKind =
  | "collection"
  | "deck-name"
  | "deck-author"
  | "deck-board"
  | "type-subgroup";

export interface GroupHeader {
  label: string;
  /** Pixel position for the header text (left edge, above the group) */
  position: GridPosition;
  kind: HeaderKind;
}

export interface LayoutResult {
  cards: CardLayoutInfo[];
  headers: GroupHeader[];
  bounds: ContentBounds;
}

/**
 * Calculate card layout positions (returns CENTER positions)
 * Cards are positioned on their snap grid with proper spacing
 */
const THRESHOLD_GROUP_LABELS: Record<ThresholdGroup, string> = {
  air: "Air",
  earth: "Earth",
  fire: "Fire",
  water: "Water",
  none: "None",
  multiple: "Multi",
};

/** Header text height in pixels (~1 card tall) */
export const HEADER_HEIGHT = 3 * DRAWN_GRID.height;

/** Gap between bottom of header text and top of first card */
const HEADER_GAP = DRAWN_GRID.height;

const PROVIDER_THRESHOLD_OVERRIDES: Readonly<Record<string, ThresholdGroup>> = {
  "Castle Servants": "air",
  "Common Cottagers": "earth",
  "Blacksmith Family": "fire",
  "Fisherman's Family": "water",
};

const PORTRAIT_ELEMENT_GROUPS: ThresholdGroup[] = [
  "air",
  "earth",
  "fire",
  "water",
];

const PORTRAIT_COLUMN_GAP_UNITS = GROUP_GAP_UNITS;
const PORTRAIT_SECTION_GAP_UNITS = GROUP_GAP_UNITS + 3;
const PORTRAIT_MIN_COLUMN_WIDTH_UNITS = 8;
const PORTRAIT_MIN_SECTION_WIDTH_UNITS = 28;

type BoundsUpdater = (
  centerX: number,
  centerY: number,
  isLandscape: boolean,
) => void;

type GroupedCards = Map<ThresholdGroup, Map<CardType, LayoutCardInput[]>>;

interface CardSubgroup {
  type: CardType;
  cards: LayoutCardInput[];
  label?: string;
  showHeader?: boolean;
}

interface ColumnSplit {
  leftWidthUnits: number;
  rightWidthUnits: number;
}

export function calculateCardLayout(config: LayoutConfig): LayoutResult {
  const cards: CardLayoutInfo[] = [];
  const headers: GroupHeader[] = [];

  // Track content bounds
  let contentLeft = Infinity;
  let contentTop = Infinity;
  let contentRight = -Infinity;
  let contentBottom = -Infinity;

  const updateBounds = (
    centerX: number,
    centerY: number,
    isLandscape: boolean,
  ) => {
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

  if (config.mode === "typeRows") {
    const rowCards = layoutTypeRowsCards(config.cards, updateBounds);
    const bounds: ContentBounds = {
      left: contentLeft === Infinity ? 0 : contentLeft,
      top: contentTop === Infinity ? 0 : contentTop,
      right: contentRight === -Infinity ? 0 : contentRight,
      bottom: contentBottom === -Infinity ? 0 : contentBottom,
    };
    return { cards: rowCards, headers: [], bounds };
  }

  if (config.mode === "filteredFlat" || config.mode === "preserveFlat") {
    const flatCards = layoutFilteredCards(
      config.cards,
      updateBounds,
      config.mode === "preserveFlat",
    );
    const bounds: ContentBounds = {
      left: contentLeft === Infinity ? 0 : contentLeft,
      top: contentTop === Infinity ? 0 : contentTop,
      right: contentRight === -Infinity ? 0 : contentRight,
      bottom: contentBottom === -Infinity ? 0 : contentBottom,
    };
    return { cards: flatCards, headers: [], bounds };
  }

  const avatars = config.cards.filter((c) => c.type === "Avatar");
  const nonAvatars = config.cards.filter((c) => c.type !== "Avatar");

  // Layout avatars as a single row above all other cards
  let nonAvatarStartGridY = 0;
  let avatarGridWidthUnits = 0;

  if (avatars.length > 0) {
    // Avatar group header
    const avatarFirstPos = snapGridToPixels(0, 0, false);
    headers.push({
      label: "Avatars",
      position: {
        x: avatarFirstPos.x - CARD_SIZE.PORTRAIT.width / 2,
        y:
          avatarFirstPos.y -
          CARD_SIZE.PORTRAIT.height / 2 -
          HEADER_GAP -
          HEADER_HEIGHT,
      },
      kind: "collection",
    });

    const sortedAvatars = [...avatars].sort((a, b) => {
      const aSetIndex = getAvatarSetIndex(a.primarySet);
      const bSetIndex = getAvatarSetIndex(b.primarySet);

      if (aSetIndex !== bSetIndex) {
        return aSetIndex - bSetIndex;
      }

      const aRarityIndex = RARITY_ORDER[a.rarity ?? "None"] ?? 0;
      const bRarityIndex = RARITY_ORDER[b.rarity ?? "None"] ?? 0;

      return aRarityIndex - bRarityIndex;
    });

    const spacing = getCardCellSpacing(false); // Avatars are portrait
    avatarGridWidthUnits =
      (sortedAvatars.length - 1) * spacing.x + spacing.x;

    for (const [i, avatar] of sortedAvatars.entries()) {
      const gridX = i * spacing.x;
      const gridY = 0;

      const position = snapGridToPixels(gridX, gridY, false);

      cards.push({
        name: avatar.name,
        position,
        isLandscape: false,
        thresholdGroup: avatar.thresholdGroup,
        type: "Avatar",
        cost: avatar.cost,
      });

      updateBounds(position.x, position.y, false);
    }

    // Non-avatar cards start below the avatar row (extra gap for threshold heading)
    nonAvatarStartGridY = spacing.y + GROUP_GAP_UNITS + 4;
  }

  // Layout non-avatar cards below avatars
  const grouped = groupCards(applyGroupedCollectionRules(nonAvatars));

  if ((config.layoutVariant ?? "wide") === "portrait") {
    layoutPortraitGroupedCards({
      grouped,
      cards,
      headers,
      updateBounds,
      startGridY: nonAvatarStartGridY,
      sectionWidthUnits: Math.max(
        PORTRAIT_MIN_SECTION_WIDTH_UNITS,
        avatarGridWidthUnits,
      ),
    });
  } else {
    layoutWideGroupedCards({
      grouped,
      cards,
      headers,
      updateBounds,
      startGridY: nonAvatarStartGridY,
    });
  }

  // Default bounds if no cards
  const bounds: ContentBounds = {
    left: contentLeft === Infinity ? 0 : contentLeft,
    top: contentTop === Infinity ? 0 : contentTop,
    right: contentRight === -Infinity ? 0 : contentRight,
    bottom: contentBottom === -Infinity ? 0 : contentBottom,
  };

  return { cards, headers, bounds };
}

function layoutWideGroupedCards({
  grouped,
  cards,
  headers,
  updateBounds,
  startGridY,
}: {
  grouped: GroupedCards;
  cards: CardLayoutInfo[];
  headers: GroupHeader[];
  updateBounds: BoundsUpdater;
  startGridY: number;
}): void {
  let currentGridX = 0;

  for (const thresholdGroup of THRESHOLD_GROUP_ORDER) {
    const thresholdCards = grouped.get(thresholdGroup);
    if (!thresholdCards || thresholdCards.size === 0) continue;

    addCollectionHeader(
      THRESHOLD_GROUP_LABELS[thresholdGroup],
      currentGridX,
      startGridY,
      headers,
    );

    let maxGroupGridWidth = 0;
    let currentGridY = startGridY + 2;

    for (const type of TYPE_ORDER) {
      const typeCards = thresholdCards.get(type);
      if (!typeCards || typeCards.length === 0) continue;

      const sorted = [...typeCards].sort(compareLayoutCards);
      const isLandscape = type === "Site";
      const cardsPerRow = isLandscape
        ? CARDS_PER_ROW.SITE
        : CARDS_PER_ROW.SPELL;
      const spacing = getCardCellSpacing(isLandscape);

      addTypeSubgroupHeader(
        TYPE_LABELS[type],
        currentGridX,
        currentGridY,
        isLandscape,
        headers,
      );

      for (const [i, card] of sorted.entries()) {
        const col = i % cardsPerRow;
        const row = Math.floor(i / cardsPerRow);

        const gridX = currentGridX + col * spacing.x;
        const gridY = currentGridY + row * spacing.y;

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

        const cardRight = (col + 1) * spacing.x;
        if (cardRight > maxGroupGridWidth) {
          maxGroupGridWidth = cardRight;
        }
      }

      const rows = Math.ceil(sorted.length / cardsPerRow);
      currentGridY += rows * spacing.y + SUBGROUP_GAP_UNITS;
    }

    currentGridX += maxGroupGridWidth + GROUP_GAP_UNITS;
  }
}

function layoutPortraitGroupedCards({
  grouped,
  cards,
  headers,
  updateBounds,
  startGridY,
  sectionWidthUnits,
}: {
  grouped: GroupedCards;
  cards: CardLayoutInfo[];
  headers: GroupHeader[];
  updateBounds: BoundsUpdater;
  startGridY: number;
  sectionWidthUnits: number;
}): void {
  let currentGridY = startGridY;

  for (const thresholdGroup of PORTRAIT_ELEMENT_GROUPS) {
    const thresholdCards = grouped.get(thresholdGroup);
    if (!thresholdCards || thresholdCards.size === 0) continue;

    const leftGroups = [createCardSubgroup(thresholdCards, "Minion")].filter(
      (group): group is CardSubgroup => group !== null,
    );
    const rightGroups = (["Magic", "Aura", "Site"] as const)
      .map((type) => createCardSubgroup(thresholdCards, type))
      .filter((group): group is CardSubgroup => group !== null);

    if (leftGroups.length === 0 && rightGroups.length === 0) continue;

    addCollectionHeader(
      THRESHOLD_GROUP_LABELS[thresholdGroup],
      0,
      currentGridY,
      headers,
    );

    const split = chooseTwoColumnSplit(
      leftGroups,
      rightGroups,
      sectionWidthUnits,
    );
    const cardStartGridY = currentGridY + 2;
    const rightStartGridX =
      split.leftWidthUnits + PORTRAIT_COLUMN_GAP_UNITS;
    const leftBottomGridY = layoutColumnSubgroups({
      subgroups: leftGroups,
      startGridX: 0,
      startGridY: cardStartGridY,
      widthUnits: split.leftWidthUnits,
      cards,
      headers,
      updateBounds,
    });
    const rightBottomGridY = layoutColumnSubgroups({
      subgroups: rightGroups,
      startGridX: rightStartGridX,
      startGridY: cardStartGridY,
      widthUnits: split.rightWidthUnits,
      cards,
      headers,
      updateBounds,
    });

    currentGridY =
      Math.max(leftBottomGridY, rightBottomGridY, cardStartGridY) +
      PORTRAIT_SECTION_GAP_UNITS;
  }

  layoutPortraitArtifactsAndMultiNone({
    grouped,
    cards,
    headers,
    updateBounds,
    startGridY: currentGridY,
    sectionWidthUnits,
  });
}

function layoutFilteredCards(
  inputCards: LayoutConfig["cards"],
  updateBounds: (
    centerX: number,
    centerY: number,
    isLandscape: boolean,
  ) => void,
  preserveOrder = false,
): CardLayoutInfo[] {
  const flatCards: CardLayoutInfo[] = [];
  const byCostThenName = (
    a: LayoutConfig["cards"][number],
    b: LayoutConfig["cards"][number],
  ) => {
    return compareLayoutCards(a, b);
  };

  const portraitCards = [...inputCards.filter((c) => c.type !== "Site")];
  const siteCards = [...inputCards.filter((c) => c.type === "Site")];
  if (!preserveOrder) {
    portraitCards.sort(byCostThenName);
    siteCards.sort(byCostThenName);
  }

  const portraitSpacing = getCardCellSpacing(false);
  const siteSpacing = getCardCellSpacing(true);
  const portraitStartGridX = 0;
  const siteStartGridX =
    portraitCards.length > 0
      ? CARDS_PER_ROW.SPELL * portraitSpacing.x + GROUP_GAP_UNITS
      : 0;

  for (const [index, card] of portraitCards.entries()) {
    const col = index % CARDS_PER_ROW.SPELL;
    const row = Math.floor(index / CARDS_PER_ROW.SPELL);
    const gridX = portraitStartGridX + col * portraitSpacing.x;
    const gridY = row * portraitSpacing.y;
    const position = snapGridToPixels(gridX, gridY, false);
    flatCards.push({
      name: card.name,
      position,
      isLandscape: false,
      thresholdGroup: card.thresholdGroup,
      type: card.type,
      cost: card.cost,
    });
    updateBounds(position.x, position.y, false);
  }

  for (const [index, card] of siteCards.entries()) {
    const col = index % CARDS_PER_ROW.SITE;
    const row = Math.floor(index / CARDS_PER_ROW.SITE);
    const gridX = siteStartGridX + col * siteSpacing.x;
    const gridY = row * siteSpacing.y;
    const position = snapGridToPixels(gridX, gridY, true);
    flatCards.push({
      name: card.name,
      position,
      isLandscape: true,
      thresholdGroup: card.thresholdGroup,
      type: card.type,
      cost: card.cost,
    });
    updateBounds(position.x, position.y, true);
  }

  return flatCards;
}

function layoutTypeRowsCards(
  inputCards: LayoutConfig["cards"],
  updateBounds: BoundsUpdater,
): CardLayoutInfo[] {
  const rowCards: CardLayoutInfo[] = [];
  let currentGridY = 0;

  for (const type of SHELF_TYPE_ROW_ORDER) {
    const typeCards = inputCards.filter((card) => card.type === type);
    if (typeCards.length === 0) continue;

    const isLandscape = type === "Site";
    const cardsPerRow = isLandscape
      ? CARDS_PER_ROW.SITE
      : CARDS_PER_ROW.SPELL;
    const spacing = getCardCellSpacing(isLandscape);

    for (const [index, card] of typeCards.entries()) {
      const col = index % cardsPerRow;
      const row = Math.floor(index / cardsPerRow);
      const gridX = col * spacing.x;
      const gridY = currentGridY + row * spacing.y;
      const position = snapGridToPixels(gridX, gridY, isLandscape);

      rowCards.push({
        name: card.name,
        position,
        isLandscape,
        thresholdGroup: card.thresholdGroup,
        type: card.type,
        cost: card.cost,
      });

      updateBounds(position.x, position.y, isLandscape);
    }

    currentGridY += Math.ceil(typeCards.length / cardsPerRow) * spacing.y;
  }

  return rowCards;
}

function layoutPortraitArtifactsAndMultiNone({
  grouped,
  cards,
  headers,
  updateBounds,
  startGridY,
  sectionWidthUnits,
}: {
  grouped: GroupedCards;
  cards: CardLayoutInfo[];
  headers: GroupHeader[];
  updateBounds: BoundsUpdater;
  startGridY: number;
  sectionWidthUnits: number;
}): void {
  const noneCards = grouped.get("none");
  const multiCards = grouped.get("multiple");
  const artifacts = noneCards?.get("Artifact") ?? [];
  const leftGroups: CardSubgroup[] =
    artifacts.length > 0
      ? [
          {
            type: "Artifact",
            cards: artifacts,
            label: "Artifacts",
            showHeader: false,
          },
        ]
      : [];
  const rightGroups = [
    multiCards ? createCardSubgroup(multiCards, "Minion") : null,
    multiCards ? createCardSubgroup(multiCards, "Magic") : null,
    multiCards ? createCardSubgroup(multiCards, "Aura") : null,
    multiCards ? createCardSubgroup(multiCards, "Site") : null,
    createCardSubgroup(noneCards, "Site", "None Sites"),
  ].filter((group): group is CardSubgroup => group !== null);

  if (leftGroups.length === 0 && rightGroups.length === 0) return;

  const split = chooseTwoColumnSplit(leftGroups, rightGroups, sectionWidthUnits);
  const rightStartGridX = split.leftWidthUnits + PORTRAIT_COLUMN_GAP_UNITS;

  if (leftGroups.length > 0) {
    addCollectionHeader("Artifacts", 0, startGridY, headers);
  }
  if (rightGroups.length > 0) {
    addCollectionHeader("Multi / None", rightStartGridX, startGridY, headers);
  }

  const cardStartGridY = startGridY + 2;
  layoutColumnSubgroups({
    subgroups: leftGroups,
    startGridX: 0,
    startGridY: cardStartGridY,
    widthUnits: split.leftWidthUnits,
    cards,
    headers,
    updateBounds,
  });
  layoutColumnSubgroups({
    subgroups: rightGroups,
    startGridX: rightStartGridX,
    startGridY: cardStartGridY,
    widthUnits: split.rightWidthUnits,
    cards,
    headers,
    updateBounds,
  });
}

function addCollectionHeader(
  label: string,
  gridX: number,
  gridY: number,
  headers: GroupHeader[],
): void {
  const headerPos = snapGridToPixels(gridX, gridY, false);
  headers.push({
    label,
    position: {
      x: headerPos.x - CARD_SIZE.PORTRAIT.width / 2,
      y:
        headerPos.y -
        CARD_SIZE.PORTRAIT.height / 2 -
        HEADER_GAP -
        HEADER_HEIGHT,
    },
    kind: "collection",
  });
}

function addTypeSubgroupHeader(
  label: string,
  gridX: number,
  gridY: number,
  isLandscape: boolean,
  headers: GroupHeader[],
): void {
  const typeFontSize = HEADER_HEIGHT * 0.3;
  const typeHeaderGap = typeFontSize * 0.4;
  const typeHeaderPos = snapGridToPixels(gridX, gridY, isLandscape);
  const cardSize = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;

  headers.push({
    label,
    kind: "type-subgroup",
    position: {
      x: typeHeaderPos.x - cardSize.width / 2,
      y:
        typeHeaderPos.y -
        cardSize.height / 2 -
        typeHeaderGap -
        typeFontSize,
    },
  });
}

function layoutColumnSubgroups({
  subgroups,
  startGridX,
  startGridY,
  widthUnits,
  cards,
  headers,
  updateBounds,
}: {
  subgroups: CardSubgroup[];
  startGridX: number;
  startGridY: number;
  widthUnits: number;
  cards: CardLayoutInfo[];
  headers: GroupHeader[];
  updateBounds: BoundsUpdater;
}): number {
  let currentGridY = startGridY;
  let placedAny = false;

  for (const subgroup of subgroups) {
    if (subgroup.cards.length === 0) continue;

    const isLandscape = subgroup.type === "Site";
    const cardsPerRow = getCardsPerRowForWidth(subgroup.type, widthUnits);
    const spacing = getCardCellSpacing(isLandscape);

    if (subgroup.showHeader !== false) {
      addTypeSubgroupHeader(
        subgroup.label ?? TYPE_LABELS[subgroup.type],
        startGridX,
        currentGridY,
        isLandscape,
        headers,
      );
    }

    const sorted = [...subgroup.cards].sort(compareLayoutCards);
    for (const [index, card] of sorted.entries()) {
      const col = index % cardsPerRow;
      const row = Math.floor(index / cardsPerRow);
      const gridX = startGridX + col * spacing.x;
      const gridY = currentGridY + row * spacing.y;
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
    }

    currentGridY +=
      Math.ceil(sorted.length / cardsPerRow) * spacing.y + SUBGROUP_GAP_UNITS;
    placedAny = true;
  }

  return placedAny ? currentGridY - SUBGROUP_GAP_UNITS : startGridY;
}

function chooseTwoColumnSplit(
  leftGroups: CardSubgroup[],
  rightGroups: CardSubgroup[],
  requestedWidthUnits: number,
): ColumnSplit {
  const totalWidthUnits = Math.max(
    Math.round(requestedWidthUnits),
    PORTRAIT_MIN_COLUMN_WIDTH_UNITS * 2 + PORTRAIT_COLUMN_GAP_UNITS,
  );
  const maxLeftWidth =
    totalWidthUnits -
    PORTRAIT_COLUMN_GAP_UNITS -
    PORTRAIT_MIN_COLUMN_WIDTH_UNITS;
  let best: ColumnSplit | null = null;
  let bestScore: [number, number] | null = null;

  for (
    let leftWidth = PORTRAIT_MIN_COLUMN_WIDTH_UNITS;
    leftWidth <= maxLeftWidth;
    leftWidth += 1
  ) {
    const rightWidth =
      totalWidthUnits - PORTRAIT_COLUMN_GAP_UNITS - leftWidth;
    const leftHeight = measureColumnHeightUnits(leftGroups, leftWidth);
    const rightHeight = measureColumnHeightUnits(rightGroups, rightWidth);
    const score: [number, number] = [
      Math.abs(leftHeight - rightHeight),
      Math.abs(leftWidth - rightWidth),
    ];

    if (
      !bestScore ||
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] && score[1] < bestScore[1])
    ) {
      bestScore = score;
      best = { leftWidthUnits: leftWidth, rightWidthUnits: rightWidth };
    }
  }

  return (
    best ?? {
      leftWidthUnits: PORTRAIT_MIN_COLUMN_WIDTH_UNITS,
      rightWidthUnits: PORTRAIT_MIN_COLUMN_WIDTH_UNITS,
    }
  );
}

function measureColumnHeightUnits(
  subgroups: CardSubgroup[],
  widthUnits: number,
): number {
  let height = 0;
  let placedAny = false;

  for (const subgroup of subgroups) {
    if (subgroup.cards.length === 0) continue;

    if (placedAny) height += SUBGROUP_GAP_UNITS;

    const isLandscape = subgroup.type === "Site";
    const spacing = getCardCellSpacing(isLandscape);
    const rows = Math.ceil(
      subgroup.cards.length / getCardsPerRowForWidth(subgroup.type, widthUnits),
    );
    height += rows * spacing.y;
    placedAny = true;
  }

  return height;
}

function getCardsPerRowForWidth(type: CardType, widthUnits: number): number {
  const spacing = getCardCellSpacing(type === "Site");
  return Math.max(1, Math.floor(widthUnits / spacing.x));
}

function createCardSubgroup(
  thresholdCards: Map<CardType, LayoutCardInput[]> | undefined,
  type: CardType,
  label?: string,
): CardSubgroup | null {
  const cards = thresholdCards?.get(type);
  if (!cards || cards.length === 0) return null;

  return {
    type,
    cards,
    label,
  };
}

function applyGroupedCollectionRules(
  inputCards: LayoutCardInput[],
): LayoutCardInput[] {
  const result: LayoutCardInput[] = [];

  for (const card of inputCards) {
    const overrideThresholdGroup = PROVIDER_THRESHOLD_OVERRIDES[card.name];
    const thresholdGroup = overrideThresholdGroup ?? card.thresholdGroup;

    if (
      thresholdGroup === "none" &&
      card.type === "Minion" &&
      card.cost === null
    ) {
      continue;
    }

    result.push(
      thresholdGroup === card.thresholdGroup
        ? card
        : {
            ...card,
            thresholdGroup,
          },
    );
  }

  return result;
}

function compareLayoutCards(
  a: LayoutCardInput,
  b: LayoutCardInput,
): number {
  const costDifference = getCostSortValue(a.cost) - getCostSortValue(b.cost);
  if (costDifference !== 0) return costDifference;
  return a.name.localeCompare(b.name);
}

function getCostSortValue(cost: number | null): number {
  return typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
}

function getAvatarSetIndex(setName?: string): number {
  if (!setName) return AVATAR_SET_ORDER.length;
  const index = AVATAR_SET_ORDER.indexOf(
    setName as (typeof AVATAR_SET_ORDER)[number],
  );
  return index >= 0 ? index : AVATAR_SET_ORDER.length;
}

function groupCards(
  cards: LayoutCardInput[],
): GroupedCards {
  const result: GroupedCards = new Map();

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

// ============================================================================
// Deck Layout Calculation
// ============================================================================

export interface DeckCardLayoutInfo extends CardLayoutInfo {
  quantity: number;
  board: "avatar" | "mainboard" | "sideboard" | "maybeboard";
}

export interface DeckLayoutResult {
  cards: DeckCardLayoutInfo[];
  headers: GroupHeader[];
  bounds: ContentBounds;
}

export interface DeckLayoutConfig {
  deck: {
    name: string;
    author?: string;
    boards: {
      mainboard: Array<{ name: string; quantity: number }>;
      sideboard: Array<{ name: string; quantity: number }>;
      avatar: Array<{ name: string; quantity: number }>;
      maybeboard: Array<{ name: string; quantity: number }>;
    };
  };
  cardLookup: Map<
    string,
    {
      type: CardType;
      cost: number;
      isLandscape: boolean;
      thresholdGroup: ThresholdGroup;
    }
  >;
  collectionBottom: number;
}

export function calculateDeckLayout(
  config: DeckLayoutConfig,
): DeckLayoutResult {
  const { deck, cardLookup, collectionBottom } = config;
  const cards: DeckCardLayoutInfo[] = [];
  const headers: GroupHeader[] = [];

  let contentLeft = Infinity;
  let contentTop = Infinity;
  let contentRight = -Infinity;
  let contentBottom = -Infinity;

  const updateBounds = (
    cx: number,
    cy: number,
    isLandscape: boolean,
    sizeOverride?: { width: number; height: number },
  ) => {
    const s =
      sizeOverride ?? (isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT);
    contentLeft = Math.min(contentLeft, cx - s.width / 2);
    contentTop = Math.min(contentTop, cy - s.height / 2);
    contentRight = Math.max(contentRight, cx + s.width / 2);
    contentBottom = Math.max(contentBottom, cy + s.height / 2);
  };

  const getInfo = (name: string) =>
    cardLookup.get(name) ?? {
      type: "Minion" as CardType,
      cost: 0,
      isLandscape: false,
      thresholdGroup: "none" as ThresholdGroup,
    };

  // Helper: lay out cards grouped by type
  const layoutByType = (
    deckCards: Array<{ name: string; quantity: number }>,
    board: DeckCardLayoutInfo["board"],
    baseGridX: number,
    baseGridY: number,
  ): { endGridY: number; maxGridX: number } => {
    let currentY = baseGridY;
    let maxX = 0;

    const byType = new Map<
      CardType,
      Array<{
        name: string;
        quantity: number;
        cost: number;
        isLandscape: boolean;
        thresholdGroup: ThresholdGroup;
      }>
    >();
    for (const dc of deckCards) {
      const info = getInfo(dc.name);
      const list = byType.get(info.type) ?? [];
      list.push({ name: dc.name, quantity: dc.quantity, ...info });
      byType.set(info.type, list);
    }

    const deckTypeFontSize = HEADER_HEIGHT * 0.3;
    const deckTypeHeaderGap = deckTypeFontSize * 0.4;

    for (const type of TYPE_ORDER) {
      const typeCards = byType.get(type);
      if (!typeCards?.length) continue;

      const sorted = [...typeCards].sort((a, b) => a.cost - b.cost);
      const isLand = type === "Site";
      const perRow = isLand ? CARDS_PER_ROW.SITE : CARDS_PER_ROW.SPELL;
      const sp = getCardCellSpacing(isLand);

      // Type subgroup header
      const typeHPos = snapGridToPixels(baseGridX, currentY, isLand);
      const cs = isLand ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      headers.push({
        label: TYPE_LABELS[type],
        kind: "type-subgroup",
        position: {
          x: typeHPos.x - cs.width / 2,
          y: typeHPos.y - cs.height / 2 - deckTypeHeaderGap - deckTypeFontSize,
        },
      });

      for (const [i, c] of sorted.entries()) {
        const col = i % perRow;
        const row = Math.floor(i / perRow);
        const gx = baseGridX + col * sp.x;
        const gy = currentY + row * sp.y;
        const pos = snapGridToPixels(gx, gy, isLand);

        cards.push({
          name: c.name,
          position: pos,
          isLandscape: isLand,
          thresholdGroup: c.thresholdGroup,
          type,
          cost: c.cost,
          quantity: c.quantity,
          board,
        });
        updateBounds(pos.x, pos.y, isLand);
        maxX = Math.max(maxX, baseGridX + (col + 1) * sp.x);
      }

      currentY += Math.ceil(sorted.length / perRow) * sp.y + SUBGROUP_GAP_UNITS;
    }

    return { endGridY: currentY, maxGridX: maxX };
  };

  // Compute start gridY so the avatar/deck-name row clears collectionBottom + gap
  const deckGapPx = GROUP_GAP_UNITS * 2 * DRAWN_GRID.height;
  const startGridY = Math.ceil(
    (collectionBottom +
      deckGapPx +
      CARD_SIZE.PORTRAIT.height / 2 -
      SNAP_GRID_OFFSET.PORTRAIT.y) /
      SNAP_GRID.height,
  );

  // === Avatar + Deck Name Row ===
  // Avatar card on the left, deck name + author text to its right
  const hasDeckAvatar = deck.boards.avatar.length > 0;
  const deckTitleCardSize = hasDeckAvatar
    ? DECK_AVATAR_SIZE
    : CARD_SIZE.PORTRAIT;
  const avatarSpacingX = Math.max(
    CARD_CELL_SPACING.PORTRAIT.x,
    Math.ceil(DECK_AVATAR_SIZE.width / SNAP_GRID.width),
  );
  const avatarRowHeightUnits = hasDeckAvatar ? 4 : CARD_CELL_SPACING.PORTRAIT.y;
  const avatarPos = snapGridToPixels(0, startGridY, false);
  const avatarTopY = avatarPos.y - deckTitleCardSize.height / 2;

  // Place avatar cards at the deck title row
  let nameOffsetX = 0;
  if (hasDeckAvatar) {
    for (const [i, card] of deck.boards.avatar.entries()) {
      const pos = snapGridToPixels(i * avatarSpacingX, startGridY, false);
      cards.push({
        name: card.name,
        position: pos,
        isLandscape: false,
        thresholdGroup: "none",
        type: "Avatar",
        cost: 0,
        quantity: card.quantity,
        board: "avatar",
      });
      updateBounds(pos.x, pos.y, false, DECK_AVATAR_SIZE);
    }
    // Shift deck name to the right of all avatar cards
    nameOffsetX =
      deck.boards.avatar.length * avatarSpacingX * SNAP_GRID.width +
      SNAP_GRID.width;
  }

  // Deck name header - vertically centered with avatar card
  const nameX = avatarPos.x - deckTitleCardSize.width / 2 + nameOffsetX;
  const nameY = avatarTopY;
  headers.push({
    label: deck.name,
    kind: "deck-name",
    position: { x: nameX, y: nameY },
  });

  // Include deck name + avatar in bounds so camera framing captures it
  contentTop = Math.min(contentTop, avatarTopY);
  contentLeft = Math.min(
    contentLeft,
    avatarPos.x - deckTitleCardSize.width / 2,
  );

  // Author header - sits directly below the deck name
  if (deck.author) {
    const authorFontSize = HEADER_HEIGHT * 0.3;
    headers.push({
      label: deck.author,
      kind: "deck-author",
      position: {
        x: nameX,
        y: nameY + HEADER_HEIGHT + authorFontSize * 0.2,
      },
    });
  }

  // Advance past the title/avatar row
  let currentGridY = startGridY + avatarRowHeightUnits + GROUP_GAP_UNITS;

  // === Mainboard ===
  const mainboardStartGridY = currentGridY;
  let mainboardMaxGridX = 0;

  // Board headers use a smaller font, so position them closer to cards
  const boardFontSize = HEADER_HEIGHT * 0.3;
  const boardHeaderGap = boardFontSize * 0.4;

  // Board headers sit above both the type subgroup header and cards
  const typeSubFontSize = HEADER_HEIGHT * 0.3;
  const typeSubGap = typeSubFontSize * 0.4;
  const boardAboveType =
    boardFontSize + boardHeaderGap + typeSubFontSize + typeSubGap;

  if (deck.boards.mainboard.length > 0) {
    const hPos = snapGridToPixels(0, currentGridY, false);
    headers.push({
      label: "Mainboard",
      kind: "deck-board",
      position: {
        x: hPos.x - CARD_SIZE.PORTRAIT.width / 2,
        y: hPos.y - CARD_SIZE.PORTRAIT.height / 2 - boardAboveType,
      },
    });

    const result = layoutByType(
      deck.boards.mainboard,
      "mainboard",
      0,
      currentGridY,
    );
    currentGridY = result.endGridY;
    mainboardMaxGridX = result.maxGridX;
  }

  // === Sideboard (below mainboard) ===
  if (deck.boards.sideboard.length > 0) {
    currentGridY += GROUP_GAP_UNITS - SUBGROUP_GAP_UNITS;

    const hPos = snapGridToPixels(0, currentGridY, false);
    headers.push({
      label: "Sideboard",
      kind: "deck-board",
      position: {
        x: hPos.x - CARD_SIZE.PORTRAIT.width / 2,
        y: hPos.y - CARD_SIZE.PORTRAIT.height / 2 - boardAboveType,
      },
    });

    const result = layoutByType(
      deck.boards.sideboard,
      "sideboard",
      0,
      currentGridY,
    );
    currentGridY = result.endGridY;
  }

  // === Maybeboard (to the right of mainboard) ===
  if (deck.boards.maybeboard.length > 0) {
    const mbStartX = mainboardMaxGridX + GROUP_GAP_UNITS;

    const hPos = snapGridToPixels(mbStartX, mainboardStartGridY, false);
    headers.push({
      label: "Maybeboard",
      kind: "deck-board",
      position: {
        x: hPos.x - CARD_SIZE.PORTRAIT.width / 2,
        y: hPos.y - CARD_SIZE.PORTRAIT.height / 2 - boardAboveType,
      },
    });

    layoutByType(
      deck.boards.maybeboard,
      "maybeboard",
      mbStartX,
      mainboardStartGridY,
    );
  }

  return {
    cards,
    headers,
    bounds: {
      left: contentLeft === Infinity ? 0 : contentLeft,
      top: contentTop === Infinity ? 0 : contentTop,
      right: contentRight === -Infinity ? 0 : contentRight,
      bottom: contentBottom === -Infinity ? 0 : contentBottom,
    },
  };
}
