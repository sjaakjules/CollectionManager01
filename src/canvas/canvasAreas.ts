/**
 * Canvas area utilities for stack/deck placement.
 *
 * Responsibilities:
 * - Define canvas/card instance contracts used by reducer + renderer.
 * - Place stack and deck areas into fixed world quadrants with overlap avoidance.
 * - Build canvas payloads for imported decks and stacks.
 *
 * Related files:
 * - `src/app/App.tsx` (canvas creation/pinning workflows)
 * - `src/app/AppState.ts` (canvas persistence in reducer state)
 * - `src/rendering/PixiStage.ts` (canvas rendering and interactions)
 * - `src/rendering/Grid.ts` (snap-to-grid and card geometry constants)
 */

import type { Card, Deck, DeckCard, ActiveBoard, CardType } from "@/data/dataModels";
import {
  createDefaultCardFilters,
  type CardFilterState,
} from "@/data/cardFilters";
import {
  CARD_CELL_SPACING,
  CARD_SIZE,
  DRAWN_GRID,
  HEADER_HEIGHT,
  snapCardCenter,
} from "@/rendering/Grid";

export type CanvasAreaKind = "stack" | "deck";

export type ZoneQuadrant = "main" | "decks" | "stacks";

export interface CanvasAreaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasCardInstance {
  id: string;
  cardName: string;
  x: number;
  y: number;
  board?: ActiveBoard | null;
}

export interface CanvasDeckVariant {
  id: string;
  name: string;
  activeCardIds: string[];
}

export interface CanvasArea {
  id: string;
  name: string;
  type: CanvasAreaKind;
  pinned: boolean;
  bounds: CanvasAreaBounds;
  cards: CanvasCardInstance[];
  deckId?: string;
  lookupDeckId?: string | null;
  avatarCardName?: string | null;
  deckAuthor?: string | null;
  deckVariants?: CanvasDeckVariant[];
  activeDeckVariantId?: string | null;
  cardFilters?: CardFilterState;
}

const QUADRANT_SIZE = 12000;
const QUADRANT_PADDING = 220;
const ZONE_SPREAD_STEP = 110;

/**
 * Clean imported deck names for display in deck canvas headers.
 *
 * Inputs:
 * - `name`: Raw deck title from import source.
 *
 * Outputs:
 * - Returns sanitized display name with Curiosa suffixes removed.
 */
export function sanitizeDeckZoneName(name: string | null | undefined): string {
  const normalized = (name ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Imported Deck";
  }

  const withoutCuriosaSuffix = normalized
    .replace(/\s*(?:\||-|—|•)\s*curiosa(?:\.io)?(?:\s*deck builder)?\s*$/i, "")
    .trim();
  const primarySegment = withoutCuriosaSuffix.split("|")[0]?.trim() ?? "";
  const cleaned = primarySegment.replace(/\s*\|+\s*$/g, "").trim();
  return cleaned || "Imported Deck";
}

export const ZONE_HEADER_HEIGHT = Math.round(HEADER_HEIGHT * 0.75);
export const ZONE_DECK_HEADER_HEIGHT =
  CARD_SIZE.PORTRAIT.height + 16 + DRAWN_GRID.height;
export const ZONE_DEFAULT_SIZE = {
  stack: { width: 980, height: 780 },
  deck: { width: 1400, height: 1200 },
} as const;

export const QUADRANT_BOUNDS: Record<ZoneQuadrant, CanvasAreaBounds> = {
  main: {
    x: 0,
    y: -QUADRANT_SIZE,
    width: QUADRANT_SIZE,
    height: QUADRANT_SIZE,
  },
  stacks: {
    x: -QUADRANT_SIZE,
    y: 0,
    width: QUADRANT_SIZE,
    height: QUADRANT_SIZE,
  },
  decks: {
    x: -QUADRANT_SIZE,
    y: -QUADRANT_SIZE,
    width: QUADRANT_SIZE,
    height: QUADRANT_SIZE,
  },
};

function randomId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create a unique canvas area id using the area type as prefix.
 *
 * Inputs:
 * - `type`: Canvas area type (`stack` or `deck`).
 *
 * Outputs:
 * - Returns a unique id string.
 */
export function createZoneId(type: CanvasAreaKind): string {
  return randomId(type);
}

/**
 * Create a unique id for a card instance inside a canvas area.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - Returns a unique canvas-card id string.
 */
export function createZoneCardId(): string {
  return randomId("canvas-card");
}

/**
 * Create a unique id for a deck variant persisted on a deck canvas area.
 */
export function createCanvasDeckVariantId(): string {
  return randomId("canvas-variant");
}

/**
 * Map persisted canvas area types to the saved-area quadrant.
 *
 * Inputs:
 * - `type`: Canvas area type value.
 *
 * Outputs:
 * - Returns the top-left saved-area quadrant key.
 */
export function getZoneQuadrant(type: CanvasAreaKind): ZoneQuadrant {
  void type;
  return "decks";
}

/**
 * Resolve quadrant for an existing canvas area model.
 *
 * Inputs:
 * - `zone`: Canvas area model.
 *
 * Outputs:
 * - Returns the lower-left lookup quadrant for temporary lookup decks,
 *   otherwise the top-left saved-area quadrant.
 */
export function getQuadrantByZoneId(zone: CanvasArea): ZoneQuadrant {
  if (zone.lookupDeckId) return "stacks";
  return getZoneQuadrant(zone.type);
}

function boundsOverlap(left: CanvasAreaBounds, right: CanvasAreaBounds): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function clampBoundsToQuadrant(
  area: CanvasAreaBounds,
  size: { width: number; height: number },
  x: number,
  y: number,
): CanvasAreaBounds {
  const minX = area.x + QUADRANT_PADDING;
  const maxX = area.x + area.width - size.width - QUADRANT_PADDING;
  const minY = area.y + QUADRANT_PADDING;
  const maxY = area.y + area.height - size.height - QUADRANT_PADDING;
  const clampedX = Math.max(minX, Math.min(maxX, x));
  const clampedY = Math.max(minY, Math.min(maxY, y));
  return { x: clampedX, y: clampedY, width: size.width, height: size.height };
}

/**
 * Compute pinned canvas area bounds inside a quadrant while avoiding overlaps.
 *
 * Inputs:
 * - `quadrant`: Target world quadrant.
 * - `size`: Requested canvas area size.
 * - `existingCount`: Count hint used to spread default placement.
 * - `occupiedBounds`: Existing pinned canvas area bounds in the same quadrant.
 *
 * Outputs:
 * - Returns clamped, collision-aware bounds for the new/moved canvas area.
 */
export function createCanvasAreaBoundsForQuadrant(
  quadrant: ZoneQuadrant,
  size: { width: number; height: number },
  existingCount = 0,
  occupiedBounds: CanvasAreaBounds[] = [],
): CanvasAreaBounds {
  const area = QUADRANT_BOUNDS[quadrant];
  const spreadIndex = Math.max(0, existingCount);
  const spread = spreadIndex * ZONE_SPREAD_STEP;

  let x = 0;
  let y = 0;
  if (quadrant === "main") {
    x = QUADRANT_PADDING + spread;
    y = -size.height - QUADRANT_PADDING - spread;
  } else if (quadrant === "decks") {
    x = -size.width - QUADRANT_PADDING - spread;
    y = -size.height - QUADRANT_PADDING - spread;
  } else {
    x = -size.width - QUADRANT_PADDING - spread;
    y = QUADRANT_PADDING + spread;
  }

  const baseBounds = clampBoundsToQuadrant(area, size, x, y);
  if (occupiedBounds.length === 0) {
    return baseBounds;
  }

  const intersectsAny = (candidate: CanvasAreaBounds): boolean =>
    occupiedBounds.some((occupied) => boundsOverlap(candidate, occupied));
  if (!intersectsAny(baseBounds)) {
    return baseBounds;
  }

  const directionX = quadrant === "main" || quadrant === "decks" ? 1 : -1;
  const directionY = quadrant === "decks" || quadrant === "stacks" ? 1 : -1;
  const stepX = size.width + ZONE_SPREAD_STEP;
  const stepY = size.height + ZONE_SPREAD_STEP;
  const maxDepth = Math.max(16, occupiedBounds.length * 3 + 8);
  const seen = new Set<string>();
  const tryCandidate = (candidateX: number, candidateY: number): CanvasAreaBounds | null => {
    const candidate = clampBoundsToQuadrant(area, size, candidateX, candidateY);
    const key = `${candidate.x},${candidate.y}`;
    if (seen.has(key)) {
      return null;
    }
    seen.add(key);
    return intersectsAny(candidate) ? null : candidate;
  };

  for (let depth = 0; depth <= maxDepth; depth++) {
    for (let deltaX = 0; deltaX <= depth; deltaX++) {
      const deltaY = depth - deltaX;
      const candidate = tryCandidate(
        baseBounds.x + deltaX * directionX * stepX,
        baseBounds.y + deltaY * directionY * stepY,
      );
      if (candidate) {
        return candidate;
      }
    }
  }

  const scanStepX = DRAWN_GRID.width * 2;
  const scanStepY = DRAWN_GRID.height * 2;
  const minX = area.x + QUADRANT_PADDING;
  const maxX = area.x + area.width - size.width - QUADRANT_PADDING;
  const minY = area.y + QUADRANT_PADDING;
  const maxY = area.y + area.height - size.height - QUADRANT_PADDING;
  const xStart = directionX > 0 ? minX : maxX;
  const yStart = directionY > 0 ? minY : maxY;
  const xExtent = Math.max(0, maxX - minX);
  const yExtent = Math.max(0, maxY - minY);
  const xSteps = Math.max(1, Math.floor(xExtent / scanStepX) + 1);
  const ySteps = Math.max(1, Math.floor(yExtent / scanStepY) + 1);

  for (let row = 0; row < ySteps; row++) {
    for (let col = 0; col < xSteps; col++) {
      const candidate = tryCandidate(
        xStart + col * directionX * scanStepX,
        yStart + row * directionY * scanStepY,
      );
      if (candidate) {
        return candidate;
      }
    }
  }

  return baseBounds;
}

/**
 * Create an empty pinned canvas area with quadrant-aware default bounds.
 *
 * Inputs:
 * - `type`: Canvas area type (`stack`/`deck`).
 * - `name`: Display name for the canvas area.
 * - `existingSameTypeCount`: Count hint for spread offset.
 * - `existingZones`: Existing canvas areas used to avoid overlap.
 *
 * Outputs:
 * - Returns a new `CanvasArea` with no cards.
 */
export function createEmptyZone(
  type: CanvasAreaKind,
  name: string,
  existingSameTypeCount: number,
  existingZones: CanvasArea[] = [],
): CanvasArea {
  const quadrant = getZoneQuadrant(type);
  const occupiedBounds = existingZones
    .filter(
      (zone) => zone.pinned && getQuadrantByZoneId(zone) === quadrant,
    )
    .map((zone) => zone.bounds);
  const bounds = createCanvasAreaBoundsForQuadrant(
    quadrant,
    ZONE_DEFAULT_SIZE[type],
    existingSameTypeCount,
    occupiedBounds,
  );

  return {
    id: createZoneId(type),
    name,
    type,
    pinned: true,
    bounds,
    cards: [],
  };
}

/**
 * Create a new stack centered on a world-space point.
 *
 * Inputs:
 * - `name`: Display name for the stack.
 * - `center`: Desired world-space center point (typically viewport center).
 * - `existingZones`: Existing canvas areas used to avoid immediate overlaps.
 *
 * Outputs:
 * - Returns a pinned stack `CanvasArea`.
 */
export function createStackZoneAtWorldPoint(
  name: string,
  center: { x: number; y: number },
  existingZones: CanvasArea[] = [],
): CanvasArea {
  const size = ZONE_DEFAULT_SIZE.stack;
  const baseX =
    Math.round((center.x - size.width / 2) / DRAWN_GRID.width) * DRAWN_GRID.width;
  const baseY =
    Math.round((center.y - size.height / 2) / DRAWN_GRID.height) * DRAWN_GRID.height;

  const occupiedBounds = existingZones
    .filter((zone) => zone.pinned)
    .map((zone) => zone.bounds);
  const overlapsAny = (candidate: CanvasAreaBounds): boolean =>
    occupiedBounds.some((occupied) => boundsOverlap(candidate, occupied));

  let bounds: CanvasAreaBounds = {
    x: baseX,
    y: baseY,
    width: size.width,
    height: size.height,
  };

  if (overlapsAny(bounds)) {
    const stepX = DRAWN_GRID.width * 2;
    const stepY = DRAWN_GRID.height * 2;
    const maxRadius = 18;

    outer: for (let radius = 1; radius <= maxRadius; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const candidate: CanvasAreaBounds = {
            x: baseX + dx * stepX,
            y: baseY + dy * stepY,
            width: size.width,
            height: size.height,
          };
          if (!overlapsAny(candidate)) {
            bounds = candidate;
            break outer;
          }
        }
      }
    }
  }

  return {
    id: createZoneId("stack"),
    name,
    type: "stack",
    pinned: true,
    bounds,
    cards: [],
  };
}

interface CardOrientationInfo {
  isLandscape: boolean;
  type: CardType | null;
  cost: number;
}

const DECK_TYPE_ORDER: Record<CardType, number> = {
  Minion: 0,
  Magic: 1,
  Aura: 2,
  Artifact: 3,
  Site: 4,
  Avatar: 5,
};
const ZONE_CONTENT_PADDING = 14 + 24;
const DECK_BOARD_GAP = 10;
const DECK_BOARD_LEFT_PADDING = 14;
const DECK_BOARD_INNER_LEFT = 12;
const DECK_BOARD_CARD_TOP = DRAWN_GRID.height;
const DECK_BOARD_BOTTOM_PADDING = 10;
const DECK_TYPE_GAP = Math.round(DRAWN_GRID.height * 0.5);

type DeckBoardKey = "mainboard" | "sideboard";
type DeckGroupKey = "Minion" | "Magic" | "Aura" | "Artifact" | "Site" | "other";
const DECK_LAYOUT_TYPE_SEQUENCE: DeckGroupKey[] = [
  "Minion",
  "Magic",
  "Aura",
  "Artifact",
  "Site",
  "other",
];

const DECK_EMPTY_BOARD_HEIGHT: Record<DeckBoardKey, number> = {
  mainboard: CARD_SIZE.PORTRAIT.height + 56,
  sideboard: CARD_SIZE.PORTRAIT.height + 44,
};

function fitBoundsToCards(
  fallback: CanvasAreaBounds,
  cards: CanvasCardInstance[],
  cardInfoByName: Map<string, CardOrientationInfo>,
  headerHeight = ZONE_HEADER_HEIGHT,
): CanvasAreaBounds {
  if (cards.length === 0) {
    return fallback;
  }

  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;

  for (const instance of cards) {
    const info = cardInfoByName.get(instance.cardName);
    const isLandscape = info?.isLandscape ?? false;
    const size = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    minLeft = Math.min(minLeft, instance.x);
    minTop = Math.min(minTop, instance.y);
    maxRight = Math.max(maxRight, instance.x + size.width);
    maxBottom = Math.max(maxBottom, instance.y + size.height);
  }

  if (
    minLeft === Infinity ||
    minTop === Infinity ||
    maxRight === -Infinity ||
    maxBottom === -Infinity
  ) {
    return fallback;
  }

  const x = minLeft - ZONE_CONTENT_PADDING;
  const y = minTop - (headerHeight + ZONE_CONTENT_PADDING);
  const width = maxRight - minLeft + ZONE_CONTENT_PADDING * 2;
  const height =
    maxBottom - minTop + ZONE_CONTENT_PADDING * 2 + headerHeight;

  return { x, y, width, height };
}

function snapPointForCard(
  x: number,
  y: number,
  isLandscape: boolean,
): { x: number; y: number } {
  const cardSize = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
  const snapped = snapCardCenter(
    x + cardSize.width / 2,
    y + cardSize.height / 2,
    isLandscape,
  );
  return {
    x: snapped.x - cardSize.width / 2,
    y: snapped.y - cardSize.height / 2,
  };
}

/**
 * Build a deck canvas area populated with card instances laid out by board/type.
 *
 * Inputs:
 * - `deck`: Deck data to project into a canvas area.
 * - `cardInfoByName`: Card orientation/type metadata map.
 * - `existingDeckCount`: Count hint for initial quadrant spread.
 * - `existingZones`: Existing canvas areas used for overlap-aware placement.
 *
 * Outputs:
 * - Returns a pinned `CanvasArea` with deck metadata and positioned cards.
 */
export function createDeckZone(
  deck: Deck,
  cardInfoByName: Map<string, CardOrientationInfo>,
  existingDeckCount: number,
  existingZones: CanvasArea[] = [],
): CanvasArea {
  const occupiedBounds = existingZones
    .filter((zone) => zone.pinned && getQuadrantByZoneId(zone) === "decks")
    .map((zone) => zone.bounds);
  const bounds = createCanvasAreaBoundsForQuadrant(
    "decks",
    ZONE_DEFAULT_SIZE.deck,
    existingDeckCount,
    occupiedBounds,
  );

  const instances: CanvasCardInstance[] = [];
  const mainActiveCardIds: string[] = [];
  const cardsByBoard: Record<
    DeckBoardKey,
    Array<DeckCard & { activeByDefault: boolean; instanceBoard: ActiveBoard }>
  > = {
    mainboard: [
      ...deck.boards.mainboard.map((card) => ({
        ...card,
        activeByDefault: true,
        instanceBoard: "mainboard" as const,
      })),
      ...deck.boards.maybeboard.map((card) => ({
        ...card,
        activeByDefault: false,
        instanceBoard: "maybeboard" as const,
      })),
    ],
    sideboard: deck.boards.sideboard.map((card) => ({
      ...card,
      activeByDefault: false,
      instanceBoard: "sideboard" as const,
    })),
  };
  const bodyLeft = bounds.x + DECK_BOARD_LEFT_PADDING;
  const bodyWidth = bounds.width - DECK_BOARD_LEFT_PADDING * 2;
  let nextBoardTop = bounds.y + ZONE_DECK_HEADER_HEIGHT + DECK_BOARD_LEFT_PADDING;

  (["mainboard", "sideboard"] as const).forEach((board) => {
    const boardCards = [...cardsByBoard[board]].sort((left, right) => {
      const leftInfo = cardInfoByName.get(left.name);
      const rightInfo = cardInfoByName.get(right.name);
      const leftTypeOrder =
        leftInfo?.type != null ? DECK_TYPE_ORDER[leftInfo.type] : Number.MAX_SAFE_INTEGER;
      const rightTypeOrder =
        rightInfo?.type != null ? DECK_TYPE_ORDER[rightInfo.type] : Number.MAX_SAFE_INTEGER;
      if (leftTypeOrder !== rightTypeOrder) {
        return leftTypeOrder - rightTypeOrder;
      }

      const costDelta = (leftInfo?.cost ?? 0) - (rightInfo?.cost ?? 0);
      if (costDelta !== 0) {
        return costDelta;
      }

      return left.name.localeCompare(right.name);
    });
    const cardsByType = new Map<
      DeckGroupKey,
      Array<DeckCard & { activeByDefault: boolean; instanceBoard: ActiveBoard }>
    >();
    for (const card of boardCards) {
      const cardType = cardInfoByName.get(card.name)?.type;
      const key: DeckGroupKey =
        cardType === "Minion" ||
        cardType === "Magic" ||
        cardType === "Aura" ||
        cardType === "Artifact" ||
        cardType === "Site"
          ? cardType
          : "other";
      const bucket = cardsByType.get(key) ?? [];
      bucket.push(card);
      cardsByType.set(key, bucket);
    }

    const populatedGroups = DECK_LAYOUT_TYPE_SEQUENCE.filter((key) =>
      (cardsByType.get(key)?.length ?? 0) > 0,
    );
    let boardBottom =
      nextBoardTop +
      (populatedGroups.length === 0 ? DECK_EMPTY_BOARD_HEIGHT[board] : 0);
    let groupTop = nextBoardTop + DECK_BOARD_CARD_TOP;

    populatedGroups.forEach((groupKey, groupIndex) => {
      const groupCards = cardsByType.get(groupKey) ?? [];
      if (groupCards.length === 0) return;

      const isLandscape = groupKey === "Site";
      const cardSize = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      const spacing = isLandscape
        ? CARD_CELL_SPACING.LANDSCAPE
        : CARD_CELL_SPACING.PORTRAIT;
      const stepX = spacing.x * DRAWN_GRID.width;
      const stepY = spacing.y * DRAWN_GRID.height;
      const availableWidth = Math.max(
        cardSize.width,
        bodyWidth - DECK_BOARD_INNER_LEFT * 2,
      );
      const cols = Math.max(
        1,
        Math.floor((availableWidth - cardSize.width) / stepX) + 1,
      );
      let groupBottom = groupTop;

      groupCards.forEach((card, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const x = bodyLeft + DECK_BOARD_INNER_LEFT + col * stepX;
        const y = groupTop + row * stepY;
        const snapped = snapPointForCard(x, y, isLandscape);
        groupBottom = Math.max(
          groupBottom,
          snapped.y + cardSize.height + DECK_BOARD_BOTTOM_PADDING,
        );

        const quantity = Math.max(1, Math.floor(card.quantity));
        for (let copy = 0; copy < quantity; copy++) {
          const instanceId = createZoneCardId();
          instances.push({
            id: instanceId,
            cardName: card.name,
            x: snapped.x,
            y: snapped.y,
            board: card.instanceBoard,
          });
          if (board === "mainboard" && card.activeByDefault) {
            mainActiveCardIds.push(instanceId);
          }
        }
      });

      boardBottom = Math.max(boardBottom, groupBottom);
      groupTop =
        groupBottom +
        (groupIndex < populatedGroups.length - 1 ? DECK_TYPE_GAP : 0);
    });

    nextBoardTop = boardBottom + DECK_BOARD_GAP;
  });

  const avatarCardName = deck.boards.avatar[0]?.name ?? null;
  const mainVariantId = createCanvasDeckVariantId();

  const contentFittedBounds = fitBoundsToCards(
    bounds,
    instances,
    cardInfoByName,
    ZONE_DECK_HEADER_HEIGHT,
  );
  if (instances.length > 0) {
    const boardDrivenHeight =
      nextBoardTop - DECK_BOARD_GAP - bounds.y + ZONE_CONTENT_PADDING;
    contentFittedBounds.height = Math.max(
      contentFittedBounds.height,
      boardDrivenHeight,
    );
  }

  return {
    id: createZoneId("deck"),
    name: sanitizeDeckZoneName(deck.name),
    type: "deck",
    deckId: deck.id,
    pinned: true,
    bounds: contentFittedBounds,
    cards: instances,
    avatarCardName,
    deckAuthor: deck.author ?? null,
    deckVariants: [
      {
        id: mainVariantId,
        name: "Main",
        activeCardIds: mainActiveCardIds,
      },
    ],
    activeDeckVariantId: mainVariantId,
    cardFilters: createDefaultCardFilters(),
  };
}

/**
 * Build a temporary deck lookup canvas area in the lower-left quadrant.
 *
 * Inputs:
 * - `deck`: Runtime deck selected from the deck-style lookup panel.
 * - `cardInfoByName`: Card orientation/type metadata map.
 * - `existingZones`: Existing canvas areas used for overlap-aware placement.
 *
 * Outputs:
 * - Returns a pinned lookup-only deck area that is not tied to a saved deck id.
 */
export function createLookupDeckZone(
  deck: Deck,
  cardInfoByName: Map<string, CardOrientationInfo>,
  existingZones: CanvasArea[] = [],
): CanvasArea {
  const base = createDeckZone(deck, cardInfoByName, 0, []);
  const occupiedBounds = existingZones
    .filter((zone) => zone.pinned)
    .map((zone) => zone.bounds);
  const bounds = createCanvasAreaBoundsForQuadrant(
    "stacks",
    { width: base.bounds.width, height: base.bounds.height },
    0,
    occupiedBounds,
  );
  const dx = bounds.x - base.bounds.x;
  const dy = bounds.y - base.bounds.y;

  return {
    ...base,
    id: `lookup-deck-${deck.id}`,
    deckId: undefined,
    lookupDeckId: deck.id,
    name: sanitizeDeckZoneName(deck.name),
    bounds,
    cards: base.cards.map((card) => ({
      ...card,
      x: card.x + dx,
      y: card.y + dy,
    })),
  };
}

/**
 * Re-pin a canvas area into its quadrant using collision-aware bounds.
 *
 * Inputs:
 * - `zone`: Canvas area to place.
 * - `existingCount`: Count hint for spread offset.
 * - `existingZones`: Existing canvas areas for overlap avoidance.
 *
 * Outputs:
 * - Returns the moved canvas area with updated bounds and `pinned: true`.
 */
export function moveZoneIntoQuadrant(
  zone: CanvasArea,
  existingCount: number,
  existingZones: CanvasArea[] = [],
): CanvasArea {
  const quadrant = getQuadrantByZoneId(zone);
  const occupiedBounds = existingZones
    .filter(
      (entry) =>
        entry.pinned &&
        entry.id !== zone.id &&
        getQuadrantByZoneId(entry) === quadrant,
    )
    .map((entry) => entry.bounds);
  const bounds = createCanvasAreaBoundsForQuadrant(
    quadrant,
    { width: zone.bounds.width, height: zone.bounds.height },
    existingCount,
    occupiedBounds,
  );
  return { ...zone, pinned: true, bounds };
}

/**
 * Move a canvas area to quadrant placement and translate contained cards by the same delta.
 *
 * Inputs:
 * - `zone`: Canvas area to reposition.
 * - `existingCount`: Count hint for spread offset.
 * - `existingZones`: Existing canvas areas for overlap avoidance.
 *
 * Outputs:
 * - Returns moved canvas area where card instance coordinates remain relative to area origin.
 */
export function moveZoneIntoQuadrantPreservingCards(
  zone: CanvasArea,
  existingCount: number,
  existingZones: CanvasArea[] = [],
): CanvasArea {
  const moved = moveZoneIntoQuadrant(zone, existingCount, existingZones);
  const dx = moved.bounds.x - zone.bounds.x;
  const dy = moved.bounds.y - zone.bounds.y;
  if (dx === 0 && dy === 0) {
    return moved;
  }

  return {
    ...moved,
    cards: moved.cards.map((card) => ({
      ...card,
      x: card.x + dx,
      y: card.y + dy,
    })),
  };
}

/**
 * Build lookup metadata for card orientation/type/cost by card name.
 *
 * Inputs:
 * - `cards`: Full card catalog.
 *
 * Outputs:
 * - Returns map keyed by card name, used for canvas layout decisions.
 */
export function cardNameToOrientationMap(
  cards: Card[],
): Map<string, CardOrientationInfo> {
  const map = new Map<string, CardOrientationInfo>();
  for (const card of cards) {
    map.set(card.name, {
      isLandscape: card.guardian.type === "Site",
      type: card.guardian.type,
      cost: Number.isFinite(card.guardian.cost) ? card.guardian.cost : 0,
    });
  }
  return map;
}
