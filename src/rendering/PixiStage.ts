/**
 * PixiJS application setup and card scene management
 *
 * Features:
 * - Faint background grid (55×55 pixel cells)
 * - Viewport culling: Only visible cards are rendered
 * - Card stacking: Multiple cards at same position offset to show names
 *   - Spells: offset downward (names on top)
 *   - Sites: offset upward (names on bottom)
 *
 * Interaction model:
 * - Middle/right-drag or Space + left-drag: Pan viewport
 * - Left-click: Select stack; another click drills into one card
 * - Left-drag on a card: Move the selected card, stack or group
 * - Left-drag on empty space (or Ctrl+drag): Selection box; Shift extends
 * - Double-click in a deck/stack area: Select the stack
 * - Double-click in the catalogue: Add to active deck (right-click removes)
 * - Touch: Tap, hold-to-drag, one-finger pan and pinch remain separate
 */

import {
  Application,
  Container,
  Graphics,
  Text,
  FederatedPointerEvent,
} from "pixi.js";
import { Camera, type CameraBounds } from "./Camera";
import { DeletionPoof } from "./DeletionPoof";
import { MangaEffect, type EffectBounds } from './MangaEffect';
import { drawMangaOutline, MANGA_PALETTE, unionEffectBounds } from './mangaStyle';
import { DEFAULT_INTERACTION_EFFECTS, ensureInteractionEffects, MangaEffectGate, MAX_MANGA_EFFECTS, type InteractionEffectsSettings, type MangaEffectKind, type CanvasGestureCommand } from '@/data/interactionEffects';
import { outlineSelectedStack } from './stackSelectionOutline';
import { openCanvasLabelEditor } from "@/ui/canvasLabelEditor";
import { createDefaultCatalogueLayout, type CatalogueLayoutConfig } from "@/data/catalogueLayout";
import { getLabelFamily, getLabelCards, getLabelRegionBounds, repositionLabelsAfterCardLayout, ShakeDetector } from "@/canvas/labelRegions";
import { getCardClickSelection } from "./cardSelection";
import { CardSprite, type CardSpriteState } from "./CardSprite";
import {
  calculateCardLayout,
  calculateDeckLayout,
  DRAWN_GRID,
  CARD_CELL_SPACING,
  CARD_SIZE,
  DECK_AVATAR_SIZE,
  GRID_LINE,
  HEADER_HEIGHT,
  STACK_OFFSET,
  snapCardCenter,
  snapToDrawnGrid,
  pixelsToSnapGrid,
  type CardLayoutInfo,
  type CollectionLayoutVariant,
  type ContentBounds,
} from "./Grid";
import {
  lodManager,
  LOD_LEVELS,
  cardNameToSlug,
  type LODLevel,
  type LODTextureInvalidation,
} from "./LODManager";
import {
  getHighDetailLoadOptions,
  getInitialRevealConcurrentLoads,
  getPixiCanvasResolution,
  getPixiTextResolution,
  isConstrainedTextureDevice,
  isLowDetailTextureDevice,
} from "./deviceProfile";
import {
  isSyntheticMouseAfterTouch,
  isTouchLikePointerEvent,
  SYNTHETIC_MOUSE_AFTER_TOUCH_MS,
  TouchGestureTracker,
  type TouchGesturePoint,
  type TouchGestureSnapshot,
  type TouchGestureTarget,
} from "./touchGestures";
import type {
  Card,
  Deck,
  ActiveBoard,
  CollectionItem,
  CanvasLabel,
  CardType,
  ThresholdGroup,
} from "@/data/dataModels";
import {
  formatCategoryScore,
  getCategoryScore,
  getCategoryShelfCards,
  setCategoryScore,
  type CardCategoryData,
} from "@/data/cardCategories";
import {
  getDeckStyleCardScore,
  getDeckStyleShelfCards,
  type DeckStyleAssociationData,
  type DeckStyleAssociationMode,
} from "@/data/deckStyleAssociations";
import {
  applyCardFilters,
  cloneCardFilterState,
  createDefaultCardFilters,
  ensureCardFilterState,
  isCardFilterActive,
  isCardFilterCriteriaEmpty,
  type CardFilterState,
} from "@/data/cardFilters";
import { getThresholdGroup } from "@/data/dataModels";
import { getRarityLimit } from "@/rules/deckRules";
import { describeFilterButton } from "@/ui/cardFilterUi";
import {
  QUADRANT_BOUNDS,
  ZONE_DECK_HEADER_HEIGHT,
  ZONE_DEFAULT_SIZE,
  ZONE_HEADER_HEIGHT,
  createCanvasDeckVariantId,
  sanitizeDeckZoneName,
  type CanvasDeckVariant,
  type CanvasArea,
  type CanvasCardInstance,
} from "@/canvas/canvasAreas";
import {
  DECK_BOARD_ORDER, DECK_BOARD_MIN_HEIGHT, DECK_MIN_WIDTH,
  getDeckBoardWidth, getDeckBoardRects as computeDeckBoardRects,
  fitDeckBoardSections, getDeckAreaBounds, placeNewDeckCards, getMainDeckSectionRects, normalizeDeckBoard, type DeckZoneBoard,
} from '@/canvas/deckBoardLayout';

// ============================================================================
// Types
// ============================================================================

export interface PixiStageConfig {
  container: HTMLElement;
  onAddToDeck: (cardName: string) => void;
  onRemoveFromDeck: (cardName: string) => void;
  onTextureProgress?: (loaded: number, total: number) => void;
  onBackgroundTextureProgress?: (loaded: number, total: number) => void;
  onSelectionChange?: (selectedCardNames: string[]) => void;
  onCanvasLabelsChange?: (labels: CanvasLabel[]) => void;
  onLabelPlacementConsumed?: () => void;
  onHoveredCardChange?: (cardName: string | null) => void;
  onCanvasAreasChange?: (areas: CanvasArea[]) => void;
  onStackZoneHeaderClick?: (zoneId: string) => void;
  onViewportCenterChange?: (center: { x: number; y: number }) => void;
  onDeckFilterRequest?: (request: {
    zoneId: string;
    editingFilterIndex: number | null;
    anchorClientRect: { left: number; top: number; right: number; bottom: number };
  }) => void;
  onCardDragDrop?: (payload: CardDragDropPayload) => void;
  onCardsAddedToCanvasArea?: (canvasAreaId: string, cardNames: string[]) => void;
  onDeckLayoutResetRequest?: (canvasAreaId: string) => void;
  onQuickTransferCreateTarget?: (payload: QuickTransferCreateTargetPayload) => void;
  onDeckAddRequest?: (payload: DeckAddRequestPayload) => void;
  onCardCategoryScoreChange?: (
    cardName: string,
    categoryId: string,
    value: number,
  ) => void;
  deckTransferTargets?: QuickTransferDeckTarget[];
}

export interface CardDragDropPayload {
  cardNames: string[];
  clientX: number;
  clientY: number;
}

export interface DeckAddPlacement {
  cardName: string;
  centerX: number;
  centerY: number;
}

export function mergeSelectedCardNames(
  mainCardNames: string[],
  zoneCardNames: string[],
): string[] {
  return [...new Set([...mainCardNames, ...zoneCardNames])].sort((a, b) =>
    a.localeCompare(b),
  );
}

export interface DeckAddRequestPayload {
  deckId: string;
  canvasAreaId?: string | null;
  cardNames: string[];
  placements?: DeckAddPlacement[];
  worldPos: { x: number; y: number };
  clientX: number;
  clientY: number;
  source: "active-deck" | "quick-transfer" | "side-rail" | "canvas-zone";
  board?: ActiveBoard;
  labelId?: string;
}

export interface QuickTransferDeckTarget {
  id: string;
  deckId: string;
  canvasAreaId?: string | null;
  label: string;
}

export interface QuickTransferCreateTargetPayload {
  category: QuickTransferCategory;
  cardNames: string[];
  clientX: number;
  clientY: number;
}

interface CardSpriteData {
  sprite: CardSprite;
  bounds: { left: number; top: number; right: number; bottom: number };
  layout: CardLayoutInfo;
  gridKey: string;
  displaySize: { width: number; height: number };
  basePosition: { x: number; y: number }; // Position without stack offset
}

interface DragState {
  isDragging: boolean;
  draggedCards: Set<string>;
  startWorldPos: { x: number; y: number };
  cardStartPositions: Map<string, { x: number; y: number }>;
  cardStartBasePositions: Map<string, { x: number; y: number }>;
  cardStartGridKeys: Map<string, string>;
  cardOriginalZIndices: Map<string, number>;
}

interface SelectionBoxState {
  isActive: boolean;
  startWorldPos: { x: number; y: number } | null;
  graphics: Graphics | null;
  additive?: boolean;
}

interface PendingCardClickState {
  cardKey: string;
  startScreenPos: { x: number; y: number };
  startWorldPos: { x: number; y: number };
  shiftKey: boolean;
}

interface PendingZoneCardClickState {
  zoneCardKey: string;
  startScreenPos: { x: number; y: number };
  startWorldPos: { x: number; y: number };
  shiftKey: boolean;
  altKey: boolean;
}

interface LabelSpriteData {
  label: CanvasLabel;
  text: Text;
  bounds: { left: number; top: number; right: number; bottom: number };
}

interface LabelDragState {
  isDragging: boolean;
  labelId: string | null;
  startWorldPos: { x: number; y: number };
  labelStartPos: { x: number; y: number };
}

interface ZoneCardSpriteData {
  key: string;
  zoneId: string;
  instanceId: string;
  cardName: string;
  cardType: CardType | null;
  sprite: CardSprite;
  bounds: { left: number; top: number; right: number; bottom: number };
  displaySize: { width: number; height: number };
}

interface DeckGraphHoverSeries {
  label: string;
  color: number;
  values: number[];
  decimals: number;
}

interface DeckGraphHoverRegion {
  bounds: { left: number; top: number; right: number; bottom: number };
  manaCosts: number[];
  series: DeckGraphHoverSeries[];
}

interface ZoneHeaderData {
  bounds: { left: number; top: number; right: number; bottom: number };
  closeBounds: { left: number; top: number; right: number; bottom: number };
  sortBounds: { left: number; top: number; right: number; bottom: number };
  filterBounds: { left: number; top: number; right: number; bottom: number } | null;
  filterChipBounds: Array<{
    clauseIndex: number;
    bounds: { left: number; top: number; right: number; bottom: number };
    removeBounds: { left: number; top: number; right: number; bottom: number } | null;
  }>;
  variantTabBounds: Array<{
    variantId: string;
    isAdd: boolean;
    bounds: { left: number; top: number; right: number; bottom: number };
  }>;
  graphHoverRegions: DeckGraphHoverRegion[];
}

interface ZoneCardDragState {
  isDragging: boolean;
  key: string | null;
  zoneId: string | null;
  instanceId: string | null;
  startWorldPos: { x: number; y: number };
  startCardPos: { x: number; y: number };
  cards: Map<string, { zoneId: string; instanceId: string; x: number; y: number; spriteX: number; spriteY: number }>;
}

interface ZoneDragState {
  isDragging: boolean;
  zoneId: string | null;
  startWorldPos: { x: number; y: number };
  startBounds: { x: number; y: number } | null;
}

type TouchCanvasTarget =
  | ({ kind: "empty" } & TouchGestureTarget)
  | ({
      kind: "card";
      cardKey: string;
      cardName: string;
      cardType: CardType | null;
    } & TouchGestureTarget)
  | ({
      kind: "zone-card";
      zoneCardKey: string;
      zoneId: string;
      instanceId: string;
      cardName: string;
      cardType: CardType | null;
    } & TouchGestureTarget)
  | ({ kind: "zone-header"; zoneId: string } & TouchGestureTarget)
  | ({ kind: "zone"; zoneId: string } & TouchGestureTarget)
  | ({ kind: "label"; labelId: string } & TouchGestureTarget)
  | ({ kind: "zone-sort"; zoneId: string } & TouchGestureTarget)
  | ({ kind: "zone-filter"; zoneId: string } & TouchGestureTarget)
  | ({ kind: "zone-close"; zoneId: string } & TouchGestureTarget)
  | ({
      kind: "deck-filter-chip";
      zoneId: string;
      clauseIndex: number;
      removeHovered: boolean;
    } & TouchGestureTarget)
  | ({
      kind: "zone-variant-tab";
      zoneId: string;
      variantId: string | null;
      isAdd: boolean;
    } & TouchGestureTarget);

type QuickTransferCategory = "deck" | "stack";

interface QuickTransferCategoryBounds {
  category: QuickTransferCategory;
  bounds: { left: number; top: number; right: number; bottom: number };
}

interface QuickTransferCanvasAreaBounds {
  zoneId: string | null;
  deckId: string | null;
  category: QuickTransferCategory;
  isCreate: boolean;
  bounds: { left: number; top: number; right: number; bottom: number };
}

interface QuickTransferTargetRow {
  id: string;
  label: string;
  zoneId: string | null;
  deckId: string | null;
  isCreate: boolean;
}

interface QuickTransferState {
  active: boolean;
  anchorScreenPos: { x: number; y: number } | null;
  categoryHover: QuickTransferCategory | null;
  categoryHoverStartMs: number;
  expandedCategory: QuickTransferCategory | null;
  zoneHoverId: string | null;
  categoryBounds: QuickTransferCategoryBounds[];
  zoneBounds: QuickTransferCanvasAreaBounds[];
}

interface DraggedCardPlacement {
  cardName: string;
  centerX: number;
  centerY: number;
}

interface CanvasDomDropTarget {
  type: "stack" | "deck" | null;
  zoneId: string | null;
  deckId: string | null;
}

interface DeckVariantDialogResult {
  name: string;
  sourceVariantId: string | null;
}

interface DeckCostBucketStats {
  total: number;
  byType: Record<string, number>;
  byThreshold: Record<ThresholdGroup, number>;
}

interface DeckHeaderStats {
  spellsTotal: number;
  sitesTotal: number;
  collectionTotal: number;
  spellTypeCounts: Record<string, number>;
  minionInfo: {
    total: number;
    topKeywords: Array<{
      label: string;
      count: number;
    }>;
  };
  duplicateViolations: Array<{
    name: string;
    count: number;
    limit: number;
  }>;
  costBuckets: Record<"low" | "mid" | "high", DeckCostBucketStats>;
  spellThresholdTotals: Record<"air" | "earth" | "fire" | "water", number> & {
    total: number;
  };
  averageSpellThresholds: number;
  averageThresholdsPerMana: number;
  siteThresholdTotals: Record<"air" | "earth" | "fire" | "water", number>;
  siteProviderCounts: Record<"air" | "earth" | "fire" | "water", number>;
  manaCosts: number[];
  manaCardCurve: {
    total: number[];
    air: number[];
    earth: number[];
    fire: number[];
    water: number[];
  };
  elementLoadPerMana: {
    all: number[];
    minion: number[];
    magic: number[];
    aura: number[];
  };
}

interface DeckKeywordSpec {
  id:
    | "airborne"
    | "voidwalk"
    | "burrowing"
    | "submerge"
    | "stealthDefenceless"
    | "lanceFirstStrike"
    | "spellcaster"
    | "charge"
    | "ranged"
    | "evil"
    | "lethal"
    | "ward";
  label: string;
  rulesPatterns: RegExp[];
  subTypePatterns?: RegExp[];
}

interface AssociationShelfEntry {
  key: string;
  card: Card;
  score: number;
}

// ============================================================================
// Constants
// ============================================================================

const CULLING_MARGIN = 300;
const CULLING_THROTTLE_MS = 50;
const DOUBLE_CLICK_TIME_MS = 300;
const DESKTOP_CLICK_SLOP_PX = 6;
const ATLAS_CARD_REVEAL_SPREAD_MS = 300;
const PHONE_MEDIUM_NEAR_VIEWPORT_MULTIPLIER = 0.75;
const PHONE_MEDIUM_PAN_DIRECTION_VIEWPORTS = 1;
const PHONE_MEDIUM_HIGH_PAN_VELOCITY_PX_PER_MS = 0.8;
const PHONE_MEDIUM_LOAD_RESUME_IDLE_MS = 160;
const ZONE_BODY_PADDING = 14;
const ZONE_AUTO_EXPAND_PADDING = 24;
const ZONE_DELETE_SIZE = 18;
const ZONE_CARD_ACTION_GAP = 4;
const MAIN_QUADRANT_CARD_PADDING = 220;
const ZONE_DECK_BOARD_GAP = 10;
const ASSOCIATION_SHELF_TOP_GAP = DRAWN_GRID.height * 2;
const ASSOCIATION_SHELF_TITLE_CARD_GAP = DRAWN_GRID.height * 2;
const ZONE_DECK_BOARD_INNER_LEFT = 12;
const ZONE_DECK_CARD_TOP_GAP = DRAWN_GRID.height;
const ZONE_DECK_BOARD_BOTTOM_PADDING = 10;
const ZONE_DECK_TYPE_GAP = Math.round(DRAWN_GRID.height * 0.5);
const ZONE_DECK_TAB_HEIGHT = 22;
const ZONE_DECK_TAB_GAP = 6;
const ZONE_DECK_TAB_PADDING_X = 12;
const ZONE_DECK_ADD_TAB_WIDTH = 24;
const ZONE_SORT_BUTTON_WIDTH = 48;
const ZONE_SORT_BUTTON_HEIGHT = 20;
const ZONE_FILTER_BUTTON_WIDTH = 52;
const ZONE_FILTER_BUTTON_HEIGHT = 20;
const ZONE_FILTER_CHIP_HEIGHT = 18;
const ZONE_FILTER_CHIP_PADDING_X = 7;
const ZONE_FILTER_CHIP_REMOVE_SIZE = 12;
const ZONE_FILTER_CHIP_GAP = 4;
const ZONE_DECK_AVATAR_CENTER_GRID_X = 1;
const ZONE_DECK_AVATAR_CENTER_GRID_Y = 2;
const ZONE_DECK_AVATAR_TITLE_GAP = 20;
const ZONE_DECK_HEADER_X_OFFSET = DRAWN_GRID.width * 0.5;
const ZONE_DECK_MIN_BOARD_HEIGHT = DECK_BOARD_MIN_HEIGHT;
const ZONE_DECK_STATS_COL_GAP = 10;
const ZONE_DECK_STATS_TITLE_SIZE = 11;
const ZONE_DECK_STATS_LINE_SIZE = 10;
const ZONE_DECK_STATS_LINE_GAP = 2;
const ZONE_DECK_STATS_TEXT_FILLS = {
  title: 0xdbe4ff,
  line: 0xbdd0ff,
  subtle: 0x9eb4ee,
} as const;
const ZONE_DECK_STATS_TEXT_STROKE = { color: 0x0d1224, width: 1 };
const ZONE_DECK_GRAPH_COLORS = {
  total: MANGA_PALETTE.paper,
  air: 0x9bdcff,
  earth: 0x9fe07e,
  fire: 0xffac76,
  water: 0x70bcff,
  all: 0xf1f5ff,
  minion: 0x7fd0ff,
  magic: 0xff94c6,
  aura: 0xa9eb7a,
  artifact: 0xf5d977,
} as const;
const ZONE_DECK_GRAPH_LINE_WIDTH = 0.9;
const ZONE_DECK_GRAPH_HOVER_DOT_RADIUS = 2.7;
const QUICK_TRANSFER_HOLD_MS = 500;
const QUICK_TRANSFER_CATEGORY_WIDTH = 112;
const QUICK_TRANSFER_BOX_HEIGHT = 28;
const QUICK_TRANSFER_ZONE_WIDTH = 142;
const QUICK_TRANSFER_GAP = 10;
const QUICK_TRANSFER_EDGE_PADDING = 8;
const QUICK_TRANSFER_COLORS = {
  baseFill: 0x161626,
  hoverFill: 0x3a3a5a,
  activeFill: 0x4a4a8a,
  baseBorder: 0x3a3a5a,
  activeBorder: 0x6a6aba,
  baseText: 0xb8b8cc,
  hoverText: 0xe0e0e0,
  activeText: 0xffffff,
} as const;
const ZONE_SORT_TYPE_ORDER: Record<CardType, number> = {
  Minion: 0,
  Magic: 1,
  Aura: 2,
  Artifact: 3,
  Site: 4,
  Avatar: 5,
};
const DECK_KEYWORD_SPECS: DeckKeywordSpec[] = [
  {
    id: "airborne",
    label: "Airborne",
    rulesPatterns: [/\bairborne\b/i],
  },
  {
    id: "voidwalk",
    label: "Voidwalk",
    rulesPatterns: [/\bvoidwalk\b/i],
  },
  {
    id: "burrowing",
    label: "Burrowing",
    rulesPatterns: [/\bburrowing\b/i],
  },
  {
    id: "submerge",
    label: "Submerge",
    rulesPatterns: [/\bsubmerge\b/i],
  },
  {
    id: "stealthDefenceless",
    label: "Stealth/Def",
    rulesPatterns: [
      /\bstealth\b/i,
      /\bdefenceless\b/i,
      /\bdefenseless\b/i,
      /\bundefended\b/i,
    ],
  },
  {
    id: "lanceFirstStrike",
    label: "Lance/First",
    rulesPatterns: [/\blance\b/i, /\bfirst strike\b/i],
  },
  {
    id: "spellcaster",
    label: "Spellcaster",
    rulesPatterns: [/\bspellcaster\b/i],
  },
  {
    id: "charge",
    label: "Charge",
    rulesPatterns: [/\bcharge\b/i],
  },
  {
    id: "ranged",
    label: "Ranged",
    rulesPatterns: [/\branged\b/i],
  },
  {
    id: "evil",
    label: "Evil",
    rulesPatterns: [/\bevil\b/i],
    subTypePatterns: [/\bmonster\b/i, /\bdemon\b/i, /\bundead\b/i],
  },
  {
    id: "lethal",
    label: "Lethal",
    rulesPatterns: [/\blethal\b/i],
  },
  {
    id: "ward",
    label: "Ward",
    rulesPatterns: [/\bward\b/i],
  },
];

// ============================================================================
// PixiStage Class
// ============================================================================

export class PixiStage {
  private app: Application;
  private camera: Camera | null = null;
  private cardContainer: Container;
  private zoneContainer: Container;
  private zoneDropPreviewContainer: Container;
  private labelContainer: Container;
  private gridGraphics: Graphics | null = null;
  private quadrantGraphics: Graphics | null = null;
  private cardSprites: Map<string, CardSpriteData> = new Map();
  private zoneCardSprites: Map<string, ZoneCardSpriteData> = new Map();
  private zoneFrames: Map<
    string,
    {
      frame: Graphics;
      title: Text;
      subzoneLabels: Container[];
      avatarSprite: CardSprite | null;
    }
  > = new Map();
  private zoneHeaderBounds: Map<string, ZoneHeaderData> = new Map();
  private zoneDeleteOverlay: Graphics | null = null;
  private deckGraphTooltipBox: Graphics | null = null;
  private deckGraphTooltipText: Text | null = null;
  private deckGraphHoverDots: Graphics | null = null;
  private associationTooltipBox: Graphics | null = null;
  private associationTooltipText: Text | null = null;
  private zoneDropPreviewOverlay: Graphics | null = null;
  private zoneDropPreviewSprites: CardSprite[] = [];
  private zoneDropPreviewSignature: string | null = null;
  private quickTransferOverlay: Graphics | null = null;
  private quickTransferOverlayTexts: Text[] = [];
  private armedDelete: { key: string; expires: number } | null = null;
  private labelRegionGraphics: Map<string, Graphics> = new Map();
  private dragFeedbackGraphic: Graphics | null = null;
  private dragFeedbackText: Text | null = null;
  private dragFeedbackBounds: CanvasArea["bounds"] | null = null;
  private shakeDetector = new ShakeDetector();
  private dragDetached = false;
  private dragDetachedAt = 0;
  private labelDragCardStarts = new Map<string, { x: number; y: number }>();
  private labelDragLabelStarts = new Map<string, { x: number; y: number }>();
  private labelDragBoardTargets: Array<{ areaId: string; board: DeckZoneBoard; rect: CanvasArea["bounds"] }> = [];
  private labelDragLastPos: { x: number; y: number } | null = null;
  private deletionPuffs: Array<{ effect: DeletionPoof; start: number }> = [];
  private mangaEffects: Array<{ effect: MangaEffect; start: number; follow?: string[] }> = [];
  private mangaEffectLayer: Container | null = null;
  private effectSettings = { ...DEFAULT_INTERACTION_EFFECTS };
  private effectGate = new MangaEffectGate();
  private catalogueEffectTimer: ReturnType<typeof setTimeout> | null = null;
  private hasReceivedAreas = false;
  private lastSelectionEffect = '';
  private lastFullPoof = -Infinity;
  private focusEffectTimer: ReturnType<typeof setTimeout> | null = null;
  private inspection: Container | null = null;
  private readonly handleInspectionResize = (): void => this.closeInspection();
  private readonly handleInspectionWheel = (event: WheelEvent): void => {
    if (this.inspection) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private removedCardHistory: Array<{ areaId: string; card: CanvasCardInstance; index: number; variants: string[] }> = [];
  private touchActionSheetRoot: HTMLElement | null = null;
  private touchActionSheetPointerHandler: ((event: PointerEvent) => void) | null = null;
  private touchActionSheetKeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private deckVariantDialogRoot: HTMLElement | null = null;
  private deckVariantDialogKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private deckVariantDialogOpen = false;
  private hoveredZoneCardKey: string | null = null;
  private hoveredDeckFilterChip:
    | { zoneId: string; clauseIndex: number; removeHovered: boolean }
    | null = null;
  private canvasAreas: CanvasArea[] = [];
  private labelSprites: Map<string, LabelSpriteData> = new Map();
  private canvasLabels: CanvasLabel[] = [];
  private cards: Card[] = [];
  private isInitialized = false;
  private isDestroyed = false;
  private pendingCardSet:
    | { cards: Card[]; catalogueCards: Card[]; catalogueLayout: CatalogueLayoutConfig }
    | null = null;
  private catalogueCards: Card[] = [];
  private catalogueLayout: CatalogueLayoutConfig = createDefaultCatalogueLayout();
  private collectionLayoutVariant: CollectionLayoutVariant | null = null;

  // Culling state
  private lastCullingUpdate = 0;
  private visibleCardNames: Set<string> = new Set();
  private cullingScheduled = false;
  private lastViewportCenter: { x: number; y: number } | null = null;
  private lastViewportMoveMs = 0;
  private viewportVelocityPxPerMs = { x: 0, y: 0 };
  private lastHighVelocityPanMs = -Infinity;
  private mediumLoadResumeTimerId: number | null = null;
  private removeTextureInvalidationListener: (() => void) | null = null;

  // Selection state
  private selectedCards: Set<string> = new Set();
  private selectedZoneCardKeys: Set<string> = new Set();
  private selectedZoneId: string | null = null;

  // Drag state
  private dragState: DragState = {
    isDragging: false,
    draggedCards: new Set(),
    startWorldPos: { x: 0, y: 0 },
    cardStartPositions: new Map(),
    cardStartBasePositions: new Map(),
    cardStartGridKeys: new Map(),
    cardOriginalZIndices: new Map(),
  };
  private pointerDownOnSelectedCard = false;
  private spacePanHeld = false;
  private desktopPanStart: { x: number; y: number } | null = null;
  private readonly handlePanKeyDown = (event: KeyboardEvent): void => {
    const editing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable], [role='dialog']");
    if (!editing && (event.metaKey || event.ctrlKey) && !event.shiftKey && event.code === 'KeyZ' && this.removedCardHistory.length) {
      event.preventDefault();
      this.runCanvasGesture('undo');
      return;
    }
    if (event.code === 'Escape' && !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable], [role='dialog']"))) {
      this.closeInspection();
      this.armedDelete = null;
      this.cancelDesktopInteraction();
      this.drawZoneDeleteOverlay();
      return;
    }
    if (this.inspection) return;
    if (event.code !== "Space" || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, button, [contenteditable], [role='button'], [role='dialog']")) return;
    this.spacePanHeld = true;
    event.preventDefault();
  };
  private readonly handlePanKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") this.spacePanHeld = false;
  };
  private readonly handleCanvasBlur = (): void => {
    this.spacePanHeld = false;
    this.cancelDesktopInteraction();
  };
  private stacksDropVisualActive = false;
  private zoneCardDragState: ZoneCardDragState = {
    isDragging: false,
    key: null,
    zoneId: null,
    instanceId: null,
    startWorldPos: { x: 0, y: 0 },
    startCardPos: { x: 0, y: 0 },
    cards: new Map(),
  };
  private zoneDragState: ZoneDragState = {
    isDragging: false,
    zoneId: null,
    startWorldPos: { x: 0, y: 0 },
    startBounds: null,
  };
  private quickTransferState: QuickTransferState = {
    active: false,
    anchorScreenPos: null,
    categoryHover: null,
    categoryHoverStartMs: 0,
    expandedCategory: null,
    zoneHoverId: null,
    categoryBounds: [],
    zoneBounds: [],
  };

  // Selection box state
  private selectionBox: SelectionBoxState = {
    isActive: false,
    startWorldPos: null,
    graphics: null,
  };

  // Double-click detection
  private lastClickTime = 0;
  private lastClickedCard: string | null = null;
  private lastZoneCardClickTime = 0;
  private lastClickedZoneCardKey: string | null = null;
  private lastLabelClickTime = 0;
  private lastClickedLabel: string | null = null;
  private pendingCardClick: PendingCardClickState | null = null;
  private pendingZoneCardClick: PendingZoneCardClickState | null = null;

  // Label state
  private labelPlacementMode = false;
  private closeLabelEditor: (() => void) | null = null;
  private labelDragState: LabelDragState = {
    isDragging: false,
    labelId: null,
    startWorldPos: { x: 0, y: 0 },
    labelStartPos: { x: 0, y: 0 },
  };

  // Card stacking - track cards at each grid position
  private cardStacks: Map<string, string[]> = new Map();

  // Group header labels
  private headerLabels: Text[] = [];

  // Deck display state
  private deckSprites: Map<string, CardSpriteData> = new Map();
  private deckHeaderLabels: Text[] = [];
  private associationShelfSprites: Map<string, CardSpriteData> = new Map();
  private associationShelfHeaderLabels: Text[] = [];
  private collectionBounds: ContentBounds = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  };
  private associationShelfBounds: ContentBounds = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  };
  private deckBounds: ContentBounds = { left: 0, top: 0, right: 0, bottom: 0 };
  private activeDeck: Deck | null = null;

  // Card category highlighting state
  private cardCategoryData: CardCategoryData | null = null;
  private selectedCardCategoryId: string | null = null;

  // Read-only deck-style association highlighting state
  private associationsEnabled = false;
  private deckStyleAssociationMode: DeckStyleAssociationMode = "primary";
  private selectedAssociationStyleId: string | null = null;
  private selectedAssociationSubStyleId: string | null = null;
  private deckStyleAssociations: DeckStyleAssociationData | null = null;

  // Reveal animation state
  private revealFading = false;
  private revealFadeStart = 0;
  private revealRunId = 0;
  private pendingRevealTimeouts: number[] = [];
  private isRevealInProgress = false;
  private initialRevealCompleted = false;
  private highDetailPreloadRunning = false;
  private highDetailPreloadQueued = false;
  private highDetailPreloadRunId = 0;

  // Callbacks
  private onAddToDeck: (cardName: string) => void;
  private onRemoveFromDeck: (cardName: string) => void;
  private onTextureProgress?: (loaded: number, total: number) => void;
  private onBackgroundTextureProgress?: (loaded: number, total: number) => void;
  private onSelectionChange?: (selectedCardNames: string[]) => void;
  private onCanvasLabelsChange?: (labels: CanvasLabel[]) => void;
  private onLabelPlacementConsumed?: () => void;
  private onHoveredCardChange?: (cardName: string | null) => void;
  private onCanvasAreasChange?: (areas: CanvasArea[]) => void;
  private onStackZoneHeaderClick?: (zoneId: string) => void;
  private onViewportCenterChange?: (center: { x: number; y: number }) => void;
  private onDeckFilterRequest?: (request: {
    zoneId: string;
    editingFilterIndex: number | null;
    anchorClientRect: { left: number; top: number; right: number; bottom: number };
  }) => void;
  private onCardDragDrop?: (payload: CardDragDropPayload) => void;
  private onCardsAddedToCanvasArea?: (canvasAreaId: string, cardNames: string[]) => void;
  private onDeckLayoutResetRequest?: (canvasAreaId: string) => void;
  private onQuickTransferCreateTarget?: (payload: QuickTransferCreateTargetPayload) => void;
  private onDeckAddRequest?: (payload: DeckAddRequestPayload) => void;
  private onCardCategoryScoreChange?: (
    cardName: string,
    categoryId: string,
    value: number,
  ) => void;
  private deckTransferTargets: QuickTransferDeckTarget[] = [];
  private hoveredCardName: string | null = null;
  private lastPointerScreenPos: { x: number; y: number } | null = null;
  private quickTransferLastTickMs = 0;
  private quickTransferHoldTimerId: number | null = null;
  private readonly touchGestures = new TouchGestureTracker<TouchCanvasTarget>();
  private activeTouchDragTarget: TouchCanvasTarget | null = null;
  private lastTouchPointerEventMs = 0;
  private webglContextLostHandler: ((event: Event) => void) | null = null;
  private webglContextRestoredHandler: (() => void) | null = null;

  constructor(config: PixiStageConfig) {
    this.onAddToDeck = config.onAddToDeck;
    this.onRemoveFromDeck = config.onRemoveFromDeck;
    this.onTextureProgress = config.onTextureProgress;
    this.onBackgroundTextureProgress = config.onBackgroundTextureProgress;
    this.onSelectionChange = config.onSelectionChange;
    this.onCanvasLabelsChange = config.onCanvasLabelsChange;
    this.onLabelPlacementConsumed = config.onLabelPlacementConsumed;
    this.onHoveredCardChange = config.onHoveredCardChange;
    this.onCanvasAreasChange = config.onCanvasAreasChange;
    this.onStackZoneHeaderClick = config.onStackZoneHeaderClick;
    this.onViewportCenterChange = config.onViewportCenterChange;
    this.onDeckFilterRequest = config.onDeckFilterRequest;
    this.onCardDragDrop = config.onCardDragDrop;
    this.onCardsAddedToCanvasArea = config.onCardsAddedToCanvasArea;
    this.onDeckLayoutResetRequest = config.onDeckLayoutResetRequest;
    this.onQuickTransferCreateTarget = config.onQuickTransferCreateTarget;
    this.onDeckAddRequest = config.onDeckAddRequest;
    this.onCardCategoryScoreChange = config.onCardCategoryScoreChange;
    this.deckTransferTargets = config.deckTransferTargets ?? [];
    this.removeTextureInvalidationListener = lodManager.onTextureInvalidated(
      this.handleTextureInvalidated.bind(this),
    );

    this.app = new Application();
    this.cardContainer = new Container();
    this.cardContainer.sortableChildren = true;
    this.zoneContainer = new Container();
    this.zoneContainer.sortableChildren = true;
    this.zoneDropPreviewContainer = new Container();
    this.zoneDropPreviewContainer.sortableChildren = true;
    this.labelContainer = new Container();

    this.initialize(config.container);
  }

  private async initialize(container: HTMLElement): Promise<void> {
    if (this.isDestroyed) return;

    await this.app.init({
      background: MANGA_PALETTE.surface,
      resizeTo: container,
      antialias: true,
      resolution: getPixiCanvasResolution(),
      autoDensity: true,
      powerPreference: "high-performance",
    });

    if (this.isDestroyed) {
      this.app.destroy(
        { removeView: true },
        {
          children: true,
          texture: true,
          textureSource: true,
          context: true,
        },
      );
      return;
    }

    container.appendChild(this.app.canvas);

    // Register before the camera's horizontal-wheel capture listener so an
    // inspection blocks every gesture before it can move the canvas beneath it.
    this.app.canvas.addEventListener('wheel', this.handleInspectionWheel, { capture: true, passive: false });
    this.camera = new Camera({
      app: this.app,
      worldWidth: 100000,
      worldHeight: 50000,
      onZoomChange: this.handleZoomChange.bind(this),
      onViewportChange: this.handleViewportChange.bind(this),
    });

    // Create background grid graphics (behind cards)
    this.gridGraphics = new Graphics();
    this.camera.container.addChild(this.gridGraphics);
    this.quadrantGraphics = new Graphics();
    this.camera.container.addChild(this.quadrantGraphics);

    // Add card container
    this.camera.container.addChild(this.cardContainer);
    // Canvas areas always render above source cards.
    this.camera.container.addChild(this.zoneContainer);
    // Drop preview draws above zone visuals.
    this.camera.container.addChild(this.zoneDropPreviewContainer);

    // Add label container above cards
    this.camera.container.addChild(this.labelContainer);

    // Create selection box graphics (on top)
    this.selectionBox.graphics = new Graphics();
    this.camera.container.addChild(this.selectionBox.graphics);
    this.zoneDeleteOverlay = new Graphics();
    this.camera.container.addChild(this.zoneDeleteOverlay);
    this.quickTransferOverlay = new Graphics();
    this.quickTransferOverlay.zIndex = 9_999_995;
    this.app.stage.addChild(this.quickTransferOverlay);
    this.zoneDropPreviewOverlay = new Graphics();
    this.zoneDropPreviewContainer.addChild(this.zoneDropPreviewOverlay);

    window.addEventListener('resize', this.handleInspectionResize);
    this.setupPointerEvents();

    this.app.ticker.add(this.update.bind(this));

    this.isInitialized = true;
    this.onViewportCenterChange?.(this.camera.getScreenCenter());

    if (this.pendingCardSet) {
      this.cards = this.pendingCardSet.cards;
      this.catalogueCards = this.pendingCardSet.catalogueCards;
      this.catalogueLayout = this.pendingCardSet.catalogueLayout;
      this.pendingCardSet = null;
      // Reset reveal state left by any earlier empty reveal call so culling
      // inside rebuildCardSprites() doesn't prematurely preload textures.
      this.initialRevealCompleted = false;
      this.rebuildCardSprites();
      this.startTextureReveal();
    }
  }

  // ============================================================================
  // Grid Drawing
  // ============================================================================

  private drawGrid(): void {
    if (!this.gridGraphics || !this.camera) return;

    this.gridGraphics.clear();

    const bounds = this.camera.getVisibleBounds();

    const startX =
      Math.floor(bounds.left / DRAWN_GRID.width) * DRAWN_GRID.width;
    const startY =
      Math.floor(bounds.top / DRAWN_GRID.height) * DRAWN_GRID.height;
    const endX = Math.ceil(bounds.right / DRAWN_GRID.width) * DRAWN_GRID.width;
    const endY =
      Math.ceil(bounds.bottom / DRAWN_GRID.height) * DRAWN_GRID.height;

    for (let x = startX; x <= endX; x += DRAWN_GRID.width) {
      this.gridGraphics.moveTo(x, startY);
      this.gridGraphics.lineTo(x, endY);
    }

    for (let y = startY; y <= endY; y += DRAWN_GRID.height) {
      this.gridGraphics.moveTo(startX, y);
      this.gridGraphics.lineTo(endX, y);
    }

    this.gridGraphics.stroke({
      width: GRID_LINE.WIDTH,
      color: GRID_LINE.COLOR,
      alpha: GRID_LINE.ALPHA,
    });

    this.drawQuadrantGuides();
  }

  private drawQuadrantGuides(): void {
    if (!this.quadrantGraphics) return;

    this.quadrantGraphics.clear();
    for (const bounds of Object.values(QUADRANT_BOUNDS)) {
      this.quadrantGraphics.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      this.quadrantGraphics.stroke({
        width: 2,
        color: 0x56618e,
        alpha: 0.25,
      });
    }
  }

  // ============================================================================
  // Pointer Event Setup
  // ============================================================================

  private setupPointerEvents(): void {
    if (!this.camera) return;

    const viewport = this.camera.viewport;
    window.addEventListener("keydown", this.handlePanKeyDown);
    window.addEventListener("keyup", this.handlePanKeyUp);
    window.addEventListener("blur", this.handleCanvasBlur);
    viewport.eventMode = "static";

    viewport.on("pointerdown", this.onPointerDown.bind(this));
    viewport.on("pointermove", this.onPointerMove.bind(this));
    viewport.on("pointerup", this.onPointerUp.bind(this));
    // cspell:disable-next-line
    viewport.on("pointerupoutside", this.onPointerUp.bind(this));
    viewport.on("pointercancel", this.onPointerCancel.bind(this));
    viewport.on("pointerleave", () => {
      this.pendingCardClick = null;
      this.pendingZoneCardClick = null;
      this.clearQuickTransferHold();
      this.setHoveredCard(null);
      this.setStacksDropVisual(false);
      this.clearZoneDropPreview();
      this.hideDeckGraphHoverTooltip();
      this.deactivateQuickTransfer();
      this.lastPointerScreenPos = null;
      this.hoveredZoneCardKey = null;
      this.drawZoneDeleteOverlay();
    });

    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.webglContextLostHandler = (event: Event) => {
      event.preventDefault();
      console.warn("WebGL context lost — probably GPU memory pressure");
      this.highDetailPreloadQueued = false;
      this.onBackgroundTextureProgress?.(0, 0);
      lodManager.cancelQueuedAtlasLoads(LOD_LEVELS.THUMBNAIL);
      lodManager.cancelQueuedAtlasLoads(LOD_LEVELS.MEDIUM);
      lodManager.clearCache();
    };
    this.webglContextRestoredHandler = () => {
      console.warn("WebGL context restored — reload textures carefully");
      lodManager.clearCache();
      this.reloadVisibleTexturesAfterContextRestore();
      this.queueVisibleHighDetailPreload();
    };
    this.app.canvas.addEventListener(
      "webglcontextlost",
      this.webglContextLostHandler,
    );
    this.app.canvas.addEventListener(
      "webglcontextrestored",
      this.webglContextRestoredHandler,
    );
    this.app.canvas.addEventListener("pointerleave", () => {
      this.pendingCardClick = null;
      this.pendingZoneCardClick = null;
      this.clearQuickTransferHold();
      this.setHoveredCard(null);
      this.setStacksDropVisual(false);
      this.clearZoneDropPreview();
      this.hideDeckGraphHoverTooltip();
      this.deactivateQuickTransfer();
      this.lastPointerScreenPos = null;
      this.hoveredZoneCardKey = null;
      this.drawZoneDeleteOverlay();
    });
  }

  private isTouchPointer(event: FederatedPointerEvent): boolean {
    return isTouchLikePointerEvent(event);
  }

  private markTouchPointerEvent(): void {
    this.lastTouchPointerEventMs = Date.now();
  }

  private shouldIgnorePostTouchMouseEvent(event: FederatedPointerEvent): boolean {
    return isSyntheticMouseAfterTouch(
      event,
      this.lastTouchPointerEventMs,
      Date.now(),
      SYNTHETIC_MOUSE_AFTER_TOUCH_MS,
    );
  }

  private toTouchPoint(event: FederatedPointerEvent): TouchGesturePoint {
    return {
      pointerId: event.pointerId,
      x: event.globalX,
      y: event.globalY,
      timeMs: Date.now(),
    };
  }

  private getClientPosition(event: FederatedPointerEvent): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return {
      x: rect.left + event.globalX,
      y: rect.top + event.globalY,
    };
  }

  private getPointerScreenPosition(event: FederatedPointerEvent): {
    x: number;
    y: number;
  } {
    return { x: event.globalX, y: event.globalY };
  }

  private movedBeyondDesktopClickSlop(
    start: { x: number; y: number },
    current: { x: number; y: number },
  ): boolean {
    return Math.hypot(current.x - start.x, current.y - start.y) > DESKTOP_CLICK_SLOP_PX;
  }

  private handlePendingCardClick(
    pending: PendingCardClickState,
    worldPos: { x: number; y: number },
  ): void {
    this.clearZoneSelection();
    const now = Date.now();
    const isDoubleClick =
      now - this.lastClickTime < DOUBLE_CLICK_TIME_MS &&
      this.lastClickedCard === pending.cardKey;

    this.lastClickTime = now;
    this.lastClickedCard = pending.cardKey;

    if (isDoubleClick) {
      const data = this.getSpriteData(pending.cardKey);
      const cardName = data?.layout.name ?? pending.cardKey;
      if (this.selectedCardCategoryId && this.cardCategoryData) {
        this.handleCardCategoryDoubleClick(cardName, data?.bounds, worldPos);
      } else {
        this.onAddToDeck(cardName);
      }
      return;
    }

    this.selectMainCardForPointer(pending.cardKey, pending.shiftKey);
  }

  private selectMainCardForPointer(key: string, additive: boolean, dragging = false): void {
    const data = this.getSpriteData(key);
    const stack = (data ? this.cardStacks.get(data.gridKey) : null) ?? [key];
    const keys = getCardClickSelection({
      clickedKey: key,
      stackKeys: stack.filter((entry) => this.getSpriteData(entry)?.sprite.visible),
      selectedKeys: this.selectedCards,
      additive,
      dragging,
    });
    this.clearSelection(true);
    for (const selectedKey of keys) this.selectCard(selectedKey, true);
    this.emitSelectionChange();
  }

  private selectZoneCardForPointer(key: string, additive: boolean, doubleClick = false, dragging = false): void {
    const data = this.zoneCardSprites.get(key);
    const zone = this.canvasAreas.find((entry) => entry.id === data?.zoneId);
    const instance = zone?.cards.find((entry) => entry.id === data?.instanceId);
    if (!data || !zone || !instance) return;
    const stackKey = this.getZoneCardStackKey(zone, instance);
    const stackKeys = zone.cards
      .filter((card) => this.getZoneCardStackKey(zone, card) === stackKey)
      .map((card) => `${zone.id}:${card.id}`)
      .filter((cardKey) => this.zoneCardSprites.has(cardKey));
    const keys = getCardClickSelection({
      clickedKey: key,
      stackKeys,
      selectedKeys: additive || dragging || this.selectedZoneId === zone.id ? this.selectedZoneCardKeys : new Set(),
      additive,
      doubleClick,
      dragging,
    });
    this.clearSelection(true);
    for (const selectedKey of keys) this.selectZoneCard(selectedKey);
    this.emitSelectionChange();
  }

  private handlePendingZoneCardClick(pending: PendingZoneCardClickState): void {
    const zoneCard = this.zoneCardSprites.get(pending.zoneCardKey);
    if (!zoneCard) return;
    const now = Date.now();
    const isDoubleClick = now - this.lastZoneCardClickTime < DOUBLE_CLICK_TIME_MS &&
      this.lastClickedZoneCardKey === zoneCard.key;
    this.lastZoneCardClickTime = now;
    this.lastClickedZoneCardKey = zoneCard.key;
    this.selectZoneCardForPointer(zoneCard.key, pending.shiftKey, isDoubleClick);

    // Keep variant editing available without conflicting with stack selection.
    if (isDoubleClick && pending.altKey) {
      const zone = this.canvasAreas.find((entry) => entry.id === zoneCard.zoneId);
      if (zone?.type === "deck" && this.toggleDeckZoneCardActive(zone.id, zoneCard.instanceId)) {
        this.rebuildZoneVisuals();
        this.emitCanvasAreasChange();
      }
    }
  }

  private captureTouchPointer(event: FederatedPointerEvent): void {
    try {
      this.app.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Some browsers already apply implicit capture for touch pointers.
    }
  }

  private releaseTouchPointer(event: FederatedPointerEvent): void {
    try {
      if (this.app.canvas.hasPointerCapture(event.pointerId)) {
        this.app.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore capture release races after pointercancel/pointerup.
    }
  }

  private getTouchTarget(worldPos: { x: number; y: number }): TouchCanvasTarget {
    const variantTab = this.getZoneVariantTabTargetAtPosition(worldPos);
    if (variantTab) {
      return {
        kind: "zone-variant-tab",
        key: `zone-variant-tab:${variantTab.zone.id}:${variantTab.isAdd ? "add" : variantTab.variantId}`,
        zoneId: variantTab.zone.id,
        variantId: variantTab.variantId,
        isAdd: variantTab.isAdd,
      };
    }

    const sortTarget = this.getZoneSortTargetAtPosition(worldPos);
    if (sortTarget) {
      return {
        kind: "zone-sort",
        key: `zone-sort:${sortTarget.id}`,
        zoneId: sortTarget.id,
      };
    }

    const filterChip = this.getDeckFilterChipTargetAtPosition(worldPos);
    if (filterChip) {
      return {
        kind: "deck-filter-chip",
        key: `deck-filter-chip:${filterChip.zone.id}:${filterChip.clauseIndex}:${filterChip.removeHovered}`,
        zoneId: filterChip.zone.id,
        clauseIndex: filterChip.clauseIndex,
        removeHovered: filterChip.removeHovered,
      };
    }

    const filterTarget = this.getZoneFilterTargetAtPosition(worldPos);
    if (filterTarget) {
      return {
        kind: "zone-filter",
        key: `zone-filter:${filterTarget.id}`,
        zoneId: filterTarget.id,
      };
    }

    const closeTarget = this.getZoneCloseTargetAtPosition(worldPos);
    if (closeTarget) {
      return {
        kind: "zone-close",
        key: `zone-close:${closeTarget.id}`,
        zoneId: closeTarget.id,
      };
    }

    const zoneCard = this.getZoneCardAtPosition(worldPos);
    if (zoneCard) {
      return {
        kind: "zone-card",
        key: `zone-card:${zoneCard.key}`,
        zoneCardKey: zoneCard.key,
        zoneId: zoneCard.zoneId,
        instanceId: zoneCard.instanceId,
        cardName: zoneCard.cardName,
        cardType: zoneCard.cardType,
      };
    }

    const labelId = this.getLabelAtPosition(worldPos);
    if (labelId) {
      return {
        kind: "label",
        key: `label:${labelId}`,
        labelId,
      };
    }

    const zoneHeader = this.getZoneHeaderAtPosition(worldPos);
    if (zoneHeader) {
      return {
        kind: "zone-header",
        key: `zone-header:${zoneHeader.id}`,
        zoneId: zoneHeader.id,
      };
    }

    const cardKey = this.getCardAtPosition(worldPos);
    if (cardKey) {
      const data = this.getSpriteData(cardKey);
      return {
        kind: "card",
        key: `card:${cardKey}`,
        cardKey,
        cardName: data?.layout.name ?? cardKey,
        cardType: data?.layout.type ?? null,
      };
    }

    const zone = this.getZoneAtPosition(worldPos);
    if (zone) {
      return {
        kind: "zone",
        key: `zone:${zone.id}`,
        zoneId: zone.id,
      };
    }

    return { kind: "empty", key: "empty" };
  }

  private onTouchPointerDown(event: FederatedPointerEvent): void {
    if (!this.camera) return;

    this.markTouchPointerEvent();
    this.cancelSelectionBox();
    this.pointerDownOnSelectedCard = false;
    this.closeTouchActionSheet();
    this.captureTouchPointer(event);

    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);
    this.lastPointerScreenPos = { x: event.globalX, y: event.globalY };
    this.clearZoneDropPreview();
    this.setStacksDropVisual(false);

    const target = this.getTouchTarget(worldPos);
    const wasLongPressed = this.touchGestures.isLongPressed();
    this.touchGestures.start(this.toTouchPoint(event), target, (gesture) => {
      this.onTouchLongPressStart(gesture);
    });
    if (wasLongPressed && !this.touchGestures.isLongPressed()) {
      this.cancelActiveTouchDrag();
      this.camera.resumeDrag();
    }
  }

  private onTouchPointerMove(event: FederatedPointerEvent): void {
    if (!this.camera || !this.touchGestures.isTrackingPointer(event.pointerId)) return;

    this.markTouchPointerEvent();
    this.cancelSelectionBox();
    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);
    this.lastPointerScreenPos = { x: event.globalX, y: event.globalY };
    const move = this.touchGestures.move(this.toTouchPoint(event));

    if (this.quickTransferState.active && this.dragState.isDragging) {
      this.setStacksDropVisual(false);
      this.clearZoneDropPreview();
      this.updateCardDrag(worldPos);
      this.updateQuickTransferHover({ x: event.globalX, y: event.globalY });
      return;
    }

    if (move.type === "pan-start") {
      this.setHoveredCard(null);
      this.hoveredZoneCardKey = null;
      this.drawZoneDeleteOverlay();
      return;
    }

    if (move.type === "drag-start") {
      this.startTouchDrag(move.gesture);
      this.updateActiveTouchDrag(worldPos, { x: event.globalX, y: event.globalY });
      return;
    }

    if (move.type === "drag-move") {
      this.updateActiveTouchDrag(worldPos, { x: event.globalX, y: event.globalY });
    }
  }

  private onTouchPointerUp(event: FederatedPointerEvent): void {
    if (!this.camera || !this.touchGestures.isTrackingPointer(event.pointerId)) {
      this.markTouchPointerEvent();
      this.cancelSelectionBox();
      this.releaseTouchPointer(event);
      return;
    }

    this.markTouchPointerEvent();
    this.cancelSelectionBox();
    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);
    const screenPos = { x: event.globalX, y: event.globalY };
    const clientPos = this.getClientPosition(event);
    this.lastPointerScreenPos = screenPos;
    this.clearZoneDropPreview();

    const release = this.touchGestures.release(this.toTouchPoint(event));
    this.releaseTouchPointer(event);

    if (this.quickTransferState.active) {
      this.completeQuickTransferDrop(worldPos, screenPos);
      this.camera.resumeDrag();
      this.activeTouchDragTarget = null;
      this.pointerDownOnSelectedCard = false;
      this.setStacksDropVisual(false);
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    if (release.type === "tap") {
      this.handleTouchTap(release.target, worldPos, screenPos, release.isDoubleTap);
    } else if (release.type === "action") {
      this.cancelActiveTouchDrag();
      this.showTouchActionSheet(release.target, clientPos.x, clientPos.y);
    } else if (release.type === "drag-end") {
      this.finishActiveTouchDrag(worldPos, screenPos);
    }

    this.camera.resumeDrag();
    this.activeTouchDragTarget = null;
    this.pointerDownOnSelectedCard = false;
    this.setStacksDropVisual(false);
    this.updateHoveredFromWorldPos(worldPos);
  }

  private onPointerCancel(event: FederatedPointerEvent): void {
    this.pendingCardClick = null;
    this.pendingZoneCardClick = null;
    this.clearQuickTransferHold();
    if (this.isTouchPointer(event)) {
      this.markTouchPointerEvent();
      this.touchGestures.cancel();
      this.cancelActiveTouchDrag();
      this.cancelSelectionBox();
      this.releaseTouchPointer(event);
      this.camera?.resumeDrag();
      this.activeTouchDragTarget = null;
      this.pointerDownOnSelectedCard = false;
      this.setStacksDropVisual(false);
      this.clearZoneDropPreview();
      this.deactivateQuickTransfer();
      return;
    }

    this.cancelDesktopInteraction();
    this.setStacksDropVisual(false);
    this.clearZoneDropPreview();
    this.deactivateQuickTransfer();
  }

  private onTouchLongPressStart(
    gesture: TouchGestureSnapshot<TouchCanvasTarget>,
  ): void {
    if (!this.camera) return;
    if (gesture.target.kind === "empty") return;
    if (gesture.target.kind === "card") {
      const worldPos = this.camera.screenToWorld(gesture.current.x, gesture.current.y);
      this.activeTouchDragTarget = gesture.target;
      this.beginQuickTransferDrag(gesture.target.cardKey, worldPos, {
        x: gesture.current.x,
        y: gesture.current.y,
      });
      return;
    }
    this.camera.pauseDrag();
    this.activeTouchDragTarget = gesture.target;
    this.updateTouchSelectionPreview(gesture.target);
  }

  private handleTouchTap(
    target: TouchCanvasTarget,
    worldPos: { x: number; y: number },
    screenPos: { x: number; y: number },
    isDoubleTap: boolean,
  ): void {
    this.cancelSelectionBox();

    if (this.handleTouchControlTap(target, worldPos)) {
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    if (this.labelPlacementMode) {
      this.addLabelAtPosition(worldPos);
      this.consumeLabelPlacementMode();
      return;
    }

    if (target.kind === "label") {
      if (isDoubleTap) {
        this.editLabel(target.labelId);
      }
      return;
    }

    if (target.kind === "zone-card") {
      const actionCard = this.zoneCardSprites.get(target.zoneCardKey);
      if (actionCard && this.pointInBounds(worldPos, this.getDeleteButtonBounds(actionCard))) {
        this.handleZoneCardDelete(actionCard, screenPos.x, screenPos.y);
        return;
      }
      this.clearMainSelection(true);
      if (this.selectedZoneId !== target.zoneId) {
        this.clearZoneSelection();
      }
      if (!this.selectedZoneCardKeys.has(target.zoneCardKey)) {
        this.clearZoneSelection();
        this.selectZoneCard(target.zoneCardKey);
      }
      this.emitSelectionChange();

      if (isDoubleTap) {
        const zone = this.canvasAreas.find((entry) => entry.id === target.zoneId);
        if (zone?.type === "deck") {
          const changed = this.toggleDeckZoneCardActive(target.zoneId, target.instanceId);
          if (changed) {
            this.rebuildZoneVisuals();
            this.emitCanvasAreasChange();
          }
        } else {
          this.duplicateCanvasCardInstance(target.zoneId, target.instanceId);
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
        }
      }
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    if (target.kind === "zone-header") {
      this.clearSelection();
      const zone = this.canvasAreas.find((entry) => entry.id === target.zoneId);
      if (zone?.type === "stack") {
        this.onStackZoneHeaderClick?.(zone.id);
      }
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    if (target.kind === "zone") {
      this.clearSelection();
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    if (target.kind === "card") {
      this.clearZoneSelection();
      if (isDoubleTap) {
        if (this.selectedCardCategoryId && this.cardCategoryData) {
          const data = this.getSpriteData(target.cardKey);
          this.handleCardCategoryDoubleClick(target.cardName, data?.bounds, worldPos);
        } else {
          this.onAddToDeck(target.cardName);
        }
        this.updateHoveredFromWorldPos(worldPos);
        return;
      }

      this.clearSelection(true);
      this.selectCard(target.cardKey, true);
      this.emitSelectionChange();
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    this.clearSelection();
    this.setHoveredCard(null);
    this.hoveredZoneCardKey = null;
    this.drawZoneDeleteOverlay();
    this.lastPointerScreenPos = screenPos;
  }

  private handleTouchControlTap(
    target: TouchCanvasTarget,
    worldPos: { x: number; y: number },
  ): boolean {
    if (target.kind === "zone-variant-tab") {
      if (target.isAdd) {
        void this.createDeckZoneVariant(target.zoneId).then((changed) => {
          if (!changed || this.isDestroyed) return;
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
        });
      } else if (target.variantId) {
        const changed = this.setActiveDeckZoneVariant(target.zoneId, target.variantId);
        if (changed) {
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
        }
      }
      return true;
    }

    if (target.kind === "zone-sort") {
      this.requestZoneLayoutReset(target.zoneId);
      return true;
    }

    if (target.kind === "deck-filter-chip") {
      if (target.removeHovered) {
        const changed = this.removeDeckFilterClause(target.zoneId, target.clauseIndex);
        if (changed) {
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
        }
      } else {
        this.openDeckFilterRequest(target.zoneId, target.clauseIndex);
      }
      return true;
    }

    if (target.kind === "zone-filter") {
      this.openDeckFilterRequest(target.zoneId, null);
      return true;
    }

    if (target.kind === "zone-close") {
      this.hideZoneFromCanvas(target.zoneId);
      return true;
    }

    if (target.kind === "zone-card") {
      const zoneCard = this.zoneCardSprites.get(target.zoneCardKey);
      if (
        zoneCard &&
        this.hoveredZoneCardKey === zoneCard.key &&
        this.pointInBounds(worldPos, this.getDeleteButtonBounds(zoneCard))
      ) {
        const screen = this.lastPointerScreenPos ?? { x: worldPos.x, y: worldPos.y };
        const rect = this.app.canvas.getBoundingClientRect();
        this.handleZoneCardDelete(zoneCard, rect.left + screen.x, rect.top + screen.y);
        return true;
      }
    }

    return false;
  }

  private updateTouchSelectionPreview(target: TouchCanvasTarget): void {
    if (target.kind === "card") {
      this.clearZoneSelection();
      if (!this.selectedCards.has(target.cardKey)) {
        this.clearSelection(true);
        this.selectCard(target.cardKey, true);
        this.emitSelectionChange();
      }
      this.setHoveredCard(target.cardName);
      return;
    }

    if (target.kind === "zone-card") {
      this.clearMainSelection(true);
      if (
        this.selectedZoneId !== target.zoneId ||
        !this.selectedZoneCardKeys.has(target.zoneCardKey)
      ) {
        this.clearZoneSelection();
        this.selectZoneCard(target.zoneCardKey);
        this.emitSelectionChange();
      }
      this.setHoveredCard(target.cardName);
    }
  }

  private startTouchDrag(gesture: TouchGestureSnapshot<TouchCanvasTarget>): void {
    if (!this.camera) return;

    const target = gesture.target;
    const startWorldPos = this.camera.screenToWorld(gesture.start.x, gesture.start.y);
    this.activeTouchDragTarget = target;
    this.camera.pauseDrag();

    if (target.kind === "card") {
      this.clearZoneSelection();
      if (!this.selectedCards.has(target.cardKey)) {
        this.clearSelection(true);
        this.selectCard(target.cardKey, true);
        this.emitSelectionChange();
      }
      this.pointerDownOnSelectedCard = true;
      this.startCardDrag(startWorldPos);
      return;
    }

    if (target.kind === "zone-card") {
      const zoneCard = this.zoneCardSprites.get(target.zoneCardKey);
      if (!zoneCard) return;
      this.clearMainSelection(true);
      if (
        this.selectedZoneId !== target.zoneId ||
        !this.selectedZoneCardKeys.has(target.zoneCardKey)
      ) {
        this.clearZoneSelection();
        this.selectZoneCard(target.zoneCardKey);
        this.emitSelectionChange();
      }
      this.startZoneCardDrag(zoneCard, startWorldPos);
      return;
    }

    if (target.kind === "zone-header") {
      this.startZoneDrag(target.zoneId, startWorldPos);
      return;
    }

    if (target.kind === "label") {
      this.startLabelDrag(target.labelId, startWorldPos);
    }
  }

  private updateActiveTouchDrag(
    worldPos: { x: number; y: number },
    screenPos: { x: number; y: number },
  ): void {
    if (!this.activeTouchDragTarget) return;

    if (this.labelDragState.isDragging) {
      this.clearZoneDropPreview();
      this.updateLabelDrag(worldPos);
      return;
    }

    if (this.zoneDragState.isDragging) {
      this.clearZoneDropPreview();
      this.updateZoneDrag(worldPos);
      return;
    }

    if (this.zoneCardDragState.isDragging) {
      this.clearZoneDropPreview();
      this.updateZoneCardDrag(worldPos);
      return;
    }

    if (!this.dragState.isDragging || !this.pointerDownOnSelectedCard) return;

    const rect = this.app.canvas.getBoundingClientRect();
    const clientX = rect.left + screenPos.x;
    const clientY = rect.top + screenPos.y;
    const overStacksPanel = this.isPointInsideOpenStacksPanel(clientX, clientY);

    this.setStacksDropVisual(overStacksPanel);
    if (overStacksPanel) {
      this.clearZoneDropPreview();
      return;
    }

    this.updateCardDrag(worldPos);
    const hoveredZone = this.getZoneAtPosition(worldPos);
    this.updateZoneDropPreview(
      hoveredZone,
      worldPos,
      this.getDraggedCardPlacements(),
    );
  }

  private finishActiveTouchDrag(
    worldPos: { x: number; y: number },
    screenPos: { x: number; y: number },
  ): void {
    if (this.labelDragState.isDragging) {
      this.endLabelDrag();
      return;
    }

    if (this.zoneCardDragState.isDragging) {
      this.endZoneCardDrag(worldPos);
      return;
    }

    if (this.zoneDragState.isDragging) {
      this.endZoneDrag(worldPos);
      return;
    }

    if (!this.dragState.isDragging) return;

    const rect = this.app.canvas.getBoundingClientRect();
    const clientX = rect.left + screenPos.x;
    const clientY = rect.top + screenPos.y;
    const draggedPlacements = this.getDraggedCardPlacements();
    const droppedInStacksTarget = this.isPointInsideStacksDropTarget(clientX, clientY);
    const domDropTarget = droppedInStacksTarget
      ? this.getCanvasDomDropTarget(clientX, clientY)
      : null;
    const draggedCardNames = this.getDraggedCardNames();
    const droppedZone = this.getZoneAtPosition(worldPos);
    const shouldDropToStackTarget =
      domDropTarget?.type === "stack" &&
      !!domDropTarget.zoneId &&
      draggedCardNames.length > 0;
    const shouldDropToDeckTarget =
      domDropTarget?.type === "deck" &&
      !!domDropTarget.deckId &&
      draggedCardNames.length > 0;
    const shouldDropToCanvasZone =
      !droppedInStacksTarget && !!droppedZone && draggedCardNames.length > 0;

    if (shouldDropToCanvasZone && droppedZone) {
      this.addDraggedCardsToZoneOrRequestDeck(
        droppedZone,
        draggedCardNames,
        worldPos,
        screenPos,
        draggedPlacements,
        "canvas-zone",
      );
    }

    this.endCardDrag(true);

    if (shouldDropToStackTarget && domDropTarget?.zoneId) {
      this.copyCardsIntoZone(domDropTarget.zoneId, draggedCardNames, worldPos, {
        useZonePlacement: true,
        placements: draggedPlacements,
      });
    } else if (shouldDropToDeckTarget && domDropTarget?.deckId) {
      this.requestDeckAdd({
        deckId: domDropTarget.deckId,
        canvasAreaId: domDropTarget.zoneId,
        cardNames: draggedCardNames,
        placements: draggedPlacements,
        worldPos,
        screenPos,
        source: "side-rail",
      });
    } else if (
      droppedInStacksTarget &&
      !shouldDropToCanvasZone &&
      draggedCardNames.length > 0 &&
      this.onCardDragDrop
    ) {
      this.onCardDragDrop({
        cardNames: draggedCardNames,
        clientX,
        clientY,
      });
    }
  }

  private cancelActiveTouchDrag(): void {
    this.cancelDesktopInteraction();
    this.activeTouchDragTarget = null;
    this.pointerDownOnSelectedCard = false;
    this.clearZoneDropPreview();
    this.setStacksDropVisual(false);
  }

  private setHoveredCard(cardName: string | null): void {
    if (this.hoveredCardName === cardName) return;
    this.hoveredCardName = cardName;
    if (cardName) {
      this.prioritizeHoveredCardHighDetail(cardName);
    }
    this.onHoveredCardChange?.(cardName);
  }

  private prioritizeHoveredCardHighDetail(cardName: string): void {
    if (isConstrainedTextureDevice()) return;

    void lodManager
      .preloadTextures([cardName], {
        lod: lodManager.getInteractiveDetailLOD(),
        concurrentLoads: 1,
        batchSize: 1,
      })
      .catch(() => null)
      .finally(() => {
        this.pruneFullTextureCache();
      });
  }

  private handleTextureInvalidated(invalidation: LODTextureInvalidation): void {
    const invalidatedSlugs = new Set(invalidation.slugs);

    for (const data of this.cardSprites.values()) {
      if (invalidatedSlugs.has(data.sprite.imageSlug)) {
        data.sprite.releaseTextureForLOD(invalidation.lod);
      }
    }
    for (const data of this.deckSprites.values()) {
      if (invalidatedSlugs.has(data.sprite.imageSlug)) {
        data.sprite.releaseTextureForLOD(invalidation.lod);
      }
    }
    for (const sprite of this.getCanvasAreaCardSprites()) {
      if (invalidatedSlugs.has(sprite.imageSlug)) {
        sprite.releaseTextureForLOD(invalidation.lod);
      }
    }
  }

  private getRenderResolution(): number {
    return getPixiTextResolution();
  }

  private configureTextQuality<T extends Text>(text: T): T {
    text.resolution = this.getRenderResolution();
    text.roundPixels = true;
    return text;
  }

  private getOpenStacksPanelElement(): HTMLElement | null {
    const element = document.querySelector(".stacks-panel.open");
    return element instanceof HTMLElement ? element : null;
  }

  private getStacksDropTargetAtPoint(clientX: number, clientY: number): Element | null {
    const target = document.elementFromPoint(clientX, clientY);
    if (!(target instanceof Element)) return null;

    return target.closest(
      ".stacks-panel.open, .stack-tab, .stack-tab-add, .deck-tab, [data-canvas-drop-zone-id], [data-canvas-drop-deck-id]",
    );
  }

  private isPointInsideStacksDropTarget(clientX: number, clientY: number): boolean {
    return this.getStacksDropTargetAtPoint(clientX, clientY) !== null;
  }

  private isPointInsideOpenStacksPanel(clientX: number, clientY: number): boolean {
    const dropTarget = this.getStacksDropTargetAtPoint(clientX, clientY);
    return dropTarget instanceof HTMLElement && dropTarget.classList.contains("stacks-panel");
  }

  private getCanvasDomDropTarget(clientX: number, clientY: number): CanvasDomDropTarget {
    const dropTarget = this.getStacksDropTargetAtPoint(clientX, clientY);
    if (!(dropTarget instanceof HTMLElement)) {
      return { type: null, zoneId: null, deckId: null };
    }

    const target = dropTarget.closest(
      "[data-stack-area-id], [data-canvas-drop-zone-id], [data-canvas-drop-deck-id]",
    );
    if (!(target instanceof HTMLElement)) {
      return { type: null, zoneId: null, deckId: null };
    }

    const zoneId = target.dataset.canvasDropZoneId ?? target.dataset.stackAreaId ?? null;
    const deckId = target.dataset.canvasDropDeckId ?? null;
    const requestedType = target.dataset.canvasDropZoneType;

    if (zoneId) {
      const matching = this.canvasAreas.find(
        (zone) => zone.id === zoneId && (zone.type === "stack" || zone.type === "deck"),
      );
      if (matching) {
        return {
          type: matching.type,
          zoneId: matching.id,
          deckId: matching.type === "deck" ? matching.deckId ?? deckId : null,
        };
      }
    }

    if (requestedType === "deck" && deckId) {
      return { type: "deck", zoneId: null, deckId };
    }

    return { type: null, zoneId: null, deckId: null };
  }

  private setStacksDropVisual(active: boolean): void {
    if (this.stacksDropVisualActive === active) return;
    this.stacksDropVisualActive = active;

    const panel = this.getOpenStacksPanelElement();
    if (!panel) return;
    panel.classList.toggle("drop-ready", active);
  }

  private resetQuickTransferState(): void {
    this.quickTransferState = {
      active: false,
      anchorScreenPos: null,
      categoryHover: null,
      categoryHoverStartMs: 0,
      expandedCategory: null,
      zoneHoverId: null,
      categoryBounds: [],
      zoneBounds: [],
    };
  }

  private clearQuickTransferOverlay(): void {
    this.quickTransferOverlay?.clear();
    for (const text of this.quickTransferOverlayTexts) {
      text.destroy();
    }
    this.quickTransferOverlayTexts = [];
    this.quickTransferState.categoryBounds = [];
    this.quickTransferState.zoneBounds = [];
  }

  private deactivateQuickTransfer(): void {
    this.clearQuickTransferOverlay();
    this.resetQuickTransferState();
    this.quickTransferLastTickMs = 0;
  }

  private addQuickTransferText(
    text: string,
    options: {
      x: number;
      y: number;
      maxWidth: number;
      fill: number;
      fontSize?: number;
      bold?: boolean;
      strokeWidth?: number;
    },
  ): Text {
    const label = new Text({
      text,
      style: {
        fontFamily: "Arial",
        fontSize: options.fontSize ?? 11,
        fill: options.fill,
        fontWeight: options.bold ? "800" : "700",
        stroke: { color: 0x000000, width: options.strokeWidth ?? 2 },
      },
    });
    this.configureTextQuality(label);
    label.alpha = 1;
    label.zIndex = 10_000_001;
    label.eventMode = "none";
    label.x = Math.round(options.x);
    label.y = Math.round(options.y);
    while (label.width > options.maxWidth && label.text.length > 4) {
      label.text = `${label.text.slice(0, -4).trimEnd()}...`;
    }
    this.quickTransferOverlayTexts.push(label);
    this.app.stage.addChild(label);
    return label;
  }

  private getQuickTransferTargets(category: QuickTransferCategory): QuickTransferTargetRow[] {
    if (category === "deck") {
      return this.deckTransferTargets
        .map((target) => ({
          id: target.id,
          label: target.label.trim() || "Deck",
          zoneId: target.canvasAreaId ?? null,
          deckId: target.deckId,
          isCreate: false,
        }))
        .sort((left, right) => left.label.localeCompare(right.label));
    }

    return this.canvasAreas
      .filter((zone) => zone.type === "stack")
      .map((zone) => ({
        id: zone.id,
        label: zone.name.trim() || "(Unnamed)",
        zoneId: zone.id,
        deckId: null,
        isCreate: false,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  private getQuickTransferCategoryAtPosition(
    screenPos: { x: number; y: number },
  ): QuickTransferCategory | null {
    for (const entry of this.quickTransferState.categoryBounds) {
      if (this.pointInBounds(screenPos, entry.bounds)) {
        return entry.category;
      }
    }
    return null;
  }

  private getQuickTransferZoneAtPosition(
    screenPos: { x: number; y: number },
  ): QuickTransferCanvasAreaBounds | null {
    for (const entry of this.quickTransferState.zoneBounds) {
      if (this.pointInBounds(screenPos, entry.bounds)) {
        return entry;
      }
    }
    return null;
  }

  private drawQuickTransferOverlay(
    screenPos: { x: number; y: number },
    nowMs = performance.now(),
  ): void {
    const overlay = this.quickTransferOverlay;
    if (!overlay) return;

    this.clearQuickTransferOverlay();
    if (!this.quickTransferState.active) return;

    const view = {
      left: 0,
      top: 0,
      right: this.app.screen.width,
      bottom: this.app.screen.height,
    };
    const categoryWidth = QUICK_TRANSFER_CATEGORY_WIDTH;
    const boxHeight = QUICK_TRANSFER_BOX_HEIGHT;
    const zoneWidth = QUICK_TRANSFER_ZONE_WIDTH;
    const gap = QUICK_TRANSFER_GAP;
    const edgePadding = QUICK_TRANSFER_EDGE_PADDING;
    const cornerRadius = 7;
    const borderWidth = 1;
    const textInsetX = 8;
    const textInsetY = 6;
    const holdInset = 4;
    const holdHeight = 2;
    const titleFontSize = 12;
    const rowFontSize = 10;
    const textStrokeWidth = 2;

    const pairWidth =
      categoryWidth * 2 + gap * 3;
    let stackLeft =
      screenPos.x - categoryWidth - gap;
    let deckLeft = screenPos.x + gap;
    const minLeft = view.left + edgePadding;
    const maxRight = view.right - edgePadding;
    const currentLeft = stackLeft;
    const currentRight = deckLeft + categoryWidth;
    if (currentLeft < minLeft) {
      const shift = minLeft - currentLeft;
      stackLeft += shift;
      deckLeft += shift;
    } else if (currentRight > maxRight) {
      const shift = currentRight - maxRight;
      stackLeft -= shift;
      deckLeft -= shift;
    }

    const minPairLeft = view.left + edgePadding;
    const maxPairLeft = view.right - edgePadding - pairWidth;
    const pairLeft = Math.max(minPairLeft, Math.min(stackLeft - gap, maxPairLeft));
    stackLeft = pairLeft + gap;
    deckLeft = stackLeft + categoryWidth + gap;

    const top = Math.max(
      view.top + edgePadding,
      Math.min(
        screenPos.y - 72,
        view.bottom -
          edgePadding -
          boxHeight,
      ),
    );

    const categories: Array<{
      category: QuickTransferCategory;
      label: string;
      left: number;
    }> = [
      {
        category: "stack",
        label: "Stacks",
        left: stackLeft,
      },
      {
        category: "deck",
        label: "Decks",
        left: deckLeft,
      },
    ];

    categories.forEach((entry) => {
      const left = entry.left;
      const right = left + categoryWidth;
      const bottom = top + boxHeight;
      const isExpanded = this.quickTransferState.expandedCategory === entry.category;
      const isHover = this.quickTransferState.categoryHover === entry.category;
      const hoverElapsed = isHover
        ? Math.max(0, nowMs - this.quickTransferState.categoryHoverStartMs)
        : 0;
      const holdProgress =
        isExpanded || this.quickTransferState.expandedCategory === entry.category
          ? 1
          : Math.min(1, hoverElapsed / QUICK_TRANSFER_HOLD_MS);

      overlay.roundRect(
        left,
        top,
        categoryWidth,
        boxHeight,
        cornerRadius,
      );
      overlay.fill({
        color: isExpanded
          ? QUICK_TRANSFER_COLORS.activeFill
          : isHover
            ? QUICK_TRANSFER_COLORS.hoverFill
            : QUICK_TRANSFER_COLORS.baseFill,
        alpha: 1,
      });
      overlay.stroke({
        width: borderWidth,
        color: isExpanded
          ? QUICK_TRANSFER_COLORS.activeBorder
          : QUICK_TRANSFER_COLORS.baseBorder,
        alpha: 1,
      });

      if (isHover && !isExpanded && holdProgress > 0) {
        const progressWidth = Math.max(
          borderWidth,
          (categoryWidth - holdInset * 2) * holdProgress,
        );
        overlay.roundRect(
          left + holdInset,
          bottom - holdInset,
          progressWidth,
          holdHeight,
          holdHeight / 2,
        );
        overlay.fill({ color: 0xd4d6ff, alpha: 1 });
      }

      this.quickTransferState.categoryBounds.push({
        category: entry.category,
        bounds: { left, top, right, bottom },
      });

      const text = this.addQuickTransferText(entry.label, {
        x: left + textInsetX,
        y: top + textInsetY,
        maxWidth: categoryWidth - textInsetX * 2,
        fill: isExpanded
          ? QUICK_TRANSFER_COLORS.activeText
          : isHover
            ? QUICK_TRANSFER_COLORS.hoverText
            : QUICK_TRANSFER_COLORS.baseText,
        fontSize: titleFontSize,
        bold: true,
        strokeWidth: textStrokeWidth,
      });
      text.x = left + (categoryWidth - text.width) / 2;
    });

    const expandedCategory = this.quickTransferState.expandedCategory;
    if (!expandedCategory) return;

    const zoneTargets = this.getQuickTransferTargets(expandedCategory);
    const expandedCategoryLeft =
      categories.find((entry) => entry.category === expandedCategory)?.left ??
      (expandedCategory === "stack"
        ? view.left + edgePadding
        : view.right - edgePadding - categoryWidth);
    const zoneTop = top + boxHeight + gap;
    const zoneLeftRaw =
      expandedCategory === "deck"
        ? expandedCategoryLeft + categoryWidth - zoneWidth
        : expandedCategoryLeft;
    const zoneLeft = Math.max(
      view.left + edgePadding,
      Math.min(
        zoneLeftRaw,
        view.right - edgePadding - zoneWidth,
      ),
    );
    const maxRows = Math.max(
      1,
      Math.floor(
        (view.bottom - edgePadding - zoneTop + gap) /
          (boxHeight + gap),
      ),
    );
    const targetRows: QuickTransferTargetRow[] = [
      {
        id: `create:${expandedCategory}`,
        label: expandedCategory === "deck" ? "+ New deck" : "+ New stack",
        zoneId: null,
        deckId: null,
        isCreate: true,
      },
      ...zoneTargets,
    ];
    const visibleTargets = targetRows.slice(0, maxRows);

    visibleTargets.forEach((target, index) => {
      const topY = zoneTop + index * (boxHeight + gap);
      const right = zoneLeft + zoneWidth;
      const bottom = topY + boxHeight;
      const isHover = this.quickTransferState.zoneHoverId === target.id;
      const pulse = isHover ? 0.72 + Math.sin(nowMs / 130) * 0.1 : 0.7;

      overlay.roundRect(
        zoneLeft,
        topY,
        zoneWidth,
        boxHeight,
        cornerRadius,
      );
      overlay.fill({
        color: isHover
          ? QUICK_TRANSFER_COLORS.activeFill
          : QUICK_TRANSFER_COLORS.baseFill,
        alpha: 1,
      });
      overlay.stroke({
        width: borderWidth,
        color: isHover
          ? QUICK_TRANSFER_COLORS.activeBorder
          : QUICK_TRANSFER_COLORS.baseBorder,
        alpha: isHover ? Math.max(0.9, pulse) : 0.95,
      });

      this.quickTransferState.zoneBounds.push({
        zoneId: target.zoneId,
        deckId: target.deckId,
        category: expandedCategory,
        isCreate: target.isCreate,
        bounds: { left: zoneLeft, top: topY, right, bottom },
      });

      this.addQuickTransferText(target.label, {
        x: zoneLeft + textInsetX,
        y: topY + textInsetY,
        maxWidth: zoneWidth - textInsetX * 2,
        fill: isHover
          ? QUICK_TRANSFER_COLORS.activeText
          : QUICK_TRANSFER_COLORS.hoverText,
        fontSize: rowFontSize,
        bold: true,
        strokeWidth: textStrokeWidth,
      });
    });

    const hiddenCount = targetRows.length - visibleTargets.length;
    if (hiddenCount > 0) {
      const noteTop =
        zoneTop +
        visibleTargets.length * (boxHeight + gap);
      if (noteTop + boxHeight <= view.bottom - edgePadding) {
        overlay.roundRect(zoneLeft, noteTop, zoneWidth, boxHeight, cornerRadius);
        overlay.fill({ color: QUICK_TRANSFER_COLORS.hoverFill, alpha: 1 });
        overlay.stroke({
          width: borderWidth,
          color: QUICK_TRANSFER_COLORS.activeBorder,
          alpha: 1,
        });
        this.addQuickTransferText(`+${hiddenCount} more`, {
          x: zoneLeft + textInsetX,
          y: noteTop + textInsetY,
          maxWidth: zoneWidth - textInsetX * 2,
          fill: QUICK_TRANSFER_COLORS.activeText,
          fontSize: rowFontSize,
          bold: true,
          strokeWidth: textStrokeWidth,
        });
      }
    }
  }

  private updateQuickTransferHover(
    screenPos: { x: number; y: number },
    nowMs = performance.now(),
  ): void {
    if (!this.quickTransferState.active) return;
    this.quickTransferLastTickMs = nowMs;
    const anchorScreenPos = this.quickTransferState.anchorScreenPos ?? screenPos;
    this.drawQuickTransferOverlay(anchorScreenPos, nowMs);

    const categoryHit = this.getQuickTransferCategoryAtPosition(screenPos);
    if (!this.quickTransferState.expandedCategory) {
      if (categoryHit) {
        if (this.quickTransferState.categoryHover !== categoryHit) {
          this.quickTransferState.categoryHover = categoryHit;
          this.quickTransferState.categoryHoverStartMs = nowMs;
        } else if (nowMs - this.quickTransferState.categoryHoverStartMs >= QUICK_TRANSFER_HOLD_MS) {
          this.quickTransferState.expandedCategory = categoryHit;
          this.quickTransferState.zoneHoverId = null;
        }
      } else {
        this.quickTransferState.categoryHover = null;
        this.quickTransferState.categoryHoverStartMs = 0;
      }
    } else {
      if (categoryHit && categoryHit !== this.quickTransferState.expandedCategory) {
        this.quickTransferState.expandedCategory = categoryHit;
        this.quickTransferState.categoryHover = categoryHit;
        this.quickTransferState.categoryHoverStartMs = nowMs;
        this.quickTransferState.zoneHoverId = null;
      }
      const zoneTarget = this.getQuickTransferZoneAtPosition(screenPos);
      this.quickTransferState.zoneHoverId = zoneTarget
        ? zoneTarget.zoneId ??
          zoneTarget.deckId ??
          `create:${zoneTarget.category}`
        : null;
    }

    this.drawQuickTransferOverlay(anchorScreenPos, nowMs);
  }

  private beginQuickTransferDrag(
    cardKey: string,
    worldPos: { x: number; y: number },
    screenPos: { x: number; y: number },
  ): boolean {
    if (!this.cardSprites.has(cardKey)) return false;
    const hasTargets =
      this.canvasAreas.some((zone) => zone.type === "stack") ||
      this.deckTransferTargets.length > 0;
    if (!hasTargets) return false;

    if (!this.selectedCards.has(cardKey)) {
      this.clearSelection(true);
      this.selectCard(cardKey, true);
      this.emitSelectionChange();
    }

    this.pointerDownOnSelectedCard = true;
    if (!this.dragState.isDragging) {
      this.startCardDrag(worldPos);
    }
    this.camera?.pauseDrag();
    this.quickTransferState.active = true;
    this.quickTransferState.anchorScreenPos = { ...screenPos };
    this.quickTransferState.categoryHover = null;
    this.quickTransferState.categoryHoverStartMs = 0;
    this.quickTransferState.expandedCategory = null;
    this.quickTransferState.zoneHoverId = null;
    this.quickTransferState.categoryBounds = [];
    this.quickTransferState.zoneBounds = [];
    this.quickTransferLastTickMs = 0;
    this.updateQuickTransferHover(screenPos);
    return true;
  }

  private clearQuickTransferHold(): void {
    if (this.quickTransferHoldTimerId === null) return;
    window.clearTimeout(this.quickTransferHoldTimerId);
    this.quickTransferHoldTimerId = null;
  }

  private toDeckAddPlacements(placements: DraggedCardPlacement[]): DeckAddPlacement[] {
    return placements.map((placement) => ({
      cardName: placement.cardName,
      centerX: placement.centerX,
      centerY: placement.centerY,
    }));
  }

  private requestDeckAdd(payload: {
    deckId: string;
    canvasAreaId?: string | null;
    cardNames: string[];
    placements?: DraggedCardPlacement[];
    worldPos: { x: number; y: number };
    screenPos: { x: number; y: number };
    source: DeckAddRequestPayload["source"];
  }): void {
    if (payload.cardNames.length === 0) return;
    const rect = this.app.canvas.getBoundingClientRect();
    const zone = this.canvasAreas.find(area => area.id === payload.canvasAreaId);
    const label = payload.source === 'canvas-zone' ? this.getLabelTarget(payload.worldPos) : null;
    this.onDeckAddRequest?.({
      board: payload.source === 'canvas-zone' && zone ? label?.board ?? (this.getDeckBoardForPosition(zone, payload.worldPos) ?? 'mainboard') : undefined,
      labelId: label?.id,
      deckId: payload.deckId,
      canvasAreaId: payload.canvasAreaId ?? null,
      cardNames: payload.cardNames,
      placements:
        payload.placements && payload.placements.length > 0
          ? this.toDeckAddPlacements(payload.placements)
          : undefined,
      worldPos: payload.worldPos,
      clientX: rect.left + payload.screenPos.x,
      clientY: rect.top + payload.screenPos.y,
      source: payload.source,
    });
  }

  private completeQuickTransferDrop(
    worldPos: { x: number; y: number },
    screenPos: { x: number; y: number },
  ): void {
    if (!this.quickTransferState.active) return;

    this.updateQuickTransferHover(screenPos);
    const dropTarget = this.getQuickTransferZoneAtPosition(screenPos);
    const draggedCardNames = this.getDraggedCardNames();
    const draggedPlacements = this.getDraggedCardPlacements();
    const rect = this.app.canvas.getBoundingClientRect();

    this.endCardDrag(true);
    this.pointerDownOnSelectedCard = false;
    this.camera?.resumeDrag();
    this.setStacksDropVisual(false);

    if (dropTarget?.isCreate && draggedCardNames.length > 0) {
      this.onQuickTransferCreateTarget?.({
        category: dropTarget.category,
        cardNames: draggedCardNames,
        clientX: rect.left + screenPos.x,
        clientY: rect.top + screenPos.y,
      });
    } else if (
      dropTarget?.category === "deck" &&
      dropTarget.deckId &&
      draggedCardNames.length > 0
    ) {
      this.requestDeckAdd({
        deckId: dropTarget.deckId,
        canvasAreaId: dropTarget.zoneId,
        cardNames: draggedCardNames,
        placements: draggedPlacements,
        worldPos,
        screenPos,
        source: "quick-transfer",
      });
    } else if (dropTarget?.zoneId && draggedCardNames.length > 0) {
      this.copyCardsIntoZone(dropTarget.zoneId, draggedCardNames, worldPos, {
        useZonePlacement: true,
        placements: draggedPlacements,
      });
    }
    this.deactivateQuickTransfer();
  }

  private cloneCanvasAreas(areas: CanvasArea[]): CanvasArea[] {
    return areas.map((area) => ({
      ...area,
      bounds: { ...area.bounds },
      cards: area.cards.map((card) => ({ ...card })),
      deckVariants: area.deckVariants?.map((variant) => ({
        ...variant,
        activeCardIds: [...variant.activeCardIds],
      })),
      activeDeckVariantId: area.activeDeckVariantId ?? null,
      cardFilters: area.cardFilters
        ? cloneCardFilterState(area.cardFilters)
        : area.type === "deck"
          ? createDefaultCardFilters()
          : undefined,
    }));
  }

  private emitCanvasAreasChange(): void {
    this.onCanvasAreasChange?.(this.cloneCanvasAreas(this.canvasAreas));
  }

  private closeDeckCardDeletePrompt(): void {
    this.armedDelete = null;
  }

  private closeTouchActionSheet(): void {
    if (this.touchActionSheetPointerHandler) {
      window.removeEventListener("pointerdown", this.touchActionSheetPointerHandler, true);
      this.touchActionSheetPointerHandler = null;
    }
    if (this.touchActionSheetKeyHandler) {
      window.removeEventListener("keydown", this.touchActionSheetKeyHandler, true);
      this.touchActionSheetKeyHandler = null;
    }
    if (this.touchActionSheetRoot?.parentNode) {
      this.touchActionSheetRoot.parentNode.removeChild(this.touchActionSheetRoot);
    }
    this.touchActionSheetRoot = null;
  }

  private addTouchActionButton(
    panel: HTMLElement,
    label: string,
    action: () => void,
    danger = false,
  ): void {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `touch-action-sheet-button${danger ? " danger" : ""}`;
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeTouchActionSheet();
      action();
    });
    panel.appendChild(button);
  }

  private showTouchActionSheet(
    target: TouchCanvasTarget,
    clientX: number,
    clientY: number,
  ): void {
    if (target.kind === "empty") return;

    this.closeTouchActionSheet();
    if (target.kind !== 'zone-card' || this.armedDelete?.key !== target.zoneCardKey) this.closeDeckCardDeletePrompt();

    const panel = document.createElement("div");
    panel.className = "touch-action-sheet";

    const title = document.createElement("div");
    title.className = "touch-action-sheet-title";
    title.textContent = this.getTouchActionTitle(target);
    panel.appendChild(title);

    this.populateTouchActions(panel, target, clientX, clientY);

    if (panel.querySelectorAll("button").length === 0) return;

    const panelWidth = 240;
    const estimatedHeight = Math.min(320, 54 + panel.querySelectorAll("button").length * 46);
    const left = Math.max(8, Math.min(clientX + 10, window.innerWidth - panelWidth - 8));
    const top = Math.max(8, Math.min(clientY + 10, window.innerHeight - estimatedHeight - 8));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;

    document.body.appendChild(panel);
    this.touchActionSheetRoot = panel;

    this.touchActionSheetPointerHandler = (event: PointerEvent) => {
      const eventTarget = event.target;
      if (!(eventTarget instanceof Node) || !this.touchActionSheetRoot?.contains(eventTarget)) {
        this.closeTouchActionSheet();
      }
    };
    this.touchActionSheetKeyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeTouchActionSheet();
      }
    };
    window.addEventListener("pointerdown", this.touchActionSheetPointerHandler, true);
    window.addEventListener("keydown", this.touchActionSheetKeyHandler, true);
  }

  private getTouchActionTitle(target: TouchCanvasTarget): string {
    if (target.kind === "card" || target.kind === "zone-card") return target.cardName;
    if (target.kind === "label") return "Label";
    if (target.kind === "zone-header" || target.kind === "zone") {
      const zone = this.canvasAreas.find((entry) => entry.id === target.zoneId);
      return zone?.name ?? "Canvas area";
    }
    return "Canvas";
  }

  private populateTouchActions(
    panel: HTMLElement,
    target: TouchCanvasTarget,
    clientX: number,
    clientY: number,
  ): void {
    if (target.kind === "card") {
      if (this.selectedCardCategoryId && this.cardCategoryData) {
        this.addTouchActionButton(panel, "Increase score", () =>
          this.modifyCardCategoryScore(target.cardName, 0.1),
        );
        this.addTouchActionButton(panel, "Decrease score", () =>
          this.modifyCardCategoryScore(target.cardName, -0.1),
        );
        this.addTouchActionButton(panel, "Set score", () =>
          this.promptCardCategoryScore(target.cardName),
        );
        return;
      }

      this.addTouchActionButton(panel, "Add to active deck", () =>
        this.onAddToDeck(target.cardName),
      );
      this.addTouchActionButton(panel, "Remove from active deck", () =>
        this.onRemoveFromDeck(target.cardName),
      );
      return;
    }

    if (target.kind === "zone-card") {
      const zone = this.canvasAreas.find((entry) => entry.id === target.zoneId);
      const member = zone?.cards.find(card => card.id === target.instanceId);
      if (member?.labelId) {
        this.addTouchActionButton(panel, 'Detach from label', () => {
          delete member.labelId;
          this.reconcileCanvasAreaBounds(target.zoneId);
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
        });
      }
      if (zone?.type === "deck") {
        this.addTouchActionButton(panel, "Toggle active", () => {
          const changed = this.toggleDeckZoneCardActive(target.zoneId, target.instanceId);
          if (!changed) return;
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
        });
        this.addTouchActionButton(panel, "Duplicate", () => {
          this.duplicateCanvasCardInstance(target.zoneId, target.instanceId);
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
        });
      }

      this.addTouchActionButton(
        panel,
        this.armedDelete?.key === target.zoneCardKey && Date.now() <= this.armedDelete.expires ? 'Confirm remove card' : zone?.type === "deck" ? "Remove from deck canvas" : "Remove from stack",
        () => {
          const zoneCard = this.zoneCardSprites.get(target.zoneCardKey);
          if (!zoneCard) return;
          this.handleZoneCardDelete(zoneCard, clientX, clientY);
        },
        true,
      );
      return;
    }

    if (target.kind === "label") {
      this.addTouchActionButton(panel, "Edit label", () => this.editLabel(target.labelId));
      this.addTouchActionButton(
        panel,
        "Delete label",
        () => this.deleteLabel(target.labelId),
        true,
      );
      return;
    }

    if (target.kind === "zone-header" || target.kind === "zone") {
      const zone = this.canvasAreas.find((entry) => entry.id === target.zoneId);
      if (!zone) return;

      if (zone.type === "stack") {
        this.addTouchActionButton(panel, "Open stack panel", () =>
          this.onStackZoneHeaderClick?.(zone.id),
        );
      }
      this.addTouchActionButton(panel, zone.type === 'deck' ? "Reset layout" : "Sort cards",
        () => this.requestZoneLayoutReset(zone.id));
      if (zone.type === "deck") {
        this.addTouchActionButton(panel, "Filter deck", () =>
          this.openDeckFilterRequest(zone.id, null),
        );
      }
      this.addTouchActionButton(
        panel,
        "Hide from canvas",
        () => this.hideZoneFromCanvas(zone.id),
        true,
      );
    }
  }

  private handleZoneCardDelete(
    zoneCard: ZoneCardSpriteData,
    _clientX: number,
    _clientY: number,
  ): void {
    const now = Date.now();
    if (this.armedDelete?.key !== zoneCard.key || now > this.armedDelete.expires) {
      this.armedDelete = { key: zoneCard.key, expires: now + 5000 };
      this.hoveredZoneCardKey = zoneCard.key;
      this.drawZoneDeleteOverlay();
      return;
    }
    this.armedDelete = null;
    this.showDeletionPuff(zoneCard.bounds);
    this.removeCanvasCardInstance(zoneCard.zoneId, zoneCard.instanceId);
    this.emitCanvasAreasChange();
    this.hoveredZoneCardKey = null;
    this.drawZoneDeleteOverlay();
  }

  private showDeletionPuff(bounds: ZoneCardSpriteData["bounds"]): void {
    if (!this.camera?.container || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)) return;
    if (this.effectSettings.intensity === 'off') return;
    // Everyday card removal stays small. Expressive mode retains the full cloud
    // for isolated deletions; rapid repeats use the compact drawing sequence.
    if (this.effectSettings.intensity !== 'expressive' || performance.now() - this.lastFullPoof < 2400) {
      this.playMangaEffect('delete', bounds);
      return;
    }
    const now = performance.now();
    const accepted = this.effectGate.accept('delete', now, this.effectSettings, false);
    if (!accepted) return;
    this.lastFullPoof = now;
    // Bound transient graphics when several cards are removed in quick succession.
    if (this.deletionPuffs.length >= 8) this.deletionPuffs.shift()?.effect.destroy();
    const effect = new DeletionPoof(bounds, this.camera.zoom, undefined, accepted.words ? this.effectSettings.lettering : 'none');
    this.getMangaEffectLayer()?.addChild(effect.root);
    this.deletionPuffs.push({ effect, start: performance.now() });
  }

  resetSessionGestures(): void {
    this.removedCardHistory = [];
    this.hasReceivedAreas = false;
    this.effectGate = new MangaEffectGate();
    this.lastFullPoof = -Infinity;
    this.lastSelectionEffect = '';
    this.setInteractionEffects(this.effectSettings);
    this.closeInspection();
    if (this.focusEffectTimer) clearTimeout(this.focusEffectTimer);
    this.focusEffectTimer = null;
  }

  setInteractionEffects(settings: InteractionEffectsSettings): void {
    this.effectSettings = ensureInteractionEffects(settings);
    for (const { effect } of this.mangaEffects) effect.destroy();
    this.mangaEffects = [];
    for (const { effect } of this.deletionPuffs) effect.destroy();
    this.deletionPuffs = [];
    this.mangaEffectLayer?.destroy({ children: true });
    this.mangaEffectLayer = null;
  }

  private motionEnabled(): boolean {
    return this.effectSettings?.intensity !== 'off' && !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  private getMangaEffectLayer(): Container | null {
    const camera = this.camera?.container;
    if (!camera) return null;
    if (!this.mangaEffectLayer || this.mangaEffectLayer.destroyed) {
      this.mangaEffectLayer = new Container();
      this.mangaEffectLayer.label = 'manga-effects';
      this.mangaEffectLayer.eventMode = 'none';
      this.mangaEffectLayer.interactiveChildren = false;
      this.mangaEffectLayer.zIndex = 20_000_000;
      camera.addChild(this.mangaEffectLayer);
    }
    if (camera.children.at(-1) !== this.mangaEffectLayer) camera.setChildIndex(this.mangaEffectLayer, camera.children.length - 1);
    return this.mangaEffectLayer;
  }

  private getCardsEffectBounds(keys: Iterable<string>): EffectBounds | undefined {
    const boxes: EffectBounds[] = [];
    for (const key of keys) {
      const data = this.zoneCardSprites.get(key) ?? this.getSpriteData(key);
      if (!data) continue;
      boxes.push(data.sprite?.getWorldBounds?.() ?? data.bounds);
    }
    return unionEffectBounds(boxes);
  }

  private playCardsEffect(kind: MangaEffectKind, keys: Iterable<string>, follow = false): void {
    if (!this.camera?.container || !this.motionEnabled()) return;
    const selected = [...new Set(keys)];
    const bounds = this.getCardsEffectBounds(selected);
    if (follow) this.playMangaEffect(kind, bounds, selected);
    else this.playMangaEffect(kind, bounds);
  }

  private getZoneStackEffectKeys(zoneId: string, instanceId: string): string[] {
    const area = this.canvasAreas.find(zone => zone.id === zoneId);
    const instance = area?.cards.find(card => card.id === instanceId);
    if (!area || !instance) return [];
    const stack = this.getZoneCardStackKey(area, instance);
    return area.cards.filter(card => this.getZoneCardStackKey(area, card) === stack).map(card => `${zoneId}:${card.id}`);
  }

  private playMangaEffect(kind: MangaEffectKind, bounds?: EffectBounds, follow?: string[]): void {
    if (!bounds || !this.camera?.container || !this.motionEnabled()) return;
    const visible = this.camera.getVisibleBounds?.();
    if (visible && !this.boundsIntersect(bounds, visible)) return;
    const now = performance.now();
    const accepted = this.effectGate?.accept(kind, now, this.effectSettings, false);
    if (!accepted) return;
    if (this.mangaEffects.length >= MAX_MANGA_EFFECTS) this.mangaEffects.shift()?.effect.destroy();
    const effect = new MangaEffect(kind, bounds, this.camera.zoom, this.effectSettings, accepted.words);
    this.getMangaEffectLayer()?.addChild(effect.root);
    this.mangaEffects.push({ effect, start: now, follow });
  }

  private playAreaEffect(kind: MangaEffectKind, area: CanvasArea): void {
    // Anchor to the title instead of covering a potentially enormous deck.
    this.playMangaEffect(kind, { left: area.bounds.x, top: area.bounds.y,
      right: area.bounds.x + Math.min(area.bounds.width, 360), bottom: area.bounds.y + 70 });
  }

  private getCardType(cardName: string): CardType | null {
    const card = this.cards.find((entry) => entry.name === cardName);
    return card?.guardian.type ?? null;
  }

  private getCardCost(cardName: string): number {
    const card = this.cards.find((entry) => entry.name === cardName);
    const cost = card?.guardian.cost;
    return Number.isFinite(cost) ? (cost ?? 0) : 0;
  }

  private getZoneSortTypeRank(type: CardType | null): number {
    if (!type) return Number.MAX_SAFE_INTEGER;
    return ZONE_SORT_TYPE_ORDER[type] ?? Number.MAX_SAFE_INTEGER;
  }

  private getZoneSortGroup(
    type: CardType | null,
  ): "Minion" | "Magic" | "Aura" | "Artifact" | "Site" | "Avatar" | "other" {
    if (
      type === "Minion" ||
      type === "Magic" ||
      type === "Aura" ||
      type === "Artifact" ||
      type === "Site" ||
      type === "Avatar"
    ) {
      return type;
    }
    return "other";
  }

  private getZoneDisplayName(zone: CanvasArea): string {
    if (zone.type !== "deck") {
      return zone.name;
    }
    return sanitizeDeckZoneName(zone.name);
  }

  private isLandscapeCard(cardName: string): boolean {
    return this.getCardType(cardName) === "Site";
  }

  private getZoneHeaderHeight(zone: CanvasArea): number {
    return zone.type === "deck" ? ZONE_DECK_HEADER_HEIGHT : ZONE_HEADER_HEIGHT;
  }

  private normalizeDeckBoard(board: ActiveBoard | null | undefined): DeckZoneBoard {
    return normalizeDeckBoard(board);
  }

  private createEmptyDeckCostBucket(): DeckCostBucketStats {
    return {
      total: 0,
      byType: {
        Minion: 0,
        Magic: 0,
        Aura: 0,
        Artifact: 0,
      },
      byThreshold: {
        air: 0,
        earth: 0,
        fire: 0,
        water: 0,
        multiple: 0,
        none: 0,
      },
    };
  }

  private getDeckCostBucketKey(cost: number): "low" | "mid" | "high" {
    if (cost <= 2) return "low";
    if (cost <= 5) return "mid";
    return "high";
  }

  private matchesDeckKeyword(card: Card, keyword: DeckKeywordSpec): boolean {
    const rulesText = card.guardian.rulesText ?? "";
    const subTypes = card.subTypes ?? "";

    const inRules = keyword.rulesPatterns.some((pattern) => pattern.test(rulesText));
    if (inRules) return true;
    if (!keyword.subTypePatterns || keyword.subTypePatterns.length === 0) return false;
    return keyword.subTypePatterns.some((pattern) => pattern.test(subTypes));
  }

  private formatDeckStatNumber(value: number): string {
    if (!Number.isFinite(value)) return "0";
    return value.toFixed(2).replace(/\.?0+$/, "");
  }

  private formatDeckStatPercent(value: number, total: number): string {
    if (total <= 0) return "0%";
    return `${Math.round((value / total) * 100)}%`;
  }

  private formatDeckAuthorLabel(author: string): string {
    const trimmed = author.trim();
    if (!trimmed) return "";
    return /^by\b/i.test(trimmed) ? trimmed : `by ${trimmed}`;
  }

  private addDeckHeaderText(
    elements: Container[],
    options: {
      text: string;
      x: number;
      y: number;
      zIndex: number;
      maxWidth?: number;
      fontSize?: number;
      fill?: number;
      bold?: boolean;
    },
  ): Text {
    const text = new Text({
      text: options.text,
      style: {
        fontFamily: "Arial",
        fontSize: options.fontSize ?? ZONE_DECK_STATS_LINE_SIZE,
        fill: options.fill ?? ZONE_DECK_STATS_TEXT_FILLS.line,
        fontWeight: options.bold ? "bold" : "normal",
        stroke: ZONE_DECK_STATS_TEXT_STROKE,
      },
    });
    this.configureTextQuality(text);
    text.x = Math.round(options.x);
    text.y = Math.round(options.y);
    text.zIndex = options.zIndex;

    if ((options.maxWidth ?? 0) > 0) {
      while (text.width > (options.maxWidth ?? 0) && text.text.length > 4) {
        text.text = `${text.text.slice(0, -4).trimEnd()}...`;
      }
    }

    this.zoneContainer.addChild(text);
    elements.push(text);
    return text;
  }

  private drawDeckHeaderLineGraph(
    elements: Container[],
    options: {
      x: number;
      y: number;
      width: number;
      height: number;
      zIndex: number;
      manaCosts: number[];
      series: Array<{
        label: string;
        color: number;
        values: number[];
        decimals?: number;
      }>;
      yFormatter?: (value: number) => string;
    },
  ): DeckGraphHoverRegion | null {
    if (options.width < 120 || options.height < 64) return null;

    const panel = new Graphics();
    panel.zIndex = options.zIndex;
    panel.roundRect(options.x, options.y, options.width, options.height, 8);
    panel.fill({ color: 0x1a2243, alpha: 0.58 });
    panel.stroke({ width: 1, color: 0x6b7ac0, alpha: 0.68 });

    this.zoneContainer.addChild(panel);
    elements.push(panel);

    const splitIndex = Math.ceil(options.series.length / 2);
    const leftLegendEntries = options.series.slice(0, splitIndex);
    const rightLegendEntries = options.series.slice(splitIndex);
    const leftLegendTexts: Text[] = [];
    const rightLegendTexts: Text[] = [];
    const legendTop = options.y + 7;
    let leftLegendY = legendTop;
    let rightLegendY = legendTop;
    let leftLegendWidth = 0;
    let rightLegendWidth = 0;

    for (const entry of leftLegendEntries) {
      const text = this.addDeckHeaderText(elements, {
        text: entry.label,
        x: options.x + 6,
        y: leftLegendY,
        zIndex: options.zIndex + 1,
        fontSize: 9,
        fill: entry.color,
        bold: true,
      });
      leftLegendWidth = Math.max(leftLegendWidth, text.width);
      leftLegendY = text.y + text.height + 2;
      leftLegendTexts.push(text);
    }

    for (const entry of rightLegendEntries) {
      const text = this.addDeckHeaderText(elements, {
        text: entry.label,
        x: options.x + options.width - 6,
        y: rightLegendY,
        zIndex: options.zIndex + 1,
        fontSize: 9,
        fill: entry.color,
        bold: true,
      });
      rightLegendWidth = Math.max(rightLegendWidth, text.width);
      rightLegendY = text.y + text.height + 2;
      rightLegendTexts.push(text);
    }

    for (const text of rightLegendTexts) {
      text.x = options.x + options.width - 6 - text.width;
    }

    const innerLeft = options.x + 8 + leftLegendWidth + 10;
    const innerRight = options.x + options.width - 8 - rightLegendWidth - 10;
    const innerTop = options.y + 8;
    const innerBottom = options.y + options.height - 17;

    if (innerRight - innerLeft < 24 || innerBottom - innerTop < 20) return null;

    panel.moveTo(innerLeft, innerTop);
    panel.lineTo(innerLeft, innerBottom);
    panel.lineTo(innerRight, innerBottom);
    panel.stroke({ width: 1, color: 0x8d9ad6, alpha: 0.72 });

    const maxY = options.series.reduce((best, entry) => {
      for (const value of entry.values) {
        if (value > best) best = value;
      }
      return best;
    }, 0);
    if (maxY <= 0) {
      this.addDeckHeaderText(elements, {
        text: "No data",
        x: innerLeft + (innerRight - innerLeft) * 0.34,
        y: innerTop + (innerBottom - innerTop) * 0.4,
        zIndex: options.zIndex + 1,
        fontSize: 10,
        fill: ZONE_DECK_STATS_TEXT_FILLS.subtle,
      });
      return null;
    }

    const yFormatter =
      options.yFormatter ?? ((value: number) => this.formatDeckStatNumber(value));
    const yTickCount = 4;
    for (let tick = 0; tick <= yTickCount; tick++) {
      const ratio = tick / yTickCount;
      const y = innerBottom - ratio * (innerBottom - innerTop);
      const tickValue = maxY * ratio;
      panel.moveTo(innerLeft, y);
      panel.lineTo(innerRight, y);
      panel.stroke({
        width: tick === 0 ? 1 : 0.65,
        color: 0x7183c8,
        alpha: tick === 0 ? 0.72 : 0.3,
      });

      const yLabel = this.addDeckHeaderText(elements, {
        text: yFormatter(tickValue),
        x: innerLeft - 5,
        y: y - 4,
        zIndex: options.zIndex + 1,
        fontSize: 8,
        fill: ZONE_DECK_STATS_TEXT_FILLS.subtle,
      });
      yLabel.x = innerLeft - 5 - yLabel.width;
      yLabel.y = y - yLabel.height / 2;
    }

    const pointCount = Math.max(1, options.manaCosts.length);
    for (let index = 0; index < pointCount; index++) {
      const x =
        pointCount === 1
          ? innerLeft + (innerRight - innerLeft) / 2
          : innerLeft + (index / (pointCount - 1)) * (innerRight - innerLeft);
      panel.moveTo(x, innerBottom);
      panel.lineTo(x, innerBottom + 3);
      panel.stroke({ width: 0.7, color: 0x7f90cc, alpha: 0.56 });

      const xLabel = this.addDeckHeaderText(elements, {
        text: `${options.manaCosts[index] ?? index}`,
        x: x,
        y: innerBottom + 4,
        zIndex: options.zIndex + 1,
        fontSize: 8,
        fill: ZONE_DECK_STATS_TEXT_FILLS.subtle,
      });
      xLabel.x = Math.max(
        options.x + 2,
        Math.min(x - xLabel.width / 2, options.x + options.width - xLabel.width - 2),
      );
    }

    type Point = { x: number; y: number };
    const getSeriesPoints = (values: number[]): Point[] =>
      values.map((value, index) => {
        const x =
          pointCount === 1
            ? innerLeft + (innerRight - innerLeft) / 2
            : innerLeft + (index / (pointCount - 1)) * (innerRight - innerLeft);
        const y = innerBottom - (value / maxY) * (innerBottom - innerTop);
        return { x, y };
      });

    const drawSmoothSeries = (points: Point[], color: number): void => {
      if (points.length === 0) return;
      const firstPoint = points[0];
      if (!firstPoint) return;
      if (points.length === 1) {
        panel.circle(firstPoint.x, firstPoint.y, 1.5);
        panel.fill({ color, alpha: 0.95 });
        return;
      }

      panel.moveTo(firstPoint.x, firstPoint.y);
      if (points.length === 2) {
        panel.lineTo(points[1]?.x ?? innerRight, points[1]?.y ?? innerTop);
      } else {
        const tension = 1;
        const lastPoint = points[points.length - 1] ?? firstPoint;
        for (let index = 0; index < points.length - 1; index++) {
          const p0 = points[Math.max(0, index - 1)] ?? firstPoint;
          const p1 = points[index] ?? firstPoint;
          const p2 = points[index + 1] ?? lastPoint;
          const p3 = points[Math.min(points.length - 1, index + 2)] ?? lastPoint;

          const cp1x = p1.x + ((p2.x - p0.x) / 6) * tension;
          const cp1y = p1.y + ((p2.y - p0.y) / 6) * tension;
          const cp2x = p2.x - ((p3.x - p1.x) / 6) * tension;
          const cp2y = p2.y - ((p3.y - p1.y) / 6) * tension;
          panel.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
      }
      panel.stroke({ width: ZONE_DECK_GRAPH_LINE_WIDTH, color, alpha: 0.95 });
    };

    for (const entry of options.series) {
      if (entry.values.every((value) => value <= 0)) continue;
      drawSmoothSeries(getSeriesPoints(entry.values), entry.color);
    }

    return {
      bounds: {
        left: innerLeft,
        top: innerTop,
        right: innerRight,
        bottom: innerBottom,
      },
      manaCosts: [...options.manaCosts],
      series: options.series.map((entry) => ({
        label: entry.label,
        color: entry.color,
        values: [...entry.values],
        decimals: entry.decimals ?? 0,
      })),
    };
  }

  private renderDeckHeaderStats(
    zone: CanvasArea,
    elements: Container[],
    options: {
      left: number;
      top: number;
      graphTop?: number;
      right: number;
      bottom: number;
      zIndex: number;
    },
  ): DeckGraphHoverRegion[] {
    const hoverRegions: DeckGraphHoverRegion[] = [];
    const stats = this.computeDeckHeaderStats(zone);
    if (!stats) return hoverRegions;

    const width = options.right - options.left;
    const height = options.bottom - options.top;
    if (width < 460 || height < 64) return hoverRegions;

    const gaps = ZONE_DECK_STATS_COL_GAP * 4;
    const usableWidth = width - gaps;
    if (usableWidth <= 0) return hoverRegions;

    const sectionRatios = [0.11, 0.12, 0.14, 0.315, 0.315] as const;
    const sectionWidths = sectionRatios.map((ratio) => ratio * usableWidth);
    const sectionX: number[] = [];
    let cursorX = options.left;
    for (let index = 0; index < sectionWidths.length; index++) {
      sectionX.push(cursorX);
      const sectionWidth = sectionWidths[index] ?? 0;
      cursorX += sectionWidth + (index < sectionWidths.length - 1 ? ZONE_DECK_STATS_COL_GAP : 0);
    }

    const addColumn = (column: number, title: string, lines: string[]): void => {
      const x = sectionX[column] ?? options.left;
      const maxWidth = sectionWidths[column] ?? 0;
      const titleText = this.addDeckHeaderText(elements, {
        text: title,
        x,
        y: options.top,
        zIndex: options.zIndex,
        maxWidth,
        fontSize: ZONE_DECK_STATS_TITLE_SIZE,
        fill: ZONE_DECK_STATS_TEXT_FILLS.title,
        bold: true,
      });

      let y = titleText.y + titleText.height + 2;
      for (const line of lines) {
        const row = this.addDeckHeaderText(elements, {
          text: line,
          x,
          y,
          zIndex: options.zIndex,
          maxWidth,
          fontSize: ZONE_DECK_STATS_LINE_SIZE,
          fill: ZONE_DECK_STATS_TEXT_FILLS.line,
        });
        y = row.y + row.height + ZONE_DECK_STATS_LINE_GAP;
        if (y > options.bottom - 12) {
          break;
        }
      }
    };

    addColumn(0, "Decks", [
      `Spellbook: ${stats.spellsTotal}`,
      `Sites: ${stats.sitesTotal}`,
      `Collection: ${stats.collectionTotal}`,
    ]);

    addColumn(1, "Spell Types", [
      `Minions: ${stats.spellTypeCounts.Minion}`,
      `Magic: ${stats.spellTypeCounts.Magic}`,
      `Auras: ${stats.spellTypeCounts.Aura}`,
      `Artifacts: ${stats.spellTypeCounts.Artifact}`,
      ...Object.entries(stats.spellTypeCounts)
        .filter(([type]) => !["Minion", "Magic", "Aura", "Artifact"].includes(type))
        .map(([type, count]) => `${type}: ${count}`),
    ]);

    const minionTotal = stats.minionInfo.total;
    const minionRatioText = (value: number): string =>
      `${value}/${minionTotal} (${this.formatDeckStatPercent(value, minionTotal)})`;
    const minionInfoLines =
      stats.minionInfo.topKeywords.length > 0
        ? stats.minionInfo.topKeywords
            .slice(0, 4)
            .map((entry) => `${entry.label}: ${minionRatioText(entry.count)}`)
        : ["No keyword concentration"];
    addColumn(2, "Minion Info", minionInfoLines);

    const graphTop = Math.min(options.top, options.graphTop ?? options.top);
    const graphHeight = Math.max(64, options.bottom - graphTop);

    const manaCurveRegion = this.drawDeckHeaderLineGraph(elements, {
      x: sectionX[3] ?? options.left,
      y: graphTop,
      width: sectionWidths[3] ?? 0,
      height: graphHeight,
      zIndex: options.zIndex,
      manaCosts: stats.manaCosts,
      series: [
        {
          label: "Total",
          color: ZONE_DECK_GRAPH_COLORS.total,
          values: stats.manaCardCurve.total,
          decimals: 0,
        },
        {
          label: "Air",
          color: ZONE_DECK_GRAPH_COLORS.air,
          values: stats.manaCardCurve.air,
          decimals: 0,
        },
        {
          label: "Earth",
          color: ZONE_DECK_GRAPH_COLORS.earth,
          values: stats.manaCardCurve.earth,
          decimals: 0,
        },
        {
          label: "Fire",
          color: ZONE_DECK_GRAPH_COLORS.fire,
          values: stats.manaCardCurve.fire,
          decimals: 0,
        },
        {
          label: "Water",
          color: ZONE_DECK_GRAPH_COLORS.water,
          values: stats.manaCardCurve.water,
          decimals: 0,
        },
      ],
      yFormatter: (value) => `${Math.round(value)}`,
    });
    if (manaCurveRegion) hoverRegions.push(manaCurveRegion);

    const thresholdRegion = this.drawDeckHeaderLineGraph(elements, {
      x: sectionX[4] ?? options.left,
      y: graphTop,
      width: sectionWidths[4] ?? 0,
      height: graphHeight,
      zIndex: options.zIndex,
      manaCosts: stats.manaCosts,
      series: [
        {
          label: "All",
          color: ZONE_DECK_GRAPH_COLORS.all,
          values: stats.elementLoadPerMana.all,
          decimals: 1,
        },
        {
          label: "Minion",
          color: ZONE_DECK_GRAPH_COLORS.minion,
          values: stats.elementLoadPerMana.minion,
          decimals: 1,
        },
        {
          label: "Magic",
          color: ZONE_DECK_GRAPH_COLORS.magic,
          values: stats.elementLoadPerMana.magic,
          decimals: 1,
        },
        {
          label: "Aura",
          color: ZONE_DECK_GRAPH_COLORS.aura,
          values: stats.elementLoadPerMana.aura,
          decimals: 1,
        },
      ],
      yFormatter: (value) => this.formatDeckStatNumber(value),
    });
    if (thresholdRegion) hoverRegions.push(thresholdRegion);

    return hoverRegions;
  }

  private computeDeckHeaderStats(zone: CanvasArea): DeckHeaderStats | null {
    if (zone.type !== "deck") return null;

    const cardLookup = new Map(this.cards.map((card) => [card.name, card]));
    const activeVariant = this.getActiveDeckZoneVariant(zone);
    const activeMainIds = new Set(activeVariant?.activeCardIds ?? []);
    const hasExplicitVariant = activeVariant != null;

    const activeMainboard = zone.cards.filter(
      (instance) =>
        this.normalizeDeckBoard(instance.board) === "mainboard" &&
        (!hasExplicitVariant || activeMainIds.has(instance.id)),
    );
    const collectionCollection = zone.cards.filter(
      (instance) => this.normalizeDeckBoard(instance.board) === "collection",
    );
    const collectionTotal = collectionCollection.length;

    const spellTypeCounts: DeckHeaderStats["spellTypeCounts"] = {
      Minion: 0,
      Magic: 0,
      Aura: 0,
      Artifact: 0,
    };
    const costBuckets: DeckHeaderStats["costBuckets"] = {
      low: this.createEmptyDeckCostBucket(),
      mid: this.createEmptyDeckCostBucket(),
      high: this.createEmptyDeckCostBucket(),
    };
    const spellThresholdTotals: DeckHeaderStats["spellThresholdTotals"] = {
      air: 0,
      earth: 0,
      fire: 0,
      water: 0,
      total: 0,
    };
    const siteThresholdTotals: DeckHeaderStats["siteThresholdTotals"] = {
      air: 0,
      earth: 0,
      fire: 0,
      water: 0,
    };
    const siteProviderCounts: DeckHeaderStats["siteProviderCounts"] = {
      air: 0,
      earth: 0,
      fire: 0,
      water: 0,
    };
    const minionKeywordCounts = new Map<DeckKeywordSpec["id"], number>();
    for (const keyword of DECK_KEYWORD_SPECS) {
      minionKeywordCounts.set(keyword.id, 0);
    }
    const manaCardCurve = {
      total: new Map<number, number>(),
      air: new Map<number, number>(),
      earth: new Map<number, number>(),
      fire: new Map<number, number>(),
      water: new Map<number, number>(),
    };
    const thresholdSumByMana = new Map<number, number>();
    const spellCountByMana = new Map<number, number>();
    const thresholdSumByManaType = {
      Minion: new Map<number, number>(),
      Magic: new Map<number, number>(),
      Aura: new Map<number, number>(),
      Artifact: new Map<number, number>(),
    };
    const spellCountByManaType = {
      Minion: new Map<number, number>(),
      Magic: new Map<number, number>(),
      Aura: new Map<number, number>(),
      Artifact: new Map<number, number>(),
    };

    let spellsTotal = 0;
    let sitesTotal = 0;
    let totalSpellMana = 0;
    let minionTotal = 0;

    const increment = (map: Map<number, number>, key: number, amount = 1): void => {
      map.set(key, (map.get(key) ?? 0) + amount);
    };

    for (const instance of activeMainboard) {
      const card = cardLookup.get(instance.cardName);
      if (!card) continue;

      const type = card.guardian.type;
      const thresholds = card.guardian.thresholds;
      const air = Number.isFinite(thresholds.air) ? thresholds.air : 0;
      const earth = Number.isFinite(thresholds.earth) ? thresholds.earth : 0;
      const fire = Number.isFinite(thresholds.fire) ? thresholds.fire : 0;
      const water = Number.isFinite(thresholds.water) ? thresholds.water : 0;

      if (type === "Site") {
        sitesTotal += 1;
        siteThresholdTotals.air += air;
        siteThresholdTotals.earth += earth;
        siteThresholdTotals.fire += fire;
        siteThresholdTotals.water += water;
        if (air > 0) siteProviderCounts.air += 1;
        if (earth > 0) siteProviderCounts.earth += 1;
        if (fire > 0) siteProviderCounts.fire += 1;
        if (water > 0) siteProviderCounts.water += 1;
        continue;
      }

      if (type === "Avatar") continue;

      spellsTotal += 1;
      spellTypeCounts[type] = (spellTypeCounts[type] ?? 0) + 1;

      const cost = Math.max(0, card.guardian.cost ?? 0);
      const manaCost = Math.max(0, Math.trunc(cost));
      totalSpellMana += cost;
      const thresholdSum = air + earth + fire + water;
      spellThresholdTotals.air += air;
      spellThresholdTotals.earth += earth;
      spellThresholdTotals.fire += fire;
      spellThresholdTotals.water += water;
      spellThresholdTotals.total += thresholdSum;
      increment(manaCardCurve.total, manaCost);
      if (air > 0) increment(manaCardCurve.air, manaCost);
      if (earth > 0) increment(manaCardCurve.earth, manaCost);
      if (fire > 0) increment(manaCardCurve.fire, manaCost);
      if (water > 0) increment(manaCardCurve.water, manaCost);
      increment(thresholdSumByMana, manaCost, thresholdSum);
      increment(spellCountByMana, manaCost);
      if (type === "Minion" || type === "Magic" || type === "Aura" || type === "Artifact") {
        increment(thresholdSumByManaType[type], manaCost, thresholdSum);
        increment(spellCountByManaType[type], manaCost);
      }

      const bucket = costBuckets[this.getDeckCostBucketKey(cost)];
      bucket.total += 1;
      bucket.byType[type] = (bucket.byType[type] ?? 0) + 1;
      bucket.byThreshold[getThresholdGroup(thresholds)] += 1;

      if (type === "Minion") {
        minionTotal += 1;
        for (const keyword of DECK_KEYWORD_SPECS) {
          if (this.matchesDeckKeyword(card, keyword)) {
            minionKeywordCounts.set(
              keyword.id,
              (minionKeywordCounts.get(keyword.id) ?? 0) + 1,
            );
          }
        }
      }
    }

    const duplicateCounts = new Map<string, number>();
    for (const instance of activeMainboard) {
      duplicateCounts.set(
        instance.cardName,
        (duplicateCounts.get(instance.cardName) ?? 0) + 1,
      );
    }
    for (const instance of collectionCollection) {
      duplicateCounts.set(
        instance.cardName,
        (duplicateCounts.get(instance.cardName) ?? 0) + 1,
      );
    }

    const duplicateViolations: DeckHeaderStats["duplicateViolations"] = [];
    for (const [name, count] of duplicateCounts) {
      const card = cardLookup.get(name);
      if (!card) continue;
      const limit = getRarityLimit(card.guardian.rarity);
      if (limit !== null && count > limit) {
        duplicateViolations.push({ name, count, limit });
      }
    }
    duplicateViolations.sort((left, right) => {
      const excessDelta =
        right.count - right.limit - (left.count - left.limit);
      if (excessDelta !== 0) return excessDelta;
      if (right.count !== left.count) return right.count - left.count;
      return left.name.localeCompare(right.name);
    });

    const topMinionKeywords = DECK_KEYWORD_SPECS.map((keyword) => ({
      label: keyword.label,
      count: minionKeywordCounts.get(keyword.id) ?? 0,
    }))
      .filter((entry) => entry.count > 0)
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return left.label.localeCompare(right.label);
      })
      .slice(0, 4);

    const manaKeySet = new Set<number>();
    for (const map of [
      manaCardCurve.total,
      manaCardCurve.air,
      manaCardCurve.earth,
      manaCardCurve.fire,
      manaCardCurve.water,
      thresholdSumByMana,
      ...Object.values(thresholdSumByManaType),
      ...Object.values(spellCountByManaType),
    ]) {
      for (const key of map.keys()) {
        manaKeySet.add(key);
      }
    }
    const maxMana = Math.max(0, ...Array.from(manaKeySet));
    const manaCosts = Array.from({ length: maxMana + 1 }, (_, index) => index);
    const mapToArray = (map: Map<number, number>): number[] =>
      manaCosts.map((manaCost) => map.get(manaCost) ?? 0);
    const ratioArray = (
      valueMap: Map<number, number>,
      countMap: Map<number, number>,
    ): number[] =>
      manaCosts.map((manaCost) => {
        const count = countMap.get(manaCost) ?? 0;
        if (count <= 0) return 0;
        return (valueMap.get(manaCost) ?? 0) / count;
      });

    return {
      spellsTotal,
      sitesTotal,
      collectionTotal,
      spellTypeCounts,
      minionInfo: {
        total: minionTotal,
        topKeywords: topMinionKeywords,
      },
      duplicateViolations,
      costBuckets,
      spellThresholdTotals,
      averageSpellThresholds:
        spellsTotal > 0 ? spellThresholdTotals.total / spellsTotal : 0,
      averageThresholdsPerMana:
        totalSpellMana > 0 ? spellThresholdTotals.total / totalSpellMana : 0,
      siteThresholdTotals,
      siteProviderCounts,
      manaCosts,
      manaCardCurve: {
        total: mapToArray(manaCardCurve.total),
        air: mapToArray(manaCardCurve.air),
        earth: mapToArray(manaCardCurve.earth),
        fire: mapToArray(manaCardCurve.fire),
        water: mapToArray(manaCardCurve.water),
      },
      elementLoadPerMana: {
        all: ratioArray(thresholdSumByMana, spellCountByMana),
        minion: ratioArray(
          thresholdSumByManaType.Minion,
          spellCountByManaType.Minion,
        ),
        magic: ratioArray(thresholdSumByManaType.Magic, spellCountByManaType.Magic),
        aura: ratioArray(thresholdSumByManaType.Aura, spellCountByManaType.Aura),
      },
    };
  }

  private getDeckZoneMainCardIds(zone: CanvasArea): Set<string> {
    const ids = new Set<string>();
    if (zone.type !== "deck") return ids;
    for (const card of zone.cards) {
      if (this.normalizeDeckBoard(card.board) === "mainboard") {
        ids.add(card.id);
      }
    }
    return ids;
  }

  private ensureDeckZoneVariants(zone: CanvasArea): CanvasDeckVariant[] {
    if (zone.type !== "deck") {
      zone.deckVariants = [];
      zone.activeDeckVariantId = null;
      return [];
    }

    const mainCardIds = this.getDeckZoneMainCardIds(zone);
    const fallbackActiveIds = zone.cards
      .filter((card) => card.board === "mainboard" || card.board == null)
      .map((card) => card.id)
      .filter((id) => mainCardIds.has(id));

    const sourceVariants = Array.isArray(zone.deckVariants) ? zone.deckVariants : [];
    const usedIds = new Set<string>();
    const variants = sourceVariants.map((variant, index) => {
      const fallbackName = index === 0 ? "Main" : `Variant ${index + 1}`;
      let id =
        typeof variant.id === "string" && variant.id.trim()
          ? variant.id.trim()
          : createCanvasDeckVariantId();
      while (usedIds.has(id)) {
        id = createCanvasDeckVariantId();
      }
      usedIds.add(id);

      const activeIdSet = new Set(
        Array.isArray(variant.activeCardIds)
          ? variant.activeCardIds.filter((cardId) => mainCardIds.has(cardId))
          : [],
      );
      return {
        id,
        name:
          typeof variant.name === "string" && variant.name.trim()
            ? variant.name.trim()
            : fallbackName,
        activeCardIds: [...activeIdSet],
      };
    });

    if (variants.length === 0) {
      const id = createCanvasDeckVariantId();
      variants.push({
        id,
        name: "Main",
        activeCardIds: [...new Set(fallbackActiveIds)],
      });
      zone.activeDeckVariantId = id;
    }

    const hasActiveVariant = variants.some(
      (variant) => variant.id === zone.activeDeckVariantId,
    );
    if (!hasActiveVariant) {
      zone.activeDeckVariantId = variants[0]?.id ?? null;
    }

    zone.deckVariants = variants;
    return variants;
  }

  private getActiveDeckZoneVariant(zone: CanvasArea): CanvasDeckVariant | null {
    if (zone.type !== "deck") return null;
    const variants = this.ensureDeckZoneVariants(zone);
    if (variants.length === 0) return null;
    return (
      variants.find((variant) => variant.id === zone.activeDeckVariantId) ??
      variants[0] ??
      null
    );
  }

  private setActiveDeckZoneVariant(zoneId: string, variantId: string): boolean {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone || zone.type !== "deck") return false;
    const variants = this.ensureDeckZoneVariants(zone);
    if (!variants.some((variant) => variant.id === variantId)) return false;
    if (zone.activeDeckVariantId === variantId) return false;
    zone.activeDeckVariantId = variantId;
    return true;
  }

  private closeDeckVariantDialog(): void {
    if (this.deckVariantDialogKeydownHandler) {
      window.removeEventListener("keydown", this.deckVariantDialogKeydownHandler, true);
      this.deckVariantDialogKeydownHandler = null;
    }
    if (this.deckVariantDialogRoot?.parentNode) {
      this.deckVariantDialogRoot.parentNode.removeChild(this.deckVariantDialogRoot);
    }
    this.deckVariantDialogRoot = null;
    this.deckVariantDialogOpen = false;
  }

  private showDeckVariantDialog(zone: CanvasArea): Promise<DeckVariantDialogResult | null> {
    if (this.deckVariantDialogOpen || this.isDestroyed) {
      return Promise.resolve(null);
    }

    const variants = this.ensureDeckZoneVariants(zone);
    const activeVariant = this.getActiveDeckZoneVariant(zone);
    if (typeof document === "undefined") {
      return Promise.resolve(null);
    }

    this.deckVariantDialogOpen = true;
    return new Promise<DeckVariantDialogResult | null>((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "9999";
      overlay.style.background = "rgba(10, 12, 20, 0.68)";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.padding = "18px";

      const panel = document.createElement("div");
      panel.style.width = "min(420px, calc(100vw - 36px))";
      panel.style.maxHeight = "calc(100vh - 36px)";
      panel.style.overflow = "auto";
      panel.style.background = "#111528";
      panel.style.border = "1px solid #6b79b8";
      panel.style.borderRadius = "10px";
      panel.style.boxShadow = "0 16px 42px rgba(0, 0, 0, 0.55)";
      panel.style.padding = "16px";
      panel.style.color = "#edf1ff";
      panel.style.fontFamily = "Arial, sans-serif";
      overlay.appendChild(panel);

      const title = document.createElement("h3");
      title.textContent = "Create Variant";
      title.style.margin = "0 0 10px 0";
      title.style.fontSize = "18px";
      panel.appendChild(title);

      const nameLabel = document.createElement("label");
      nameLabel.textContent = "Variant name";
      nameLabel.style.display = "block";
      nameLabel.style.fontSize = "13px";
      nameLabel.style.opacity = "0.92";
      panel.appendChild(nameLabel);

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = `Variant ${variants.length + 1}`;
      nameInput.placeholder = "Variant name";
      nameInput.style.width = "100%";
      nameInput.style.marginTop = "6px";
      nameInput.style.marginBottom = "14px";
      nameInput.style.padding = "8px 10px";
      nameInput.style.borderRadius = "8px";
      nameInput.style.border = "1px solid #7280bf";
      nameInput.style.background = "#1d2543";
      nameInput.style.color = "#f3f6ff";
      panel.appendChild(nameInput);

      const sourceTitle = document.createElement("div");
      sourceTitle.textContent = "Start from";
      sourceTitle.style.fontSize = "13px";
      sourceTitle.style.marginBottom = "8px";
      sourceTitle.style.opacity = "0.92";
      panel.appendChild(sourceTitle);

      const optionList = document.createElement("div");
      optionList.style.display = "grid";
      optionList.style.gap = "8px";
      optionList.style.marginBottom = "14px";
      panel.appendChild(optionList);

      const NONE_SOURCE = "__none__";
      let selectedSource: string = activeVariant?.id ?? NONE_SOURCE;
      const checkboxEntries: Array<{ source: string; input: HTMLInputElement }> = [];

      const addOption = (source: string, labelText: string): void => {
        const row = document.createElement("label");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "8px";
        row.style.fontSize = "14px";
        row.style.padding = "6px 8px";
        row.style.border = "1px solid #4f5f9f";
        row.style.borderRadius = "8px";
        row.style.background = "#1b2340";

        const input = document.createElement("input");
        input.type = "checkbox";
        input.style.width = "16px";
        input.style.height = "16px";
        input.checked = source === selectedSource;
        row.appendChild(input);

        const text = document.createElement("span");
        text.textContent = labelText;
        row.appendChild(text);
        optionList.appendChild(row);
        checkboxEntries.push({ source, input });

        input.addEventListener("change", () => {
          if (!input.checked) {
            input.checked = true;
            return;
          }
          selectedSource = source;
          for (const entry of checkboxEntries) {
            entry.input.checked = entry.source === selectedSource;
          }
        });
      };

      addOption(NONE_SOURCE, "None");
      for (const variant of variants) {
        addOption(variant.id, variant.name);
      }

      const errorText = document.createElement("div");
      errorText.style.minHeight = "18px";
      errorText.style.color = "#ff9ea9";
      errorText.style.fontSize = "12px";
      errorText.style.marginBottom = "8px";
      panel.appendChild(errorText);

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.justifyContent = "flex-end";
      actions.style.gap = "10px";
      panel.appendChild(actions);

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.textContent = "Cancel";
      cancelButton.style.padding = "8px 12px";
      cancelButton.style.borderRadius = "8px";
      cancelButton.style.border = "1px solid #6675b6";
      cancelButton.style.background = "#1f2948";
      cancelButton.style.color = "#e8eeff";
      actions.appendChild(cancelButton);

      const createButton = document.createElement("button");
      createButton.type = "button";
      createButton.textContent = "Create";
      createButton.style.padding = "8px 12px";
      createButton.style.borderRadius = "8px";
      createButton.style.border = "1px solid #8aa1ff";
      createButton.style.background = "#2f438a";
      createButton.style.color = "#f2f6ff";
      actions.appendChild(createButton);

      const finish = (result: DeckVariantDialogResult | null): void => {
        window.removeEventListener("keydown", onWindowKeyDown, true);
        this.closeDeckVariantDialog();
        resolve(result);
      };

      const onWindowKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      };

      const submit = (): void => {
        const name = nameInput.value.trim();
        if (!name) {
          errorText.textContent = "Variant name is required.";
          nameInput.focus();
          return;
        }
        finish({
          name,
          sourceVariantId: selectedSource === NONE_SOURCE ? null : selectedSource,
        });
      };

      cancelButton.addEventListener("click", () => finish(null));
      createButton.addEventListener("click", submit);
      overlay.addEventListener("mousedown", (event) => {
        if (event.target === overlay) {
          finish(null);
        }
      });

      this.deckVariantDialogKeydownHandler = onWindowKeyDown;
      window.addEventListener("keydown", onWindowKeyDown, true);
      document.body.appendChild(overlay);
      this.deckVariantDialogRoot = overlay;
      nameInput.focus();
      nameInput.select();
    });
  }

  private async createDeckZoneVariant(zoneId: string): Promise<boolean> {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone || zone.type !== "deck") return false;

    const variants = this.ensureDeckZoneVariants(zone);
    const dialogResult = await this.showDeckVariantDialog(zone);
    if (!dialogResult) return false;

    const mainCardIds = this.getDeckZoneMainCardIds(zone);
    const baseVariant =
      dialogResult.sourceVariantId == null
        ? null
        : variants.find((variant) => variant.id === dialogResult.sourceVariantId) ?? null;
    const activeCardIds = (baseVariant?.activeCardIds ?? []).filter((cardId) =>
      mainCardIds.has(cardId),
    );

    const created: CanvasDeckVariant = {
      id: createCanvasDeckVariantId(),
      name: dialogResult.name,
      activeCardIds: [...new Set(activeCardIds)],
    };

    zone.deckVariants = [...variants, created];
    zone.activeDeckVariantId = created.id;
    return true;
  }

  private getZoneCardStackKey(zone: CanvasArea, instance: CanvasCardInstance): string {
    const isLandscape = this.isLandscapeCard(instance.cardName);
    const size = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const centerX = instance.x + size.width / 2;
    const centerY = instance.y + size.height / 2;
    const grid = pixelsToSnapGrid(centerX, centerY, isLandscape);
    const boardKey =
      zone.type === "deck"
        ? this.normalizeDeckBoard(instance.board)
        : instance.board ?? "zone";
    return `${boardKey}:${isLandscape ? "L" : "P"}:${grid.x},${grid.y}`;
  }

  private moveDeckZoneCardToStackBack(zone: CanvasArea, instanceId: string): void {
    if (zone.type !== "deck") return;
    const targetIndex = zone.cards.findIndex((entry) => entry.id === instanceId);
    if (targetIndex < 0) return;
    const target = zone.cards[targetIndex];
    if (!target) return;
    const targetStackKey = this.getZoneCardStackKey(zone, target);

    let firstStackIndex: number | null = null;
    for (let i = 0; i < zone.cards.length; i++) {
      const candidate = zone.cards[i];
      if (!candidate) continue;
      if (this.getZoneCardStackKey(zone, candidate) !== targetStackKey) continue;
      firstStackIndex = i;
      break;
    }
    if (firstStackIndex == null || firstStackIndex === targetIndex) {
      return;
    }

    const [removed] = zone.cards.splice(targetIndex, 1);
    if (!removed) return;
    zone.cards.splice(firstStackIndex, 0, removed);
  }

  private toggleDeckZoneCardActive(zoneId: string, instanceId: string): boolean {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone || zone.type !== "deck") return false;
    const instance = zone.cards.find((entry) => entry.id === instanceId);
    if (!instance) return false;
    if (this.normalizeDeckBoard(instance.board) !== "mainboard") return false;

    const activeVariant = this.getActiveDeckZoneVariant(zone);
    if (!activeVariant) return false;

    if (activeVariant.activeCardIds.includes(instanceId)) {
      activeVariant.activeCardIds = activeVariant.activeCardIds.filter(
        (cardId) => cardId !== instanceId,
      );
      this.moveDeckZoneCardToStackBack(zone, instanceId);
    } else {
      activeVariant.activeCardIds = [...activeVariant.activeCardIds, instanceId];
    }
    return true;
  }

  private removeDeckVariantCardReferences(
    zone: CanvasArea,
    removedCardIds: Iterable<string>,
  ): void {
    if (zone.type !== "deck") return;
    const variants = this.ensureDeckZoneVariants(zone);
    const removed = new Set(removedCardIds);
    if (removed.size === 0) return;
    for (const variant of variants) {
      variant.activeCardIds = variant.activeCardIds.filter((cardId) => !removed.has(cardId));
    }
  }

  private syncDeckVariantForBoardChange(
    zone: CanvasArea,
    instanceId: string,
    board: DeckZoneBoard,
  ): void {
    if (zone.type !== "deck") return;
    const variants = this.ensureDeckZoneVariants(zone);
    if (board !== "mainboard") {
      for (const variant of variants) {
        variant.activeCardIds = variant.activeCardIds.filter((cardId) => cardId !== instanceId);
      }
      return;
    }

    const activeVariant = this.getActiveDeckZoneVariant(zone);
    if (!activeVariant) return;
    if (!activeVariant.activeCardIds.includes(instanceId)) {
      activeVariant.activeCardIds = [...activeVariant.activeCardIds, instanceId];
    }
  }

  private registerDeckVariantAdditions(
    zone: CanvasArea,
    additions: CanvasCardInstance[],
  ): void {
    if (zone.type !== "deck" || additions.length === 0) return;
    const activeVariant = this.getActiveDeckZoneVariant(zone);
    if (!activeVariant) return;
    const nextIds = new Set(activeVariant.activeCardIds);
    for (const addition of additions) {
      if (this.normalizeDeckBoard(addition.board) === "mainboard") {
        nextIds.add(addition.id);
      }
    }
    activeVariant.activeCardIds = [...nextIds];
  }

  private getZoneCardAtPosition(
    worldPos: { x: number; y: number },
    options?: { zoneId?: string },
  ): ZoneCardSpriteData | null {
    let top: ZoneCardSpriteData | null = null;
    let topZ = -Infinity;
    let topOrder = -Infinity;

    for (const data of this.zoneCardSprites.values()) {
      if (options?.zoneId && data.zoneId !== options.zoneId) continue;
      if (!this.pointInBounds(worldPos, data.bounds)) continue;

      const z = data.sprite.zIndex;
      const order = this.zoneContainer.getChildIndex(data.sprite);
      if (z > topZ || (z === topZ && order > topOrder)) {
        top = data;
        topZ = z;
        topOrder = order;
      }
    }

    return top;
  }

  private getZoneAtPosition(worldPos: { x: number; y: number }): CanvasArea | null {
    const pinnedZones = this.canvasAreas.filter((zone) => zone.pinned);
    for (let i = pinnedZones.length - 1; i >= 0; i--) {
      const zone = pinnedZones[i];
      if (!zone) continue;
      if (
        worldPos.x >= zone.bounds.x &&
        worldPos.x <= zone.bounds.x + zone.bounds.width &&
        worldPos.y >= zone.bounds.y &&
        worldPos.y <= zone.bounds.y + zone.bounds.height
      ) {
        return zone;
      }
    }
    return null;
  }

  private getZoneHeaderAtPosition(worldPos: { x: number; y: number }): CanvasArea | null {
    const pinnedZones = this.canvasAreas.filter((zone) => zone.pinned);
    for (let i = pinnedZones.length - 1; i >= 0; i--) {
      const zone = pinnedZones[i];
      if (!zone) continue;
      const headerHeight = this.getZoneHeaderHeight(zone);
      const headerBounds = this.zoneHeaderBounds.get(zone.id)?.bounds ?? {
        left: zone.bounds.x,
        top: zone.bounds.y,
        right: zone.bounds.x + zone.bounds.width,
        bottom: zone.bounds.y + headerHeight,
      };
      if (this.pointInBounds(worldPos, headerBounds)) {
        return zone;
      }
    }
    return null;
  }

  private getZoneCloseTargetAtPosition(
    worldPos: { x: number; y: number },
  ): CanvasArea | null {
    const pinnedZones = this.canvasAreas.filter((zone) => zone.pinned);
    for (let i = pinnedZones.length - 1; i >= 0; i--) {
      const zone = pinnedZones[i];
      if (!zone) continue;
      const closeBounds = this.zoneHeaderBounds.get(zone.id)?.closeBounds;
      if (!closeBounds) continue;
      if (this.pointInBounds(worldPos, closeBounds)) {
        return zone;
      }
    }
    return null;
  }

  private getZoneSortTargetAtPosition(
    worldPos: { x: number; y: number },
  ): CanvasArea | null {
    const pinnedZones = this.canvasAreas.filter((zone) => zone.pinned);
    for (let i = pinnedZones.length - 1; i >= 0; i--) {
      const zone = pinnedZones[i];
      if (!zone) continue;
      const sortBounds = this.zoneHeaderBounds.get(zone.id)?.sortBounds;
      if (!sortBounds) continue;
      if (this.pointInBounds(worldPos, sortBounds)) {
        return zone;
      }
    }
    return null;
  }

  private getZoneFilterTargetAtPosition(
    worldPos: { x: number; y: number },
  ): CanvasArea | null {
    const pinnedZones = this.canvasAreas.filter((zone) => zone.pinned);
    for (let i = pinnedZones.length - 1; i >= 0; i--) {
      const zone = pinnedZones[i];
      if (!zone || zone.type !== "deck") continue;
      const filterBounds = this.zoneHeaderBounds.get(zone.id)?.filterBounds;
      if (!filterBounds) continue;
      if (this.pointInBounds(worldPos, filterBounds)) {
        return zone;
      }
    }
    return null;
  }

  private getDeckFilterChipTargetAtPosition(
    worldPos: { x: number; y: number },
  ): { zone: CanvasArea; clauseIndex: number; removeHovered: boolean } | null {
    const pinnedZones = this.canvasAreas.filter((zone) => zone.pinned && zone.type === "deck");
    for (let i = pinnedZones.length - 1; i >= 0; i--) {
      const zone = pinnedZones[i];
      if (!zone) continue;
      const chipBounds = this.zoneHeaderBounds.get(zone.id)?.filterChipBounds ?? [];
      for (const chip of chipBounds) {
        const removeHovered =
          chip.removeBounds != null && this.pointInBounds(worldPos, chip.removeBounds);
        if (removeHovered || this.pointInBounds(worldPos, chip.bounds)) {
          return { zone, clauseIndex: chip.clauseIndex, removeHovered };
        }
      }
    }
    return null;
  }

  private updateDeckFilterChipHover(worldPos: { x: number; y: number }): void {
    const target = this.getDeckFilterChipTargetAtPosition(worldPos);
    const next = target
      ? {
          zoneId: target.zone.id,
          clauseIndex: target.clauseIndex,
          removeHovered: target.removeHovered,
        }
      : null;
    const previous = this.hoveredDeckFilterChip;
    const unchanged =
      previous?.zoneId === next?.zoneId &&
      previous?.clauseIndex === next?.clauseIndex &&
      previous?.removeHovered === next?.removeHovered;
    if (unchanged) return;

    this.hoveredDeckFilterChip = next;
    this.rebuildZoneVisuals();
  }

  private getDeckFilterAnchorClientRect(
    zoneId: string,
  ): { left: number; top: number; right: number; bottom: number } | null {
    if (!this.camera) return null;
    const filterBounds = this.zoneHeaderBounds.get(zoneId)?.filterBounds;
    if (!filterBounds) return null;

    const topLeft = this.camera.viewport.toScreen(filterBounds.left, filterBounds.top);
    const bottomRight = this.camera.viewport.toScreen(filterBounds.right, filterBounds.bottom);
    const canvasRect = this.app.canvas.getBoundingClientRect();
    return {
      left: canvasRect.left + topLeft.x,
      top: canvasRect.top + topLeft.y,
      right: canvasRect.left + bottomRight.x,
      bottom: canvasRect.top + bottomRight.y,
    };
  }

  private openDeckFilterRequest(zoneId: string, editingFilterIndex: number | null): void {
    const anchorClientRect = this.getDeckFilterAnchorClientRect(zoneId);
    if (!anchorClientRect) return;
    this.onDeckFilterRequest?.({
      zoneId,
      editingFilterIndex,
      anchorClientRect,
    });
  }

  private updateDeckZoneFilters(zoneId: string, filters: CardFilterState): boolean {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId && entry.type === "deck");
    if (!zone) return false;
    zone.cardFilters = ensureCardFilterState(filters);
    return true;
  }

  private removeDeckFilterClause(zoneId: string, clauseIndex: number): boolean {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId && entry.type === "deck");
    if (!zone) return false;

    const filters = ensureCardFilterState(zone.cardFilters);
    if (clauseIndex < 0 || clauseIndex >= filters.clauses.length) return false;
    const nextClauses = filters.clauses.filter((_, index) => index !== clauseIndex);
    return this.updateDeckZoneFilters(zoneId, {
      ...filters,
      clauses: nextClauses,
    });
  }

  private getVisibleDeckZoneCards(
    zone: CanvasArea,
    filteredCardNameCache: Map<string, Set<string>>,
  ): CanvasCardInstance[] {
    const filters = ensureCardFilterState(zone.cardFilters);
    if (!isCardFilterActive(filters)) {
      return zone.cards;
    }

    const cacheKey = JSON.stringify(filters.clauses);
    let visibleCardNames = filteredCardNameCache.get(cacheKey);
    if (!visibleCardNames) {
      visibleCardNames = new Set(
        applyCardFilters(this.cards, filters).map((card) => card.name),
      );
      filteredCardNameCache.set(cacheKey, visibleCardNames);
    }

    return zone.cards.filter((instance) => visibleCardNames.has(instance.cardName));
  }

  private getZoneVariantTabTargetAtPosition(
    worldPos: { x: number; y: number },
  ): { zone: CanvasArea; variantId: string | null; isAdd: boolean } | null {
    const pinnedZones = this.canvasAreas.filter((zone) => zone.pinned);
    for (let i = pinnedZones.length - 1; i >= 0; i--) {
      const zone = pinnedZones[i];
      if (!zone || zone.type !== "deck") continue;
      const tabBounds = this.zoneHeaderBounds.get(zone.id)?.variantTabBounds ?? [];
      for (const tab of tabBounds) {
        if (this.pointInBounds(worldPos, tab.bounds)) {
          return {
            zone,
            variantId: tab.isAdd ? null : tab.variantId,
            isAdd: tab.isAdd,
          };
        }
      }
    }
    return null;
  }

  private layoutZoneBoardCards(
    cards: CanvasCardInstance[],
    options: {
      left: number;
      top: number;
      width: number;
      leadingGap: number;
      minHeight: number;
    },
  ): number {
    if (cards.length === 0) {
      return options.top + options.minHeight;
    }

    const stacksByName = new Map<
      string,
      {
        cardName: string;
        type: CardType | null;
        cost: number;
        instances: CanvasCardInstance[];
      }
    >();
    for (const card of cards) {
      const stack = stacksByName.get(card.cardName);
      if (stack) {
        stack.instances.push(card);
        continue;
      }
      stacksByName.set(card.cardName, {
        cardName: card.cardName,
        type: this.getCardType(card.cardName),
        cost: this.getCardCost(card.cardName),
        instances: [card],
      });
    }

    const sortedStacks = Array.from(stacksByName.values()).sort((left, right) => {
      const typeDelta =
        this.getZoneSortTypeRank(left.type) - this.getZoneSortTypeRank(right.type);
      if (typeDelta !== 0) return typeDelta;

      const costDelta = left.cost - right.cost;
      if (costDelta !== 0) return costDelta;

      return left.cardName.localeCompare(right.cardName);
    });

    const groups = new Map<
      "Minion" | "Magic" | "Aura" | "Artifact" | "Site" | "Avatar" | "other",
      typeof sortedStacks
    >();
    for (const stack of sortedStacks) {
      const key = this.getZoneSortGroup(stack.type);
      const list = groups.get(key) ?? [];
      list.push(stack);
      groups.set(key, list);
    }

    const groupOrder = [
      "Minion",
      "Magic",
      "Aura",
      "Artifact",
      "Site",
      "Avatar",
      "other",
    ] as const;
    const nonEmptyGroups = groupOrder.filter(
      (key) => (groups.get(key)?.length ?? 0) > 0,
    );

    let groupTop = options.top + options.leadingGap;
    let boardBottom = options.top + options.minHeight;
    const availableWidth = Math.max(CARD_SIZE.PORTRAIT.width, options.width);

    nonEmptyGroups.forEach((groupKey, groupIndex) => {
      const groupStacks = groups.get(groupKey) ?? [];
      const isLandscape = groupKey === "Site";
      const cardSize = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      const spacing = isLandscape
        ? CARD_CELL_SPACING.LANDSCAPE
        : CARD_CELL_SPACING.PORTRAIT;
      const stepX = spacing.x * DRAWN_GRID.width;
      const stepY = spacing.y * DRAWN_GRID.height;
      const columns = Math.max(
        1,
        Math.floor((availableWidth - cardSize.width) / stepX) + 1,
      );

      let groupBottom = groupTop;
      groupStacks.forEach((stack, stackIndex) => {
        const col = stackIndex % columns;
        const row = Math.floor(stackIndex / columns);
        const x = options.left + col * stepX;
        const y = groupTop + row * stepY;
        const snapped = snapCardCenter(
          x + cardSize.width / 2,
          y + cardSize.height / 2,
          isLandscape,
        );
        const snappedLeft = snapped.x - cardSize.width / 2;
        const nextX = snappedLeft < x ? snappedLeft + DRAWN_GRID.width : snappedLeft;
        const nextY = snapped.y - cardSize.height / 2;

        stack.instances.forEach((instance) => {
          instance.x = nextX;
          instance.y = nextY;
        });
        groupBottom = Math.max(
          groupBottom,
          nextY + cardSize.height + ZONE_DECK_BOARD_BOTTOM_PADDING,
        );
      });

      boardBottom = Math.max(boardBottom, groupBottom);
      groupTop =
        groupBottom +
        (groupIndex < nonEmptyGroups.length - 1 ? ZONE_DECK_TYPE_GAP : 0);
    });

    return boardBottom;
  }

  private requestZoneLayoutReset(zoneId: string): void {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (zone?.type === 'deck') this.onDeckLayoutResetRequest?.(zoneId);
    else if (zone) this.sortZoneCards(zoneId);
  }

  /** Called only after the UI confirms. Preserve IDs, board membership and variants. */
  resetDeckLayout(zoneId: string): void {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone || zone.type !== 'deck') return;
    zone.bounds.width = DECK_MIN_WIDTH;
    zone.bounds.height = 0;
    if (zone.cards.length === 0) {
      this.fitDeckSections(zone);
      this.rebuildZoneVisuals();
      this.emitCanvasAreasChange();
    } else {
      this.sortZoneCards(zoneId);
    }
  }

  private sortZoneCards(
    zoneId: string,
    options?: { emitChange?: boolean },
  ): void {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone || zone.cards.length === 0) return;

    const nextCards = zone.cards.map((card) => ({ ...card }));
    const headerHeight = this.getZoneHeaderHeight(zone);
    const bodyLeft = zone.bounds.x + ZONE_BODY_PADDING;
    const bodyTop = zone.bounds.y + headerHeight + ZONE_BODY_PADDING;
    const bodyWidth = Math.max(
      CARD_SIZE.PORTRAIT.width,
      zone.bounds.width - ZONE_BODY_PADDING * 2,
    );

    if (zone.type === "deck") {
      let cursorY = bodyTop;
      for (const board of DECK_BOARD_ORDER) {
        const boardCards = nextCards.filter((card) => {
          const normalizedBoard = this.normalizeDeckBoard(card.board);
          if (normalizedBoard !== board) return false;
          card.board = normalizedBoard;
          return true;
        });
        const boardBottom = this.layoutZoneBoardCards(boardCards, {
          left: bodyLeft + ZONE_DECK_BOARD_INNER_LEFT,
          top: cursorY,
          width: getDeckBoardWidth(board, Math.max(zone.bounds.width, DECK_MIN_WIDTH)) - ZONE_DECK_BOARD_INNER_LEFT * 2,
          leadingGap: ZONE_DECK_CARD_TOP_GAP,
          minHeight: ZONE_DECK_MIN_BOARD_HEIGHT[board],
        });
        cursorY = boardBottom + ZONE_DECK_BOARD_GAP;
      }

      this.ensureDeckZoneVariants(zone);
    } else {
      this.layoutZoneBoardCards(nextCards, {
        left: bodyLeft + ZONE_DECK_BOARD_INNER_LEFT,
        top: bodyTop,
        width: bodyWidth - ZONE_DECK_BOARD_INNER_LEFT * 2,
        leadingGap: 0,
        minHeight: CARD_SIZE.PORTRAIT.height + ZONE_BODY_PADDING,
      });
    }

    const previousLabels = this.canvasLabels ?? [];
    this.canvasLabels = repositionLabelsAfterCardLayout(previousLabels, zone.id, zone.cards, nextCards);
    zone.cards = nextCards;
    this.reconcileCanvasAreaBounds(zone.id, { preserveTopLeft: true });
    this.rebuildZoneVisuals();
    if (options?.emitChange ?? true) {
      this.playAreaEffect('sort', zone);
      this.emitCanvasAreasChange();
      if (this.canvasLabels !== previousLabels) this.emitCanvasLabelsChange();
    }
  }

  private hideZoneFromCanvas(zoneId: string): void {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone || !zone.pinned) return;
    this.playAreaEffect('hide', zone);
    zone.pinned = false;
    this.rebuildZoneVisuals();
    this.emitCanvasAreasChange();
  }

  private getDeleteButtonBounds(data: ZoneCardSpriteData): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    return {
      left: data.bounds.right - ZONE_DELETE_SIZE - 4,
      top: data.bounds.top + 4,
      right: data.bounds.right - 4,
      bottom: data.bounds.top + ZONE_DELETE_SIZE + 4,
    };
  }

  private getDuplicateButtonBounds(data: ZoneCardSpriteData): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    const deleteBounds = this.getDeleteButtonBounds(data);
    return {
      left: deleteBounds.left - ZONE_DELETE_SIZE - ZONE_CARD_ACTION_GAP,
      top: deleteBounds.top,
      right: deleteBounds.left - ZONE_CARD_ACTION_GAP,
      bottom: deleteBounds.bottom,
    };
  }

  private canDuplicateZoneCard(data: ZoneCardSpriteData): boolean {
    const zone = this.canvasAreas.find((entry) => entry.id === data.zoneId);
    return zone?.type === "deck";
  }

  private drawZoneDeleteOverlay(): void {
    if (!this.zoneDeleteOverlay) return;
    this.zoneDeleteOverlay.clear();

    if (!this.hoveredZoneCardKey) return;
    const data = this.zoneCardSprites.get(this.hoveredZoneCardKey);
    if (!data) return;

    if (this.canDuplicateZoneCard(data)) {
      const duplicateBounds = this.getDuplicateButtonBounds(data);
      const duplicateCenterX = (duplicateBounds.left + duplicateBounds.right) / 2;
      const duplicateCenterY = (duplicateBounds.top + duplicateBounds.bottom) / 2;
      const duplicateRadius = (duplicateBounds.right - duplicateBounds.left) / 2;

      this.zoneDeleteOverlay.circle(duplicateCenterX, duplicateCenterY, duplicateRadius);
      this.zoneDeleteOverlay.fill({ color: MANGA_PALETTE.raised, alpha: 0.95 });
      this.zoneDeleteOverlay.stroke({ width: 1.5, color: MANGA_PALETTE.gold, alpha: 0.85 });
      this.zoneDeleteOverlay.moveTo(duplicateBounds.left + 4, duplicateCenterY);
      this.zoneDeleteOverlay.lineTo(duplicateBounds.right - 4, duplicateCenterY);
      this.zoneDeleteOverlay.moveTo(duplicateCenterX, duplicateBounds.top + 4);
      this.zoneDeleteOverlay.lineTo(duplicateCenterX, duplicateBounds.bottom - 4);
      this.zoneDeleteOverlay.stroke({ width: 1.45, color: MANGA_PALETTE.paper, alpha: 0.94 });
    }

    const bounds = this.getDeleteButtonBounds(data);
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    const radius = (bounds.right - bounds.left) / 2;

    const armed = this.armedDelete?.key === data.key && Date.now() <= this.armedDelete.expires;
    if (armed) {
      this.zoneDeleteOverlay.circle(centerX, centerY, radius + 7);
      this.zoneDeleteOverlay.fill({ color: MANGA_PALETTE.danger, alpha: 0.3 });
      this.zoneDeleteOverlay.rect(data.bounds.left - 3, data.bounds.top - 3, data.displaySize.width + 6, data.displaySize.height + 6);
      this.zoneDeleteOverlay.stroke({ width: 3, color: MANGA_PALETTE.danger, alpha: 0.95 });
    }
    this.zoneDeleteOverlay.circle(centerX, centerY, radius);
    this.zoneDeleteOverlay.fill({ color: armed ? 0xdb263e : MANGA_PALETTE.ink, alpha: 0.94 });
    this.zoneDeleteOverlay.stroke({ width: 1.5, color: MANGA_PALETTE.paper, alpha: 0.8 });
    this.zoneDeleteOverlay.moveTo(bounds.left + 4, bounds.top + 4);
    this.zoneDeleteOverlay.lineTo(bounds.right - 4, bounds.bottom - 4);
    this.zoneDeleteOverlay.moveTo(bounds.right - 4, bounds.top + 4);
    this.zoneDeleteOverlay.lineTo(bounds.left + 4, bounds.bottom - 4);
    this.zoneDeleteOverlay.stroke({ width: 1.4, color: MANGA_PALETTE.paper, alpha: 0.92 });
  }

  private ensureDeckGraphHoverTooltip(): {
    box: Graphics;
    text: Text;
  } {
    if (!this.deckGraphTooltipBox || !this.deckGraphTooltipText) {
      const box = new Graphics();
      box.zIndex = 9_999_998;
      box.visible = false;
      const text = new Text({
        text: "",
        style: {
          fontFamily: "Arial",
          fontSize: 9,
          fill: 0xecf1ff,
          fontWeight: "normal",
          stroke: ZONE_DECK_STATS_TEXT_STROKE,
        },
      });
      this.configureTextQuality(text);
      text.zIndex = 9_999_999;
      text.visible = false;
      this.zoneContainer.addChild(box);
      this.zoneContainer.addChild(text);
      this.deckGraphTooltipBox = box;
      this.deckGraphTooltipText = text;
    }
    return {
      box: this.deckGraphTooltipBox,
      text: this.deckGraphTooltipText,
    };
  }

  private ensureDeckGraphHoverDots(): Graphics {
    if (!this.deckGraphHoverDots) {
      const dots = new Graphics();
      dots.zIndex = 9_999_997;
      dots.visible = false;
      this.zoneContainer.addChild(dots);
      this.deckGraphHoverDots = dots;
    }
    return this.deckGraphHoverDots;
  }

  private drawDeckGraphHoverDots(region: DeckGraphHoverRegion, index: number): void {
    const dots = this.ensureDeckGraphHoverDots();
    dots.clear();

    const pointCount = Math.max(1, region.manaCosts.length);
    const span = Math.max(1, pointCount - 1);
    const x =
      pointCount === 1
        ? region.bounds.left + (region.bounds.right - region.bounds.left) / 2
        : region.bounds.left +
          (index / span) * (region.bounds.right - region.bounds.left);
    const maxY = region.series.reduce((best, entry) => {
      for (const value of entry.values) {
        if (value > best) best = value;
      }
      return best;
    }, 0);

    if (maxY <= 0) {
      dots.visible = false;
      return;
    }

    for (const entry of region.series) {
      if (entry.values.every((value) => value <= 0)) continue;
      const value = entry.values[index] ?? 0;
      const y =
        region.bounds.bottom -
        (value / maxY) * (region.bounds.bottom - region.bounds.top);
      dots.circle(x, y, ZONE_DECK_GRAPH_HOVER_DOT_RADIUS);
      dots.fill({ color: entry.color, alpha: 0.97 });
      dots.circle(x, y, ZONE_DECK_GRAPH_HOVER_DOT_RADIUS + 0.95);
      dots.stroke({ width: 1, color: 0xf6f9ff, alpha: 0.85 });
    }
    dots.visible = true;
  }

  private hideDeckGraphHoverTooltip(): void {
    if (this.deckGraphTooltipBox) {
      this.deckGraphTooltipBox.visible = false;
    }
    if (this.deckGraphTooltipText) {
      this.deckGraphTooltipText.visible = false;
    }
    if (this.deckGraphHoverDots) {
      this.deckGraphHoverDots.visible = false;
      this.deckGraphHoverDots.clear();
    }
  }

  private destroyDeckGraphHoverTooltip(): void {
    this.deckGraphTooltipBox?.destroy();
    this.deckGraphTooltipText?.destroy();
    this.deckGraphHoverDots?.destroy();
    this.deckGraphTooltipBox = null;
    this.deckGraphTooltipText = null;
    this.deckGraphHoverDots = null;
  }

  private ensureAssociationTooltip(): {
    box: Graphics;
    text: Text;
  } {
    if (!this.associationTooltipBox || !this.associationTooltipText) {
      const box = new Graphics();
      box.zIndex = 9_999_998;
      box.visible = false;
      const text = new Text({
        text: "",
        style: {
          fontFamily: "Arial",
          fontSize: 10,
          fill: 0xecf1ff,
          fontWeight: "normal",
          stroke: { color: 0x050814, width: 3 },
        },
      });
      this.configureTextQuality(text);
      text.zIndex = 9_999_999;
      text.visible = false;
      this.cardContainer.addChild(box);
      this.cardContainer.addChild(text);
      this.associationTooltipBox = box;
      this.associationTooltipText = text;
    }
    return {
      box: this.associationTooltipBox,
      text: this.associationTooltipText,
    };
  }

  private hideAssociationTooltip(): void {
    if (this.associationTooltipBox) {
      this.associationTooltipBox.visible = false;
    }
    if (this.associationTooltipText) {
      this.associationTooltipText.visible = false;
    }
  }

  private destroyAssociationTooltip(): void {
    this.associationTooltipBox?.destroy();
    this.associationTooltipText?.destroy();
    this.associationTooltipBox = null;
    this.associationTooltipText = null;
  }

  private updateAssociationTooltip(
    worldPos: { x: number; y: number },
    cardName: string | null,
    cardType: CardType | null = null,
  ): void {
    void cardType;
    if (!cardName) {
      this.hideAssociationTooltip();
      return;
    }

    const categoryScore = this.selectedCardCategoryId
      ? getCategoryScore(
          this.cardCategoryData,
          cardName,
          this.selectedCardCategoryId,
        )
      : 0;
    const styleScore =
      !this.selectedCardCategoryId && this.associationsEnabled
        ? getDeckStyleCardScore(
            this.deckStyleAssociations,
            this.deckStyleAssociationMode,
            this.selectedAssociationStyleId,
            this.selectedAssociationSubStyleId,
            cardName,
          )
        : 0;
    if (categoryScore <= 0 && styleScore <= 0) {
      this.hideAssociationTooltip();
      return;
    }

    const lines = [cardName];
    if (categoryScore > 0) lines.push(`Category: ${formatCategoryScore(categoryScore)}`);
    if (styleScore > 0) lines.push(`Deck style: ${formatCategoryScore(styleScore)}`);

    const tooltip = this.ensureAssociationTooltip();
    tooltip.text.text = lines.join("\n");
    const paddingX = 8;
    const paddingY = 6;
    const boxWidth = tooltip.text.width + paddingX * 2;
    const boxHeight = tooltip.text.height + paddingY * 2;
    let boxX = worldPos.x + 12;
    let boxY = worldPos.y - boxHeight - 10;

    const viewBounds = this.camera?.getVisibleBounds();
    if (viewBounds) {
      boxX = Math.max(
        viewBounds.left + 4,
        Math.min(boxX, viewBounds.right - boxWidth - 4),
      );
      boxY = Math.max(
        viewBounds.top + 4,
        Math.min(boxY, viewBounds.bottom - boxHeight - 4),
      );
    }

    tooltip.box.clear();
    tooltip.box.roundRect(boxX, boxY, boxWidth, boxHeight, 6);
    tooltip.box.fill({ color: 0x111a35, alpha: 0.94 });
    tooltip.box.stroke({ width: 1, color: 0x5f7fe8, alpha: 0.86 });
    tooltip.box.visible = true;

    tooltip.text.x = Math.round(boxX + paddingX);
    tooltip.text.y = Math.round(boxY + paddingY);
    tooltip.text.visible = true;
  }

  private getDeckGraphHoverRegionAtPosition(
    worldPos: { x: number; y: number },
  ): DeckGraphHoverRegion | null {
    const pinnedZones = this.canvasAreas.filter((zone) => zone.pinned);
    for (let i = pinnedZones.length - 1; i >= 0; i--) {
      const zone = pinnedZones[i];
      if (!zone || zone.type !== "deck") continue;
      const regions = this.zoneHeaderBounds.get(zone.id)?.graphHoverRegions ?? [];
      for (const region of regions) {
        if (this.pointInBounds(worldPos, region.bounds)) {
          return region;
        }
      }
    }
    return null;
  }

  private updateDeckGraphHoverTooltip(worldPos: { x: number; y: number }): void {
    const region = this.getDeckGraphHoverRegionAtPosition(worldPos);
    if (!region || region.manaCosts.length === 0) {
      this.hideDeckGraphHoverTooltip();
      return;
    }

    const span = Math.max(1, region.manaCosts.length - 1);
    const width = Math.max(1, region.bounds.right - region.bounds.left);
    const ratio = Math.max(
      0,
      Math.min(1, (worldPos.x - region.bounds.left) / width),
    );
    const index = Math.round(ratio * span);
    const manaCost = region.manaCosts[index] ?? index;
    const lines = [`Mana ${manaCost}`];
    for (const entry of region.series) {
      const value = entry.values[index] ?? 0;
      lines.push(`${entry.label}: ${value.toFixed(entry.decimals)}`);
    }

    const tooltip = this.ensureDeckGraphHoverTooltip();
    tooltip.text.text = lines.join("\n");
    const paddingX = 7;
    const paddingY = 5;
    const boxWidth = tooltip.text.width + paddingX * 2;
    const boxHeight = tooltip.text.height + paddingY * 2;
    let boxX = worldPos.x + 12;
    let boxY = worldPos.y - boxHeight - 10;

    const viewBounds = this.camera?.getVisibleBounds();
    if (viewBounds) {
      boxX = Math.max(
        viewBounds.left + 4,
        Math.min(boxX, viewBounds.right - boxWidth - 4),
      );
      boxY = Math.max(
        viewBounds.top + 4,
        Math.min(boxY, viewBounds.bottom - boxHeight - 4),
      );
    }

    tooltip.box.clear();
    tooltip.box.roundRect(boxX, boxY, boxWidth, boxHeight, 6);
    tooltip.box.fill({ color: 0x111a35, alpha: 0.94 });
    tooltip.box.stroke({ width: 1, color: 0x94a7f2, alpha: 0.86 });
    tooltip.box.visible = true;

    tooltip.text.x = Math.round(boxX + paddingX);
    tooltip.text.y = Math.round(boxY + paddingY);
    tooltip.text.visible = true;
    this.drawDeckGraphHoverDots(region, index);
  }

  private updateHoveredFromWorldPos(worldPos: { x: number; y: number }): void {
    this.updateDeckFilterChipHover(worldPos);
    const zoneCard = this.getZoneCardAtPosition(worldPos);
    const zoneUnderPointer = this.getZoneAtPosition(worldPos);

    this.hoveredZoneCardKey = zoneCard?.key ?? null;
    this.drawZoneDeleteOverlay();

    if (zoneCard) {
      this.setHoveredCard(zoneCard.cardName);
      this.updateDeckGraphHoverTooltip(worldPos);
      this.updateAssociationTooltip(worldPos, zoneCard.cardName, zoneCard.cardType);
      return;
    }

    if (zoneUnderPointer) {
      this.setHoveredCard(null);
      this.updateDeckGraphHoverTooltip(worldPos);
      this.updateAssociationTooltip(worldPos, null);
      return;
    }

    const cardKey = this.getCardAtPosition(worldPos);
    if (!cardKey) {
      this.setHoveredCard(null);
      this.updateDeckGraphHoverTooltip(worldPos);
      this.updateAssociationTooltip(worldPos, null);
      return;
    }

    const data = this.getSpriteData(cardKey);
    const cardName = data?.layout.name ?? null;
    this.setHoveredCard(cardName);
    this.updateDeckGraphHoverTooltip(worldPos);
    this.updateAssociationTooltip(worldPos, cardName, data?.layout.type ?? null);
  }

  private onPointerDown(event: FederatedPointerEvent): void {
    if (!this.camera) return;
    this.clearQuickTransferHold();

    if (this.isTouchPointer(event)) {
      this.onTouchPointerDown(event);
      return;
    }
    if (this.shouldIgnorePostTouchMouseEvent(event)) {
      this.cancelSelectionBox();
      return;
    }

    this.pendingCardClick = null;
    this.pendingZoneCardClick = null;

    if (event.button !== 0 || this.spacePanHeld) {
      this.desktopPanStart = this.getPointerScreenPosition(event);
      return;
    }
    this.desktopPanStart = null;

    const isCtrlHeld = event.ctrlKey || event.metaKey;
    const isShiftHeld = event.shiftKey;

    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);
    this.lastPointerScreenPos = { x: event.globalX, y: event.globalY };
    this.clearZoneDropPreview();
    const clickedZoneVariantTab = this.getZoneVariantTabTargetAtPosition(worldPos);
    if (clickedZoneVariantTab) {
      this.cancelSelectionBox();
      if (clickedZoneVariantTab.isAdd) {
        this.pointerDownOnSelectedCard = false;
        void this.createDeckZoneVariant(clickedZoneVariantTab.zone.id).then((changed) => {
          if (!changed || this.isDestroyed) return;
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
        });
      } else {
        const changed = clickedZoneVariantTab.variantId
          ? this.setActiveDeckZoneVariant(
              clickedZoneVariantTab.zone.id,
              clickedZoneVariantTab.variantId,
            )
          : false;
        if (changed) {
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
        }
      }
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    const clickedZoneSort = this.getZoneSortTargetAtPosition(worldPos);
    if (clickedZoneSort) {
      this.cancelSelectionBox();
      this.requestZoneLayoutReset(clickedZoneSort.id);
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    const clickedZoneFilterChip = this.getDeckFilterChipTargetAtPosition(worldPos);
    if (clickedZoneFilterChip) {
      this.cancelSelectionBox();
      if (clickedZoneFilterChip.removeHovered) {
        const changed = this.removeDeckFilterClause(
          clickedZoneFilterChip.zone.id,
          clickedZoneFilterChip.clauseIndex,
        );
        if (changed) {
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
        }
      } else {
        this.openDeckFilterRequest(
          clickedZoneFilterChip.zone.id,
          clickedZoneFilterChip.clauseIndex,
        );
      }
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    const clickedZoneFilter = this.getZoneFilterTargetAtPosition(worldPos);
    if (clickedZoneFilter) {
      this.cancelSelectionBox();
      this.openDeckFilterRequest(clickedZoneFilter.id, null);
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    const clickedZoneClose = this.getZoneCloseTargetAtPosition(worldPos);
    if (clickedZoneClose) {
      this.cancelSelectionBox();
      this.hideZoneFromCanvas(clickedZoneClose.id);
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    const clickedZoneCard = this.getZoneCardAtPosition(worldPos);
    const clickedZoneHeader = this.getZoneHeaderAtPosition(worldPos);
    if (
      this.hoveredZoneCardKey &&
      clickedZoneCard &&
      clickedZoneCard.key === this.hoveredZoneCardKey
    ) {
      if (this.canDuplicateZoneCard(clickedZoneCard)) {
        const duplicateBounds = this.getDuplicateButtonBounds(clickedZoneCard);
        if (this.pointInBounds(worldPos, duplicateBounds)) {
          this.duplicateCanvasCardInstance(
            clickedZoneCard.zoneId,
            clickedZoneCard.instanceId,
          );
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
          this.updateHoveredFromWorldPos(worldPos);
          return;
        }
      }

      const deleteBounds = this.getDeleteButtonBounds(clickedZoneCard);
      if (this.pointInBounds(worldPos, deleteBounds)) {
        const rect = this.app.canvas.getBoundingClientRect();
        this.handleZoneCardDelete(
          clickedZoneCard,
          rect.left + event.globalX,
          rect.top + event.globalY,
        );
        this.updateHoveredFromWorldPos(worldPos);
        return;
      }
    }

    this.armedDelete = null;
    const clickedLabel = this.getLabelAtPosition(worldPos);

    // Label placement mode: next left-click places a label.
    if (this.labelPlacementMode) {
      this.addLabelAtPosition(worldPos);
      this.consumeLabelPlacementMode();
      return;
    }

    if (clickedLabel) {
      const now = Date.now();
      const isDoubleClick =
        now - this.lastLabelClickTime < DOUBLE_CLICK_TIME_MS &&
        this.lastClickedLabel === clickedLabel;

      this.lastLabelClickTime = now;
      this.lastClickedLabel = clickedLabel;

      if (isDoubleClick) {
        this.editLabel(clickedLabel);
        return;
      }

      this.startLabelDrag(clickedLabel, worldPos);
      this.camera.pauseDrag();
      return;
    }

    if (clickedZoneCard) {
      this.cancelSelectionBox();
      if (isCtrlHeld) {
        this.startSelectionBox(worldPos, isShiftHeld);
        this.camera.pauseDrag();
        return;
      }

      this.pendingZoneCardClick = {
        zoneCardKey: clickedZoneCard.key,
        startScreenPos: this.getPointerScreenPosition(event),
        startWorldPos: worldPos,
        shiftKey: isShiftHeld,
        altKey: event.altKey,
      };
      this.camera.pauseDrag();
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    if (clickedZoneHeader) {
      this.cancelSelectionBox();
      if (clickedZoneHeader.type === "stack") {
        this.onStackZoneHeaderClick?.(clickedZoneHeader.id);
      }
      this.startZoneDrag(clickedZoneHeader.id, worldPos);
      this.camera.pauseDrag();
      return;
    }

    this.pointerDownOnSelectedCard = false;

    const clickedCard = this.getCardAtPosition(worldPos);

    if (clickedCard) {
      if (isCtrlHeld) {
        // Ctrl+click starts selection box
        this.startSelectionBox(worldPos, isShiftHeld);
        this.camera.pauseDrag();
        this.updateHoveredFromWorldPos(worldPos);
        return;
      }

      this.pendingCardClick = {
        cardKey: clickedCard,
        startScreenPos: this.getPointerScreenPosition(event),
        startWorldPos: worldPos,
        shiftKey: isShiftHeld,
      };
      this.camera.pauseDrag();
    } else {
      if (!isShiftHeld) this.clearSelection();
      this.startSelectionBox(worldPos, isShiftHeld);
      this.camera.pauseDrag();
    }

    this.updateHoveredFromWorldPos(worldPos);
  }

  private onPointerMove(event: FederatedPointerEvent): void {
    if (!this.camera) return;

    if (this.isTouchPointer(event)) {
      this.onTouchPointerMove(event);
      return;
    }
    if (this.shouldIgnorePostTouchMouseEvent(event)) {
      this.cancelSelectionBox();
      return;
    }

    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);
    this.lastPointerScreenPos = { x: event.globalX, y: event.globalY };
    const screenPos = this.getPointerScreenPosition(event);

    if (
      this.pendingCardClick &&
      this.movedBeyondDesktopClickSlop(
        this.pendingCardClick.startScreenPos,
        screenPos,
      )
    ) {
      const pending = this.pendingCardClick;
      this.pendingCardClick = null;
      this.selectMainCardForPointer(pending.cardKey, pending.shiftKey, true);
      this.lastClickedCard = null;
      this.pointerDownOnSelectedCard = true;
      this.startCardDrag(pending.startWorldPos);
    }
    if (
      this.pendingZoneCardClick &&
      this.movedBeyondDesktopClickSlop(
        this.pendingZoneCardClick.startScreenPos,
        screenPos,
      )
    ) {
      const pending = this.pendingZoneCardClick;
      this.pendingZoneCardClick = null;
      const card = this.zoneCardSprites.get(pending.zoneCardKey);
      if (card) {
        this.selectZoneCardForPointer(card.key, pending.shiftKey, false, true);
        this.lastClickedZoneCardKey = null;
        this.startZoneCardDrag(card, pending.startWorldPos);
      }
    }
    // Update label drag
    if (this.labelDragState.isDragging) {
      this.clearZoneDropPreview();
      this.updateLabelDrag(worldPos);
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    // Update zone header drag
    if (this.zoneDragState.isDragging) {
      this.clearZoneDropPreview();
      this.updateZoneDrag(worldPos);
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    // Update zone card drag
    if (this.zoneCardDragState.isDragging) {
      this.clearZoneDropPreview();
      this.updateZoneCardDrag(worldPos);
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    // Update selection box
    if (this.selectionBox.isActive) {
      this.clearZoneDropPreview();
      this.updateSelectionBox(worldPos);
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    // Update card drag
    if (this.dragState.isDragging && this.pointerDownOnSelectedCard) {
      if (this.quickTransferState.active) {
        this.setStacksDropVisual(false);
        this.clearZoneDropPreview();
        this.updateCardDrag(worldPos);
        this.updateQuickTransferHover({ x: event.globalX, y: event.globalY });
      } else {
        const rect = this.app.canvas.getBoundingClientRect();
        const clientX = rect.left + event.globalX;
        const clientY = rect.top + event.globalY;
        const overStacksPanel = this.isPointInsideOpenStacksPanel(clientX, clientY);

        this.setStacksDropVisual(overStacksPanel);
        if (!overStacksPanel) {
          this.updateCardDrag(worldPos);
          const hoveredZone = this.getZoneAtPosition(worldPos);
          this.updateZoneDropPreview(
            hoveredZone,
            worldPos,
            this.getDraggedCardPlacements(),
          );
        } else {
          this.clearZoneDropPreview();
        }
      }
    } else {
      this.clearZoneDropPreview();
      if (this.quickTransferState.active) {
        this.deactivateQuickTransfer();
      }
    }

    this.updateHoveredFromWorldPos(worldPos);
  }

  private onPointerUp(event: FederatedPointerEvent): void {
    if (!this.camera) return;
    this.clearQuickTransferHold();

    if (this.isTouchPointer(event)) {
      this.onTouchPointerUp(event);
      return;
    }
    if (this.shouldIgnorePostTouchMouseEvent(event)) {
      this.cancelSelectionBox();
      this.pointerDownOnSelectedCard = false;
      this.pendingCardClick = null;
      this.pendingZoneCardClick = null;
      return;
    }

    this.camera.resumeDrag();
    const panStart = this.desktopPanStart;
    this.desktopPanStart = null;
    if (panStart && (event.button !== 2 || this.movedBeyondDesktopClickSlop(panStart, this.getPointerScreenPosition(event)))) {
      this.lastClickedCard = null;
      this.lastClickedLabel = null;
      return;
    }

    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);
    this.lastPointerScreenPos = { x: event.globalX, y: event.globalY };
    this.clearZoneDropPreview();

    // End label drag
    if (this.labelDragState.isDragging && event.button !== 2) {
      this.endLabelDrag();
      this.camera.resumeDrag();
      return;
    }

    // Handle double-right-click for remove from deck
    const isRightClick = event.button === 2;
    if (isRightClick) {
      this.armedDelete = null;
    const clickedLabel = this.getLabelAtPosition(worldPos);
      const now = Date.now();

      if (
        clickedLabel &&
        now - this.lastLabelClickTime < DOUBLE_CLICK_TIME_MS &&
        this.lastClickedLabel === clickedLabel
      ) {
        this.deleteLabel(clickedLabel);
      }

      this.lastLabelClickTime = now;
      this.lastClickedLabel = clickedLabel;

      if (clickedLabel) {
        return;
      }

      if (this.getZoneAtPosition(worldPos)) {
        return;
      }

      const clickedCard = this.getCardAtPosition(worldPos);
      if (
        clickedCard &&
        now - this.lastClickTime < DOUBLE_CLICK_TIME_MS &&
        this.lastClickedCard === clickedCard
      ) {
        if (this.selectedCardCategoryId && this.cardCategoryData) {
          const data = this.getSpriteData(clickedCard);
          this.modifyCardCategoryScore(data?.layout.name ?? clickedCard, -0.1);
        } else {
          this.onRemoveFromDeck(clickedCard);
        }
      }
      this.lastClickTime = now;
      this.lastClickedCard = clickedCard;
      return;
    }

    const screenPos = this.getPointerScreenPosition(event);
    if (this.pendingZoneCardClick) {
      const pending = this.pendingZoneCardClick;
      this.pendingZoneCardClick = null;
      if (
        !this.movedBeyondDesktopClickSlop(pending.startScreenPos, screenPos) &&
        this.getZoneCardAtPosition(worldPos)?.key === pending.zoneCardKey
      ) {
        this.handlePendingZoneCardClick(pending);
        this.updateHoveredFromWorldPos(worldPos);
        return;
      }
    }

    if (this.pendingCardClick) {
      const pending = this.pendingCardClick;
      this.pendingCardClick = null;
      if (
        !this.movedBeyondDesktopClickSlop(pending.startScreenPos, screenPos) &&
        this.getCardAtPosition(worldPos) === pending.cardKey
      ) {
        this.handlePendingCardClick(pending, worldPos);
        this.updateHoveredFromWorldPos(worldPos);
        return;
      }
    }

    if (this.zoneCardDragState.isDragging) {
      this.endZoneCardDrag(worldPos);
      this.camera.resumeDrag();
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    if (this.zoneDragState.isDragging) {
      this.endZoneDrag(worldPos);
      this.camera.resumeDrag();
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    // End selection box
    if (this.selectionBox.isActive) {
      this.endSelectionBox(worldPos);
      this.camera.resumeDrag();
      return;
    }

    if (this.dragState.isDragging && this.quickTransferState.active) {
      this.completeQuickTransferDrop(worldPos, {
        x: event.globalX,
        y: event.globalY,
      });
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    // End card drag
    if (this.dragState.isDragging) {
      const rect = this.app.canvas.getBoundingClientRect();
      const clientX = rect.left + event.globalX;
      const clientY = rect.top + event.globalY;
      const draggedPlacements = this.getDraggedCardPlacements();
      const droppedInStacksTarget = this.isPointInsideStacksDropTarget(
        clientX,
        clientY,
      );
      const domDropTarget = droppedInStacksTarget
        ? this.getCanvasDomDropTarget(clientX, clientY)
        : null;
      const draggedCardNames = this.getDraggedCardNames();
      const droppedZone = this.getZoneAtPosition(worldPos);
      const shouldDropToStackTarget =
        domDropTarget?.type === "stack" &&
        !!domDropTarget.zoneId &&
        draggedCardNames.length > 0;
      const shouldDropToDeckTarget =
        domDropTarget?.type === "deck" &&
        !!domDropTarget.deckId &&
        draggedCardNames.length > 0;
      const shouldDropToCanvasZone =
        !droppedInStacksTarget && !!droppedZone && draggedCardNames.length > 0;
      if (shouldDropToCanvasZone && droppedZone) {
        this.addDraggedCardsToZoneOrRequestDeck(
          droppedZone,
          draggedCardNames,
          worldPos,
          { x: event.globalX, y: event.globalY },
          draggedPlacements,
          "canvas-zone",
        );
      }
      this.endCardDrag(shouldDropToCanvasZone || droppedInStacksTarget);
      this.camera.resumeDrag();
      this.setStacksDropVisual(false);

      if (shouldDropToStackTarget && domDropTarget?.zoneId) {
        this.copyCardsIntoZone(domDropTarget.zoneId, draggedCardNames, worldPos, {
          useZonePlacement: true,
          placements: draggedPlacements,
        });
      } else if (shouldDropToDeckTarget && domDropTarget?.deckId) {
        this.requestDeckAdd({
          deckId: domDropTarget.deckId,
          canvasAreaId: domDropTarget.zoneId,
          cardNames: draggedCardNames,
          placements: draggedPlacements,
          worldPos,
          screenPos: { x: event.globalX, y: event.globalY },
          source: "side-rail",
        });
      } else if (
        droppedInStacksTarget &&
        !shouldDropToCanvasZone &&
        draggedCardNames.length > 0 &&
        this.onCardDragDrop
      ) {
        this.onCardDragDrop({
          cardNames: draggedCardNames,
          clientX,
          clientY,
        });
      }
    }

    this.setStacksDropVisual(false);
    this.pointerDownOnSelectedCard = false;
    this.updateHoveredFromWorldPos(worldPos);
  }

  // ============================================================================
  // Sprite Lookup (collection + deck)
  // ============================================================================

  /** Look up sprite data by key from either collection or deck sprites */
  private getSpriteData(key: string): CardSpriteData | undefined {
    return (
      this.cardSprites.get(key) ??
      this.deckSprites.get(key) ??
      this.associationShelfSprites.get(key)
    );
  }

  private getLabelAtPosition(worldPos: { x: number; y: number }): string | null {
    for (let i = this.canvasLabels.length - 1; i >= 0; i--) {
      const label = this.canvasLabels[i];
      if (!label) continue;
      const data = this.labelSprites.get(label.id);
      if (data && this.pointInBounds(worldPos, data.bounds)) {
        return label.id;
      }
    }
    return null;
  }

  private getLabelTarget(worldPos: { x: number; y: number }, excluded = new Set<string>()): CanvasLabel | null {
    for (const data of [...(this.labelSprites?.values() ?? [])].reverse()) {
      if (!excluded.has(data.label.id) && this.pointInBounds(worldPos, data.bounds)) {
        return this.canvasLabels.find(label => label.id === data.label.id) ?? null;
      }
    }
    return null;
  }

  private getPopulatedLabelBounds(zone: CanvasArea, board?: DeckZoneBoard): CanvasArea["bounds"][] {
    return (this.canvasLabels ?? []).filter(label => label.areaId === zone.id && (!board || this.normalizeDeckBoard(label.board) === board))
      .flatMap(label => {
        const bounds = getLabelRegionBounds(this.canvasLabels, label, this.canvasAreas,
          name => this.isLandscapeCard(name), id => {
            const text = this.labelSprites?.get(id)?.text;
            return { width: text?.width ?? 160, height: text?.height ?? 36 };
          });
        return bounds ? [bounds] : [];
      });
  }

  private fitLabelRegionBounds(zone: CanvasArea): boolean {
    const regions = this.getPopulatedLabelBounds(zone);
    if (!regions.length) return false;
    const before = { ...zone.bounds };
    const left = Math.min(before.x, ...regions.map(rect => rect.x - 14));
    const top = Math.min(before.y, ...regions.map(rect => rect.y - this.getZoneHeaderHeight(zone) - 14));
    const right = Math.max(before.x + before.width, ...regions.map(rect => rect.x + rect.width + 14));
    const bottom = Math.max(before.y + before.height, ...regions.map(rect => rect.y + rect.height + 14));
    zone.bounds = { x: left, y: top, width: right - left, height: bottom - top };
    return left !== before.x || top !== before.y || zone.bounds.width !== before.width || zone.bounds.height !== before.height;
  }

  private rebuildLabelRegions(): void {
    for (const graphic of this.labelRegionGraphics.values()) graphic.destroy();
    this.labelRegionGraphics.clear();
    for (const label of this.canvasLabels) {
      if (!label.areaId || !this.canvasAreas.some(area => area.id === label.areaId && area.pinned)) continue;
      const bounds = getLabelRegionBounds(this.canvasLabels, label, this.canvasAreas,
        name => this.isLandscapeCard(name), id => {
          const text = this.labelSprites.get(id)?.text;
          return { width: text?.width ?? 160, height: text?.height ?? 36 };
        });
      if (!bounds) continue;
      const graphic = new Graphics();
      graphic.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, 12);
      graphic.fill({ color: MANGA_PALETTE.line, alpha: 0.035 });
      graphic.stroke({ color: MANGA_PALETTE.line, width: 2, alpha: 0.58 });
      this.labelContainer.addChildAt(graphic, 0);
      this.labelRegionGraphics.set(label.id, graphic);
    }
  }

  private prepareZoneCardDragFeedback(worldPos: { x: number; y: number }): void {
    this.dragDetached = false;
    this.dragDetachedAt = 0;
    this.shakeDetector ??= new ShakeDetector();
    const scale = this.camera?.zoom ?? 1;
    this.shakeDetector.reset({ x: worldPos.x * scale, y: worldPos.y * scale }, performance.now());
    for (const entry of this.zoneCardDragState.cards.values()) {
      const zone = this.canvasAreas.find(area => area.id === entry.zoneId);
      const card = zone?.cards.find(card => card.id === entry.instanceId);
      if (card?.labelId) {
        const region = this.labelRegionGraphics?.get(card.labelId);
        if (region) region.alpha = 1.6;
      }
    }
  }

  private updateZoneCardDragFeedback(worldPos: { x: number; y: number }): void {
    const scale = this.camera?.zoom ?? 1;
    if (!this.dragDetached && this.shakeDetector?.move({ x: worldPos.x * scale, y: worldPos.y * scale }, performance.now())) {
      this.dragDetached = true;
      this.dragDetachedAt = performance.now();
      this.playCardsEffect('detach', this.zoneCardDragState.cards.keys(), true);
      for (const region of this.labelRegionGraphics?.values() ?? []) region.alpha = 0.25;
    }
    if (!this.camera?.container) return;
    this.dragFeedbackGraphic ??= this.camera.container.addChild(new Graphics());
    this.dragFeedbackText ??= this.camera.container.addChild(new Text({ text: '', style: {
      fontFamily: 'Arial', fontSize: 12, fontWeight: '600', fill: MANGA_PALETTE.paper,
      stroke: { color: MANGA_PALETTE.ink, width: 3 }, wordWrap: true, wordWrapWidth: 280,
    } }));
    this.dragFeedbackText.scale.set(1 / Math.max(0.01, scale));
    this.dragFeedbackGraphic.clear();
    const draggedBoards = new Set([...this.zoneCardDragState.cards.values()].flatMap(entry => {
      const card = this.canvasAreas.find(area => area.id === entry.zoneId)?.cards.find(card => card.id === entry.instanceId);
      return card ? [this.normalizeDeckBoard(card.board)] : [];
    }));
    const mixedBoards = draggedBoards.size > 1;
    const label = this.dragDetached || mixedBoards ? null : this.getLabelTarget(worldPos);
    const zone = (label?.areaId ? this.canvasAreas.find(area => area.id === label.areaId) : null) ?? this.getZoneAtPosition(worldPos);
    const board = zone?.type === 'deck' ? this.getDeckBoardForPosition(zone, worldPos) : null;
    const bounds = label ? this.labelSprites.get(label.id)?.bounds : null;
    const rect = bounds ? { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }
      : zone && board ? this.getDeckBoardRects(zone.bounds, zone)[board] : zone?.bounds;
    this.dragFeedbackBounds = rect ?? null;
    if (rect) {
      drawMangaOutline(this.dragFeedbackGraphic, {
        left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height,
      }, scale, true);
    }
    const boardName = board === 'collection' ? 'Collection' : board === 'maybeboard' ? 'Maybe' : 'Main';
    this.dragFeedbackText.text = this.dragDetached ? 'Detached · release to place freely'
      : mixedBoards ? 'Keep boards · move selection' : label ? `Join ${label.text}` : zone ? `Release in ${zone.name} · ${boardName}` : 'Keep board · expand to this position';
    const view = this.camera.getVisibleBounds?.();
    const x = worldPos.x + 24 / scale; const y = worldPos.y - 40 / scale;
    this.dragFeedbackText.position.set(
      view ? Math.max(view.left + 8 / scale, Math.min(x, view.right - this.dragFeedbackText.width - 8 / scale)) : x,
      view ? Math.max(view.top + 8 / scale, Math.min(y, view.bottom - this.dragFeedbackText.height - 8 / scale)) : y,
    );
  }

  private clearZoneCardDragFeedback(): void {
    for (const key of this.zoneCardDragState.cards?.keys() ?? []) {
      const sprite = this.zoneCardSprites.get(key)?.sprite;
      if (sprite) sprite.rotation = 0;
    }
    this.dragFeedbackGraphic?.destroy();
    this.dragFeedbackGraphic = null;
    this.dragFeedbackText?.destroy();
    this.dragFeedbackText = null;
    this.dragFeedbackBounds = null;
    for (const region of this.labelRegionGraphics?.values() ?? []) region.alpha = 1;
    this.dragDetachedAt = 0;
    this.dragDetached = false;
  }

  private applyLabelDrop(cards: CanvasCardInstance[], sourceZone: CanvasArea, targetZone: CanvasArea,
    worldPos: { x: number; y: number }, mixedBoards: boolean): void {
    const target = this.dragDetached || mixedBoards ? null : this.getLabelTarget(worldPos);
    if (target && (!target.areaId || target.areaId === targetZone.id)) {
      target.areaId = targetZone.id;
      target.board ??= cards[0]?.board ?? 'mainboard';
      const parent = this.canvasLabels.find(label => label.id === target.parentLabelId);
      if (parent && (parent.areaId !== target.areaId || this.normalizeDeckBoard(parent.board) !== this.normalizeDeckBoard(target.board))) delete target.parentLabelId;
      for (const card of cards) {
        const oldBoard = this.normalizeDeckBoard(card.board);
        card.labelId = target.id;
        card.board = target.board;
        if (targetZone.type === 'deck' && oldBoard !== this.normalizeDeckBoard(card.board)) this.syncDeckVariantForBoardChange(targetZone, card.id, this.normalizeDeckBoard(card.board));
      }
      this.playMangaEffect('attach', this.labelSprites?.get(target.id)?.bounds);
      this.emitCanvasLabelsChange();
    } else {
      for (const card of cards) {
        const label = this.canvasLabels?.find(label => label.id === card.labelId);
        if (this.dragDetached || sourceZone.id !== targetZone.id || (label && this.normalizeDeckBoard(label.board) !== this.normalizeDeckBoard(card.board))) delete card.labelId;
      }
    }
  }

  private setCanvasLabels(labels: CanvasLabel[]): void {
    if (this.canvasLabelsEqual(this.canvasLabels, labels)) {
      return;
    }
    this.canvasLabels = labels.map((label) => ({ ...label }));
    this.rebuildLabelSprites();
  }

  private canvasLabelsEqual(a: CanvasLabel[], b: CanvasLabel[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const left = a[i];
      const right = b[i];
      if (!left || !right) return false;
      if (
        left.id !== right.id ||
        left.text !== right.text ||
        left.x !== right.x ||
        left.y !== right.y || left.areaId !== right.areaId || left.board !== right.board || left.parentLabelId !== right.parentLabelId
      ) {
        return false;
      }
    }
    return true;
  }

  private rebuildLabelSprites(): void {
    for (const data of this.labelSprites.values()) {
      data.text.destroy();
    }
    this.labelSprites.clear();
    this.labelContainer.removeChildren();

    for (const label of this.canvasLabels) {
      if (label.areaId && !this.canvasAreas.some(area => area.id === label.areaId && area.pinned)) continue;
      const text = new Text({
        text: label.text,
        style: {
          fontFamily: "Arial",
          fontSize: 28,
          fill: 0xffffff,
          stroke: { color: 0x000000, width: 4 },
        },
      });

      text.x = label.x;
      text.y = label.y;
      this.labelContainer.addChild(text);

      const data: LabelSpriteData = {
        label: { ...label },
        text,
        bounds: { left: 0, top: 0, right: 0, bottom: 0 },
      };

      this.updateLabelBounds(data);
      this.labelSprites.set(label.id, data);
    }
    this.rebuildLabelRegions();
  }

  private updateLabelBounds(data: LabelSpriteData): void {
    const padding = 8;
    data.bounds = {
      left: data.text.x - padding,
      top: data.text.y - padding,
      right: data.text.x + data.text.width + padding,
      bottom: data.text.y + data.text.height + padding,
    };
  }

  private startLabelDrag(labelId: string, worldPos: { x: number; y: number }): void {
    const label = this.canvasLabels.find(entry => entry.id === labelId);
    if (!label) return;
    this.labelDragState = { isDragging: true, labelId, startWorldPos: { ...worldPos }, labelStartPos: { x: label.x, y: label.y } };
    this.labelDragLastPos = { ...worldPos };
    this.labelDragBoardTargets = this.canvasAreas.filter(area => area.pinned && area.type === 'deck').flatMap(area => {
      const rects = this.getDeckBoardRects(area.bounds, area);
      return DECK_BOARD_ORDER.map(board => ({ areaId: area.id, board, rect: { ...rects[board] } }));
    });
    this.labelDragCardStarts.clear();
    this.labelDragLabelStarts.clear();
    const family = getLabelFamily(this.canvasLabels, labelId);
    for (const member of this.canvasLabels) if (family.has(member.id)) this.labelDragLabelStarts.set(member.id, { x: member.x, y: member.y });
    for (const card of getLabelCards(this.canvasLabels, labelId, this.canvasAreas)) this.labelDragCardStarts.set(card.id, { x: card.x, y: card.y });
  }

  private updateLabelDrag(worldPos: { x: number; y: number }): void {
    if (!this.labelDragState.isDragging) return;
    this.labelDragLastPos = { ...worldPos };
    const dx = worldPos.x - this.labelDragState.startWorldPos.x;
    const dy = worldPos.y - this.labelDragState.startWorldPos.y;
    for (const label of this.canvasLabels) {
      const start = this.labelDragLabelStarts.get(label.id);
      if (!start) continue;
      label.x = start.x + dx;
      label.y = start.y + dy;
      const data = this.labelSprites.get(label.id);
      if (data) {
        data.label = { ...label };
        data.text.position.set(label.x, label.y);
        this.updateLabelBounds(data);
      }
    }
    for (const area of this.canvasAreas) for (const card of area.cards) {
      const start = this.labelDragCardStarts.get(card.id);
      if (!start) continue;
      const sprite = this.zoneCardSprites.get(`${area.id}:${card.id}`);
      const moveX = start.x + dx - card.x;
      const moveY = start.y + dy - card.y;
      card.x += moveX;
      card.y += moveY;
      if (sprite) {
        sprite.sprite.x += moveX;
        sprite.sprite.y += moveY;
        sprite.bounds = { left: sprite.bounds.left + moveX, right: sprite.bounds.right + moveX, top: sprite.bounds.top + moveY, bottom: sprite.bounds.bottom + moveY };
      }
    }
    this.rebuildLabelRegions();
  }

  private endLabelDrag(cancel = false): void {
    const { labelId } = this.labelDragState;
    const label = this.canvasLabels.find(entry => entry.id === labelId);
    if (!label) return;
    const moved = (this.labelDragLastPos?.x !== this.labelDragState.startWorldPos.x || this.labelDragLastPos?.y !== this.labelDragState.startWorldPos.y);
    if (cancel || !moved) {
      this.updateLabelDrag(this.labelDragState.startWorldPos);
    } else {
      const pos = this.labelDragLastPos ?? { x: label.x, y: label.y };
      const anchor = getLabelCards(this.canvasLabels, label.id, this.canvasAreas)[0];
      if (anchor) {
        const landscape = this.isLandscapeCard(anchor.cardName);
        const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
        const snapped = snapCardCenter(anchor.x + size.width / 2, anchor.y + size.height / 2, landscape);
        this.updateLabelDrag({ x: pos.x + snapped.x - size.width / 2 - anchor.x, y: pos.y + snapped.y - size.height / 2 - anchor.y });
      }
      const family = getLabelFamily(this.canvasLabels, label.id);
      const cards = getLabelCards(this.canvasLabels, label.id, this.canvasAreas);
      const targetLabel = this.getLabelTarget(pos, family);
      const oldArea = this.canvasAreas.find(area => area.id === label.areaId);
      const targetArea = (targetLabel?.areaId ? this.canvasAreas.find(area => area.id === targetLabel.areaId) : this.getZoneAtPosition(pos)) ?? (cards.length ? oldArea : undefined);
      const boardTarget = this.labelDragBoardTargets.find(target => target.areaId === targetArea?.id && this.pointInBounds(pos, { left: target.rect.x, top: target.rect.y, right: target.rect.x + target.rect.width, bottom: target.rect.y + target.rect.height }));
      const board = targetLabel?.board ?? (targetArea ? boardTarget?.board ?? label.board ?? 'mainboard' : undefined);
      label.parentLabelId = targetArea && targetLabel?.areaId === targetArea.id ? targetLabel.id : undefined;
      for (const member of this.canvasLabels) if (family.has(member.id)) {
        member.areaId = targetArea?.id;
        member.board = board;
      }
      if (targetArea && cards.length) {
        for (const area of this.canvasAreas) {
          const transferring = area.cards.filter(card => this.labelDragCardStarts.has(card.id));
          if (area.id !== targetArea.id) {
            area.cards = area.cards.filter(card => !this.labelDragCardStarts.has(card.id));
            this.removeDeckVariantCardReferences(area, transferring.map(card => card.id));
            targetArea.cards.push(...transferring);
          }
        }
        for (const card of cards) {
          const oldBoard = this.normalizeDeckBoard(card.board);
          card.board = board;
          card.isNew = false;
          if (oldBoard !== this.normalizeDeckBoard(board) || oldArea?.id !== targetArea.id) this.syncDeckVariantForBoardChange(targetArea, card.id, this.normalizeDeckBoard(board));
        }
      }
    }
    this.labelDragState.isDragging = false;
    this.labelDragState.labelId = null;
    this.labelDragCardStarts.clear();
    this.labelDragLabelStarts.clear();
    for (const area of this.canvasAreas) this.reconcileCanvasAreaBounds(area.id);
    this.rebuildZoneVisuals();
    if (!cancel && moved) {
      this.emitCanvasLabelsChange();
      this.emitCanvasAreasChange();
    }
  }

  private addLabelAtPosition(worldPos: { x: number; y: number }): void {
    this.closeLabelEditor?.();
    this.closeLabelEditor = openCanvasLabelEditor({
      title: "Add label",
      onClose: () => { this.closeLabelEditor = null; },
      onSave: (text) => {
        if (this.isDestroyed || !text) return;
        const area = this.getZoneAtPosition(worldPos);
        const label: CanvasLabel = {
          id: crypto.randomUUID(), text, x: worldPos.x, y: worldPos.y,
          areaId: area?.id,
          board: area?.type === 'deck' ? (this.getDeckBoardForPosition(area, worldPos) ?? 'mainboard') : undefined,
        };
        this.canvasLabels = [...this.canvasLabels, label];
        this.rebuildLabelSprites();
        this.playMangaEffect('label', this.labelSprites.get(label.id)?.bounds);
        this.emitCanvasLabelsChange();
      },
    });
  }

  private editLabel(labelId: string): void {
    const current = this.canvasLabels.find((label) => label.id === labelId);
    if (!current) return;
    this.closeLabelEditor?.();
    this.closeLabelEditor = openCanvasLabelEditor({
      title: "Edit label",
      initialText: current.text,
      onClose: () => { this.closeLabelEditor = null; },
      onSave: (text) => {
        if (this.isDestroyed || !this.canvasLabels.some(label => label.id === labelId)) return;
        if (!text) {
          this.deleteLabel(labelId);
          return;
        }
        this.canvasLabels = this.canvasLabels.map((label) => label.id === labelId ? { ...label, text } : label);
        this.rebuildLabelSprites();
        if (current.areaId) {
          this.reconcileCanvasAreaBounds(current.areaId);
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
        }
        this.emitCanvasLabelsChange();
      },
    });
  }

  private deleteLabel(labelId: string): void {
    const next = this.canvasLabels.filter((label) => label.id !== labelId);
    if (next.length === this.canvasLabels.length) return;
    const parentId = this.canvasLabels.find(label => label.id === labelId)?.parentLabelId;
    this.canvasLabels = next.map(label => label.parentLabelId === labelId ? { ...label, parentLabelId: parentId } : label);
    for (const area of this.canvasAreas) {
      for (const card of area.cards) if (card.labelId === labelId) card.labelId = parentId;
      this.reconcileCanvasAreaBounds(area.id);
    }
    this.rebuildZoneVisuals();
    this.emitCanvasAreasChange();
    this.rebuildLabelSprites();
    this.emitCanvasLabelsChange();
  }

  private emitCanvasLabelsChange(): void {
    this.onCanvasLabelsChange?.(this.canvasLabels.map((label) => ({ ...label })));
  }

  private consumeLabelPlacementMode(): void {
    this.labelPlacementMode = false;
    this.onLabelPlacementConsumed?.();
  }

  // ============================================================================
  // Selection Management
  // ============================================================================

  private clearMainSelection(suppressEmit = false): void {
    for (const cardName of this.selectedCards) {
      const data = this.getSpriteData(cardName);
      if (data) {
        data.sprite.setSelected(false);
      }
    }
    this.selectedCards.clear();
    if (!suppressEmit) {
      this.emitSelectionChange();
    }
  }

  private selectCard(cardName: string, suppressEmit = false): void {
    this.selectedCards.add(cardName);
    const data = this.getSpriteData(cardName);
    if (data) {
      data.sprite.setSelected(true);
    }
    if (!suppressEmit) {
      this.emitSelectionChange();
    }
  }

  private selectZoneCard(key: string): void {
    const data = this.zoneCardSprites.get(key);
    if (!data) return;

    this.selectedZoneId = data.zoneId;
    this.selectedZoneCardKeys.add(key);
    data.sprite.setSelected(true);
  }

  private clearZoneSelection(): void {
    for (const key of this.selectedZoneCardKeys) {
      const data = this.zoneCardSprites.get(key);
      if (data) {
        data.sprite.setSelected(false);
      }
    }
    this.selectedZoneCardKeys.clear();
    this.selectedZoneId = null;
  }

  private syncZoneSelectionVisuals(): void {
    const nextSelectedKeys = new Set<string>();
    let zoneId: string | null = null;

    for (const key of this.selectedZoneCardKeys) {
      const data = this.zoneCardSprites.get(key);
      if (!data) continue;
      if (zoneId === null) {
        zoneId = data.zoneId;
      }
      nextSelectedKeys.add(key);
    }

    for (const [key, data] of this.zoneCardSprites) {
      data.sprite.setSelected(nextSelectedKeys.has(key));
    }

    this.selectedZoneCardKeys = nextSelectedKeys;
    this.selectedZoneId = zoneId;
    this.updateZoneSelectionOutlines();
  }

  private updateZoneSelectionOutlines(): void {
    if (!this.zoneCardSprites?.size || !this.canvasAreas?.length) return;
    const zones = new Map(this.canvasAreas.map(area => [area.id, area]));
    const groups = new Map<string, CardSprite[]>();
    for (const key of this.selectedZoneCardKeys) {
      const data = this.zoneCardSprites.get(key);
      const zone = data ? zones.get(data.zoneId) : undefined;
      const card = zone?.cards.find(card => card.id === data?.instanceId);
      if (!data || !zone || !card) continue;
      const groupKey = `${zone.id}:${this.getZoneCardStackKey(zone, card)}`;
      const group = groups.get(groupKey) ?? [];
      group.push(data.sprite);
      groups.set(groupKey, group);
    }
    for (const group of groups.values()) outlineSelectedStack(group);
  }

  private clearSelection(suppressEmit = false): void {
    this.clearMainSelection(true);
    this.clearZoneSelection();
    if (!suppressEmit) {
      this.emitSelectionChange();
    }
  }

  private getSelectedCardNames(): string[] {
    const mainNames: string[] = [];
    for (const key of this.selectedCards) {
      const data = this.getSpriteData(key);
      if (!data) continue;
      mainNames.push(data.layout.name);
    }
    const zoneNames: string[] = [];
    for (const key of this.selectedZoneCardKeys) {
      const data = this.zoneCardSprites.get(key);
      if (!data) continue;
      zoneNames.push(data.cardName);
    }
    return mergeSelectedCardNames(mainNames, zoneNames);
  }

  private emitSelectionChange(): void {
    this.updateZoneSelectionOutlines();
    const keys = [...this.selectedZoneCardKeys, ...this.selectedCards];
    const signature = keys.join('|');
    if (keys.length > 1 && signature !== this.lastSelectionEffect) {
      this.playCardsEffect('select', keys);
    }
    this.lastSelectionEffect = signature;
    this.onSelectionChange?.(this.getSelectedCardNames());
  }

  private getCardAtPosition(worldPos: { x: number; y: number }): string | null {
    let topCard: string | null = null;
    let topZIndex = -Infinity;
    let topDrawOrder = -Infinity;

    const considerCard = (cardKey: string, data: CardSpriteData): void => {
      if (!this.pointInBounds(worldPos, data.bounds)) return;

      const zIndex = data.sprite.zIndex;
      const drawOrder =
        data.sprite.parent === this.cardContainer
          ? this.cardContainer.getChildIndex(data.sprite)
          : -1;
      const isHigherLayer =
        zIndex > topZIndex || (zIndex === topZIndex && drawOrder > topDrawOrder);

      if (!isHigherLayer) return;

      topCard = cardKey;
      topZIndex = zIndex;
      topDrawOrder = drawOrder;
    };

    // Check collection sprites
    for (const cardName of this.visibleCardNames) {
      const data = this.cardSprites.get(cardName);
      if (!data) continue;
      considerCard(cardName, data);
    }

    // Check deck sprites
    for (const [key, data] of this.deckSprites) {
      if (!data.sprite.visible) continue;
      considerCard(key, data);
    }

    for (const [key, data] of this.associationShelfSprites) {
      if (!data.sprite.visible) continue;
      considerCard(key, data);
    }

    return topCard;
  }

  private pointInBounds(
    point: { x: number; y: number },
    bounds: { left: number; top: number; right: number; bottom: number },
  ): boolean {
    return (
      point.x >= bounds.left &&
      point.x <= bounds.right &&
      point.y >= bounds.top &&
      point.y <= bounds.bottom
    );
  }

  // ============================================================================
  // Card Dragging
  // ============================================================================

  private startCardDrag(worldPos: { x: number; y: number }): void {
    this.playCardsEffect('pickup', this.selectedCards, true);
    this.dragState.isDragging = true;
    this.dragState.startWorldPos = { ...worldPos };
    this.dragState.draggedCards = new Set(this.selectedCards);
    this.dragState.cardStartPositions.clear();
    this.dragState.cardStartBasePositions.clear();
    this.dragState.cardStartGridKeys.clear();
    this.dragState.cardOriginalZIndices.clear();

    // Use a high zIndex so dragged cards appear above all others
    const dragZIndex = 10000;

    for (const cardName of this.dragState.draggedCards) {
      const data = this.getSpriteData(cardName);
      if (data) {
        this.dragState.cardStartPositions.set(cardName, {
          x: data.sprite.x,
          y: data.sprite.y,
        });
        this.dragState.cardStartBasePositions.set(cardName, {
          x: data.basePosition.x,
          y: data.basePosition.y,
        });
        this.dragState.cardStartGridKeys.set(cardName, data.gridKey);
        // Store original zIndex and set high one for dragging
        this.dragState.cardOriginalZIndices.set(cardName, data.sprite.zIndex);
        data.sprite.zIndex = dragZIndex;
      }
    }

    this.cardContainer.sortChildren();
  }

  private updateCardDrag(worldPos: { x: number; y: number }): void {
    const dx = worldPos.x - this.dragState.startWorldPos.x;
    const dy = worldPos.y - this.dragState.startWorldPos.y;

    for (const cardName of this.dragState.draggedCards) {
      const data = this.getSpriteData(cardName);
      const startPos = this.dragState.cardStartPositions.get(cardName);
      if (data && startPos) {
        data.sprite.x = startPos.x + dx;
        data.sprite.y = startPos.y + dy;
      }
    }
  }

  private endCardDrag(revertToStart = false): void {
    let snappedDelta = { x: 0, y: 0 };
    if (!revertToStart) {
      const anchorKey = this.dragState.draggedCards.values().next().value;
      const anchor = anchorKey ? this.getSpriteData(anchorKey) : null;
      const start = anchorKey ? this.dragState.cardStartPositions.get(anchorKey) : null;
      const base = anchorKey ? this.dragState.cardStartBasePositions.get(anchorKey) : null;
      if (anchor && start && base) {
        const snapped = snapCardCenter(
          base.x + anchor.displaySize.width / 2 + anchor.sprite.x - start.x,
          base.y + anchor.displaySize.height / 2 + anchor.sprite.y - start.y,
          anchor.layout.isLandscape,
        );
        snappedDelta = {
          x: snapped.x - anchor.displaySize.width / 2 - base.x,
          y: snapped.y - anchor.displaySize.height / 2 - base.y,
        };
      }
    }
    for (const cardName of this.dragState.draggedCards) {
      const data = this.getSpriteData(cardName);
      if (data) {
        const cardSize = data.displaySize;
        const isLandscape = data.layout.isLandscape;

        if (revertToStart) {
          const startPos = this.dragState.cardStartPositions.get(cardName);
          const startBasePos =
            this.dragState.cardStartBasePositions.get(cardName) ?? startPos;
          const startGridKey = this.dragState.cardStartGridKeys.get(cardName);

          if (startPos) {
            data.sprite.x = startPos.x;
            data.sprite.y = startPos.y;
          }
          if (startBasePos) {
            data.basePosition = { x: startBasePos.x, y: startBasePos.y };
          }
          if (startGridKey) {
            data.gridKey = startGridKey;
          }

          data.bounds = {
            left: data.sprite.x,
            top: data.sprite.y,
            right: data.sprite.x + cardSize.width,
            bottom: data.sprite.y + cardSize.height,
          };

          const originalZ = this.dragState.cardOriginalZIndices.get(cardName);
          if (originalZ !== undefined) {
            data.sprite.zIndex = originalZ;
          }
          continue;
        }

        const base = this.dragState.cardStartBasePositions.get(cardName) ?? data.basePosition;
        const snappedCenter = {
          x: base.x + cardSize.width / 2 + snappedDelta.x,
          y: base.y + cardSize.height / 2 + snappedDelta.y,
        };

        // Convert back to top-left for sprite positioning
        const snappedX = snappedCenter.x - cardSize.width / 2;
        const snappedY = snappedCenter.y - cardSize.height / 2;

        data.sprite.x = snappedX;
        data.sprite.y = snappedY;
        data.basePosition = { x: snappedX, y: snappedY };

        // Update cached bounds
        data.bounds = {
          left: snappedX,
          top: snappedY,
          right: snappedX + cardSize.width,
          bottom: snappedY + cardSize.height,
        };

        // Update grid key for stacking (use snap grid position)
        const gridPos = pixelsToSnapGrid(
          snappedCenter.x,
          snappedCenter.y,
          isLandscape,
        );
        const isDeckSprite = this.deckSprites.has(cardName);
        const isAssociationShelfSprite = this.associationShelfSprites.has(cardName);
        data.gridKey = isDeckSprite
          ? `deck:${gridPos.x},${gridPos.y}`
          : isAssociationShelfSprite
            ? `association:${gridPos.x},${gridPos.y}`
            : `${isLandscape ? "L" : "P"}:${gridPos.x},${gridPos.y}`;

        // Restore original zIndex (will be recalculated by rebuildCardStacks)
        const originalZ = this.dragState.cardOriginalZIndices.get(cardName);
        if (originalZ !== undefined) {
          data.sprite.zIndex = originalZ;
        }
      }
    }

    this.rebuildCardStacks();
    if (!revertToStart) this.playCardsEffect('place', this.dragState.draggedCards);

    this.dragState.isDragging = false;
    this.dragState.draggedCards.clear();
    this.dragState.cardStartPositions.clear();
    this.dragState.cardStartBasePositions.clear();
    this.dragState.cardStartGridKeys.clear();
    this.dragState.cardOriginalZIndices.clear();
    this.clearZoneDropPreview();
    if (this.quickTransferState.active || this.quickTransferOverlayTexts.length > 0) {
      this.deactivateQuickTransfer();
    }
  }

  private getDraggedCardNames(): string[] {
    const names: string[] = [];
    for (const key of this.dragState.draggedCards) {
      const data = this.getSpriteData(key);
      if (!data) continue;
      names.push(data.layout.name);
    }
    return names;
  }

  private getDraggedCardPlacements(): DraggedCardPlacement[] {
    const placements: DraggedCardPlacement[] = [];
    for (const key of this.dragState.draggedCards) {
      const data = this.getSpriteData(key);
      if (!data) continue;
      placements.push({
        cardName: data.layout.name,
        centerX: data.sprite.x + data.displaySize.width / 2,
        centerY: data.sprite.y + data.displaySize.height / 2,
      });
    }
    return placements;
  }

  // ============================================================================
  // Zone Interaction
  // ============================================================================

  private startZoneCardDrag(
    zoneCard: ZoneCardSpriteData,
    worldPos: { x: number; y: number },
  ): void {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneCard.zoneId);
    const anchor = zone?.cards.find((entry) => entry.id === zoneCard.instanceId);
    if (!zone || !anchor) return;
    const keys = this.selectedZoneCardKeys.has(zoneCard.key)
      ? this.selectedZoneCardKeys : new Set([zoneCard.key]);
    const cards: ZoneCardDragState["cards"] = new Map();
    for (const source of this.canvasAreas) {
      for (const instance of source.cards) {
        const key = `${source.id}:${instance.id}`;
        const data = this.zoneCardSprites.get(key);
        if (!keys.has(key) || !data) continue;
        cards.set(key, {
          zoneId: source.id, instanceId: instance.id, x: instance.x, y: instance.y,
          spriteX: data.sprite.x, spriteY: data.sprite.y,
        });
        data.sprite.zIndex += 30000;
      }
    }
    this.zoneCardDragState = {
      isDragging: true, key: zoneCard.key, zoneId: zone.id, instanceId: anchor.id,
      startWorldPos: { ...worldPos }, startCardPos: { x: anchor.x, y: anchor.y }, cards,
    };
    this.playCardsEffect('pickup', cards.keys(), true);
    this.prepareZoneCardDragFeedback(worldPos);
    this.zoneContainer.sortChildren();
  }

  private updateZoneCardDrag(worldPos: { x: number; y: number }): void {
    const drag = this.zoneCardDragState;
    if (!drag.isDragging) return;
    const dx = worldPos.x - drag.startWorldPos.x;
    const dy = worldPos.y - drag.startWorldPos.y;
    for (const [key, start] of drag.cards) {
      const card = this.zoneCardSprites.get(key);
      if (!card) continue;
      card.sprite.x = start.spriteX + dx;
      card.sprite.y = start.spriteY + dy;
      card.bounds = {
        left: card.sprite.x, top: card.sprite.y,
        right: card.sprite.x + card.displaySize.width,
        bottom: card.sprite.y + card.displaySize.height,
      };
    }
    this.updateZoneCardDragFeedback(worldPos);
    this.drawZoneDeleteOverlay();
  }

  private endZoneCardDrag(worldPos: { x: number; y: number }): void {
    const drag = this.zoneCardDragState;
    const anchor = drag.key ? this.zoneCardSprites.get(drag.key) : null;
    if (!anchor || !drag.zoneId) {
      this.resetZoneCardDrag();
      return;
    }
    // A single snapped translation preserves offsets, including mixed orientations.
    const snapped = snapCardCenter(
      drag.startCardPos.x + anchor.displaySize.width / 2 + worldPos.x - drag.startWorldPos.x,
      drag.startCardPos.y + anchor.displaySize.height / 2 + worldPos.y - drag.startWorldPos.y,
      anchor.cardType === "Site",
    );
    const dx = snapped.x - anchor.displaySize.width / 2 - drag.startCardPos.x;
    const dy = snapped.y - anchor.displaySize.height / 2 - drag.startCardPos.y;
    const sourceIds = new Set(Array.from(drag.cards.values(), (entry) => entry.zoneId ?? drag.zoneId));
    const sources = this.canvasAreas.filter((zone) => sourceIds.has(zone.id));
    const selected = sources.flatMap((source) => source.cards.filter((card) => drag.cards.has(`${source.id}:${card.id}`)));
    const mixedBoards = new Set(selected.map((card) => this.normalizeDeckBoard(card.board))).size > 1;
    const hovered = this.getZoneAtPosition(worldPos);
    // A multi-area selection retains its source areas unless explicitly dropped
    // into a new deck/stack. Empty canvas expands its existing frames.
    const transferTarget = hovered && !sourceIds.has(hovered.id) ? hovered : null;
    const changedZones = new Set<CanvasArea>();
    const selectedKeys = new Set<string>();
    for (const source of sources) {
      const target = transferTarget ?? source;
      const targetBoard = target.type === "deck" && !mixedBoards
        ? this.getDeckBoardForPosition(target, worldPos) : null;
      const affected: CanvasCardInstance[] = [];
      const movedIds: string[] = [];
      for (const card of source.cards) {
        const start = drag.cards.get(`${source.id}:${card.id}`);
        if (!start) continue;
        const board = target.type === "deck" ? targetBoard ?? this.normalizeDeckBoard(card.board) : null;
        const moved = { ...card, x: start.x + dx, y: start.y + dy, board, isNew: false };
        affected.push(moved);
        movedIds.push(card.id);
        selectedKeys.add(`${target.id}:${card.id}`);
      }
      if (affected.length === 0) continue;
      this.applyLabelDrop(affected, source, target, worldPos, mixedBoards);
      const ids = new Set(movedIds);
      if (source === target) {
        const updates = new Map(affected.map((card) => [card.id, card]));
        const previousBoards = new Map(source.cards.map((card) => [card.id, this.normalizeDeckBoard(card.board)]));
        source.cards = source.cards.map((card) => updates.get(card.id) ?? card);
        for (const card of affected) {
          if (target.type === "deck" && previousBoards.get(card.id) !== this.normalizeDeckBoard(card.board)) {
            this.syncDeckVariantForBoardChange(target, card.id, this.normalizeDeckBoard(card.board));
          }
        }
      } else {
        source.cards = source.cards.filter((card) => !ids.has(card.id));
        this.removeDeckVariantCardReferences(source, movedIds);
        target.cards = [...target.cards, ...affected];
        this.registerDeckVariantAdditions(target, affected);
      }
      changedZones.add(source);
      changedZones.add(target);
    }
    this.selectedZoneCardKeys = selectedKeys;
    for (const zone of changedZones) this.reconcileCanvasAreaBounds(zone.id);
    this.resetZoneCardDrag();
    this.rebuildZoneVisuals();
    this.playCardsEffect('place', selectedKeys);
    this.emitCanvasAreasChange();
  }

  private resetZoneCardDrag(): void {
    this.clearZoneCardDragFeedback();
    this.zoneCardDragState = {
      isDragging: false, key: null, zoneId: null, instanceId: null,
      startWorldPos: { x: 0, y: 0 }, startCardPos: { x: 0, y: 0 }, cards: new Map(),
    };
  }

  private cancelDesktopInteraction(): void {
    this.desktopPanStart = null;
    this.pendingCardClick = null;
    this.pendingZoneCardClick = null;
    this.pointerDownOnSelectedCard = false;
    this.cancelSelectionBox();
    if (this.dragState.isDragging) this.endCardDrag(true);
    if (this.labelDragState.isDragging) this.endLabelDrag(true);
    if (this.zoneDragState.isDragging) {
      this.updateZoneDrag(this.zoneDragState.startWorldPos);
      this.endZoneDrag(this.zoneDragState.startWorldPos);
    }
    if (this.zoneCardDragState.isDragging) {
      this.resetZoneCardDrag();
      this.rebuildZoneVisuals();
    }
    this.camera?.resumeDrag();
  }

  private startZoneDrag(zoneId: string, worldPos: { x: number; y: number }): void {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone) return;

    this.zoneDragState = {
      isDragging: true,
      zoneId,
      startWorldPos: { ...worldPos },
      startBounds: { x: zone.bounds.x, y: zone.bounds.y },
    };
    this.clearSelection();
  }

  private updateZoneDrag(worldPos: { x: number; y: number }): void {
    if (!this.zoneDragState.isDragging || !this.zoneDragState.zoneId) return;
    if (!this.zoneDragState.startBounds) return;

    const zone = this.canvasAreas.find((entry) => entry.id === this.zoneDragState.zoneId);
    if (!zone) {
      this.zoneDragState = {
        isDragging: false,
        zoneId: null,
        startWorldPos: { x: 0, y: 0 },
        startBounds: null,
      };
      return;
    }

    const dx = worldPos.x - this.zoneDragState.startWorldPos.x;
    const dy = worldPos.y - this.zoneDragState.startWorldPos.y;
    const targetX = this.zoneDragState.startBounds.x + dx;
    const targetY = this.zoneDragState.startBounds.y + dy;
    const moveX = targetX - zone.bounds.x;
    const moveY = targetY - zone.bounds.y;

    if (moveX === 0 && moveY === 0) return;

    zone.bounds.x = targetX;
    zone.bounds.y = targetY;
    for (const label of this.canvasLabels) if (label.areaId === zone.id) { label.x += moveX; label.y += moveY; }
    zone.cards = zone.cards.map((card) => ({
      ...card,
      x: card.x + moveX,
      y: card.y + moveY,
    }));
    this.rebuildZoneVisuals();
  }

  private endZoneDrag(_worldPos: { x: number; y: number }): void {
    if (!this.zoneDragState.zoneId || !this.zoneDragState.startBounds) {
      this.zoneDragState = {
        isDragging: false,
        zoneId: null,
        startWorldPos: { x: 0, y: 0 },
        startBounds: null,
      };
      return;
    }

    const zone = this.canvasAreas.find((entry) => entry.id === this.zoneDragState.zoneId);
    if (!zone) return;

    const startBounds = this.zoneDragState.startBounds;
    const rawDeltaX = zone.bounds.x - startBounds.x;
    const rawDeltaY = zone.bounds.y - startBounds.y;
    const snappedDeltaX =
      Math.round(rawDeltaX / DRAWN_GRID.width) * DRAWN_GRID.width;
    const snappedDeltaY =
      Math.round(rawDeltaY / DRAWN_GRID.height) * DRAWN_GRID.height;
    const snappedX = startBounds.x + snappedDeltaX;
    const snappedY = startBounds.y + snappedDeltaY;
    const dx = snappedX - zone.bounds.x;
    const dy = snappedY - zone.bounds.y;
    zone.bounds.x = snappedX;
    zone.bounds.y = snappedY;
    for (const label of this.canvasLabels) if (label.areaId === zone.id) { label.x += dx; label.y += dy; }
    this.emitCanvasLabelsChange();
    zone.cards = zone.cards.map((card) => ({
      ...card,
      x: card.x + dx,
      y: card.y + dy,
    }));
    this.zoneDragState = {
      isDragging: false,
      zoneId: null,
      startWorldPos: { x: 0, y: 0 },
      startBounds: null,
    };
    this.rebuildZoneVisuals();
    this.emitCanvasAreasChange();
  }

  private removeCanvasCardInstance(zoneId: string, instanceId: string): void {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone) return;

    const index = zone.cards.findIndex(card => card.id === instanceId);
    const card = zone.cards[index];
    if (!card) return;
    this.removedCardHistory ??= [];
    this.removedCardHistory.push({ areaId: zoneId, card: { ...card }, index,
      variants: zone.deckVariants?.filter(variant => variant.activeCardIds.includes(instanceId)).map(variant => variant.id) ?? [] });
    if (this.removedCardHistory.length > 20) this.removedCardHistory.shift();

    zone.cards = zone.cards.filter((entry) => entry.id !== instanceId);
    this.removeDeckVariantCardReferences(zone, [instanceId]);
    this.reconcileCanvasAreaBounds(zone.id);
    this.rebuildZoneVisuals();
  }

  private duplicateCanvasCardInstance(zoneId: string, instanceId: string): void {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone) return;
    if (zone.type === "stack") return;

    const source = zone.cards.find((entry) => entry.id === instanceId);
    if (!source) return;

    const sourceBoard: DeckZoneBoard | null =
      zone.type === "deck" ? this.normalizeDeckBoard(source.board) : null;

    const duplicate: CanvasCardInstance = {
      id:
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      cardName: source.cardName,
      x: source.x,
      y: source.y,
      board: sourceBoard,
      labelId: source.labelId,
      isNew: zone.type === 'deck',
    };

    zone.cards = [...zone.cards, duplicate];
    if (zone.type === "deck" && sourceBoard) {
      this.syncDeckVariantForBoardChange(zone, duplicate.id, sourceBoard);
    }
    this.playCardsEffect('stack', this.getZoneStackEffectKeys(zoneId, instanceId));
    this.reconcileCanvasAreaBounds(zone.id, { anchorBoard: sourceBoard });
  }

  private getDeckBoardForPosition(
    zone: CanvasArea,
    worldPos: { x: number; y: number },
  ): DeckZoneBoard | null {
    if (zone.type !== "deck") return null;
    const rects = this.getDeckBoardRects(zone.bounds, zone);
    const containing = DECK_BOARD_ORDER.filter((board) => {
      const rect = rects[board];
      return worldPos.x >= rect.x && worldPos.x <= rect.x + rect.width &&
        worldPos.y >= rect.y && worldPos.y <= rect.y + rect.height;
    });
    // Headers are deliberate targets even when expanded board frames overlap.
    const header = containing.find((board) => worldPos.y <= rects[board].y + ZONE_DECK_CARD_TOP_GAP);
    if (header) return header;
    containing.sort((left, right) => rects[left].width * rects[left].height - rects[right].width * rects[right].height);
    return containing[0] ?? null;
  }

  private planZoneCardAdditions(
    zone: CanvasArea,
    cardNames: string[],
    worldPos: { x: number; y: number },
    options?: {
      useZonePlacement?: boolean;
      placements?: DraggedCardPlacement[];
      previewIds?: boolean;
    },
  ): {
    additions: CanvasCardInstance[];
    anchorBoard: DeckZoneBoard | null;
  } {
    const enforceUnique = zone.type === "stack";
    const existingNames = enforceUnique
      ? new Set(zone.cards.map((card) => card.cardName))
      : null;
    const queuedNames = enforceUnique ? new Set<string>() : null;
    const useZonePlacement = options?.useZonePlacement ?? false;
    const placements = options?.placements ?? [];
    const placementQueueByName = new Map<string, DraggedCardPlacement[]>();
    for (const placement of placements) {
      const queue = placementQueueByName.get(placement.cardName) ?? [];
      queue.push(placement);
      placementQueueByName.set(placement.cardName, queue);
    }

    const entries: DraggedCardPlacement[] = cardNames.map((cardName) => {
      const queue = placementQueueByName.get(cardName);
      const match = queue && queue.length > 0 ? queue.shift() : null;
      if (match) {
        return {
          cardName,
          centerX: match.centerX,
          centerY: match.centerY,
        };
      }
      return {
        cardName,
        centerX: worldPos.x,
        centerY: worldPos.y,
      };
    });

    const fallbackDeckBoard =
      zone.type === "deck"
        ? useZonePlacement ? "mainboard" : this.getDeckBoardForPosition(zone, worldPos) ?? "mainboard"
        : null;
    let anchorBoard: DeckZoneBoard | null = fallbackDeckBoard;
    const additions: CanvasCardInstance[] = [];

    const firstEntry = entries[0];
    const firstSnap = firstEntry ? snapCardCenter(firstEntry.centerX, firstEntry.centerY,
      this.isLandscapeCard(firstEntry.cardName)) : worldPos;
    const snapOffset = firstEntry ? { x: firstSnap.x - firstEntry.centerX, y: firstSnap.y - firstEntry.centerY } : { x: 0, y: 0 };

    entries.forEach((entry, index) => {
      if (
        enforceUnique &&
        (existingNames?.has(entry.cardName) || queuedNames?.has(entry.cardName))
      ) {
        return;
      }
      queuedNames?.add(entry.cardName);

      const isLandscape = this.isLandscapeCard(entry.cardName);
      const size = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      const snapped = { x: entry.centerX + snapOffset.x, y: entry.centerY + snapOffset.y };
      const boardForCard = fallbackDeckBoard;
      if (zone.type === "deck" && additions.length === 0) anchorBoard = boardForCard;

      additions.push({
        id: options?.previewIds
          ? `preview:${zone.id}:${index}:${entry.cardName}`
          : typeof crypto !== "undefined" &&
              typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        cardName: entry.cardName,
        x: snapped.x - size.width / 2,
        y: snapped.y - size.height / 2,
        board: zone.type === "deck" ? boardForCard : null,
      });
    });

    if (zone.type === "deck" && useZonePlacement) {
      placeNewDeckCards(zone, additions, (name) => this.isLandscapeCard(name));
    }
    return { additions, anchorBoard };
  }

  private computeCanvasAreaBoundsFromCards(
    zone: CanvasArea,
    cards: CanvasCardInstance[],
  ): { x: number; y: number; width: number; height: number } {
    if (zone.type === "deck") {
      return getDeckAreaBounds({ bounds: zone.bounds, cards }, this.getZoneHeaderHeight(zone),
        (name) => this.isLandscapeCard(name));
    }
    const minSize = ZONE_DEFAULT_SIZE.stack;
    const headerHeight = this.getZoneHeaderHeight(zone);

    if (cards.length === 0) {
      return {
        x: zone.bounds.x,
        y: zone.bounds.y,
        width: minSize.width,
        height: minSize.height,
      };
    }

    let minCardLeft = Number.POSITIVE_INFINITY;
    let minCardTop = Number.POSITIVE_INFINITY;
    let maxCardRight = Number.NEGATIVE_INFINITY;
    let maxCardBottom = Number.NEGATIVE_INFINITY;

    for (const instance of cards) {
      const isLandscape = this.isLandscapeCard(instance.cardName);
      const size = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      minCardLeft = Math.min(minCardLeft, instance.x);
      minCardTop = Math.min(minCardTop, instance.y);
      maxCardRight = Math.max(maxCardRight, instance.x + size.width);
      maxCardBottom = Math.max(maxCardBottom, instance.y + size.height);
    }

    const nextX = minCardLeft - (ZONE_BODY_PADDING + ZONE_AUTO_EXPAND_PADDING);
    const nextY =
      minCardTop -
      (headerHeight + ZONE_BODY_PADDING + ZONE_AUTO_EXPAND_PADDING);
    const nextRight = maxCardRight + ZONE_BODY_PADDING + ZONE_AUTO_EXPAND_PADDING;
    const nextBottom = maxCardBottom + ZONE_BODY_PADDING + ZONE_AUTO_EXPAND_PADDING;

    return {
      x: nextX,
      y: nextY,
      width: Math.max(minSize.width, nextRight - nextX),
      height: Math.max(minSize.height, nextBottom - nextY),
    };
  }

  private updateZoneDropPreview(
    zone: CanvasArea | null,
    worldPos: { x: number; y: number },
    placements: DraggedCardPlacement[],
  ): void {
    if (!zone || placements.length === 0) {
      this.clearZoneDropPreview();
      return;
    }

    const cardNames = placements.map((entry) => entry.cardName);
    const { additions } = this.planZoneCardAdditions(zone, cardNames, worldPos, {
      placements,
      previewIds: true,
    });
    if (additions.length === 0) {
      this.clearZoneDropPreview();
      return;
    }

    const previewBounds = this.computeCanvasAreaBoundsFromCards(zone, [
      ...zone.cards,
      ...additions,
    ]);
    const signature =
      `${zone.id}:${Math.round(previewBounds.x)},${Math.round(previewBounds.y)},` +
      `${Math.round(previewBounds.width)},${Math.round(previewBounds.height)}:` +
      additions
        .map(
          (entry) =>
            `${entry.cardName}@${Math.round(entry.x)},${Math.round(entry.y)}:${
              entry.board ?? "none"
            }`,
        )
        .join("|");
    if (signature === this.zoneDropPreviewSignature) return;

    this.clearZoneDropPreview();
    this.zoneDropPreviewSignature = signature;

    const overlay = this.zoneDropPreviewOverlay;
    if (overlay) {
      const headerHeight = this.getZoneHeaderHeight(zone);
      overlay.visible = true;
      overlay.clear();
      overlay.roundRect(
        previewBounds.x,
        previewBounds.y,
        previewBounds.width,
        previewBounds.height,
        8,
      );
      overlay.fill({ color: MANGA_PALETTE.gold, alpha: 0.13 });
      overlay.stroke({ width: 2, color: MANGA_PALETTE.paper, alpha: 0.78 });
      overlay.roundRect(
        previewBounds.x,
        previewBounds.y,
        previewBounds.width,
        headerHeight,
        8,
      );
      overlay.fill({ color: MANGA_PALETTE.gold, alpha: 0.1 });
      overlay.stroke({ width: 1, color: MANGA_PALETTE.paper, alpha: 0.58 });
    }

    additions.forEach((addition, index) => {
      const isLandscape = this.isLandscapeCard(addition.cardName);
      const size = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      const sprite = new CardSprite({
        name: addition.cardName,
        isLandscape,
        x: addition.x + size.width / 2,
        y: addition.y + size.height / 2,
      });
      sprite.eventMode = "none";
      sprite.cursor = "default";
      sprite.alpha = 0.4;
      sprite.zIndex = 25000 + index;
      sprite.loadInitialTexture();
      this.zoneDropPreviewContainer.addChild(sprite);
      this.zoneDropPreviewSprites.push(sprite);
    });
    this.zoneDropPreviewContainer.sortChildren();
  }

  private clearZoneDropPreview(): void {
    if (!this.zoneDropPreviewSignature && this.zoneDropPreviewSprites.length === 0) {
      if (this.zoneDropPreviewOverlay?.visible) {
        this.zoneDropPreviewOverlay.clear();
        this.zoneDropPreviewOverlay.visible = false;
      }
      return;
    }

    this.zoneDropPreviewSignature = null;
    if (this.zoneDropPreviewOverlay) {
      this.zoneDropPreviewOverlay.clear();
      this.zoneDropPreviewOverlay.visible = false;
    }
    for (const sprite of this.zoneDropPreviewSprites) {
      sprite.destroy();
    }
    this.zoneDropPreviewSprites = [];
  }

  private addDraggedCardsToZoneOrRequestDeck(
    zone: CanvasArea,
    cardNames: string[],
    worldPos: { x: number; y: number },
    screenPos: { x: number; y: number },
    placements: DraggedCardPlacement[],
    source: DeckAddRequestPayload["source"],
    options?: { useZonePlacement?: boolean },
  ): void {
    if (zone.type === "deck" && zone.deckId) {
      this.requestDeckAdd({
        deckId: zone.deckId,
        canvasAreaId: zone.id,
        cardNames,
        placements,
        worldPos,
        screenPos,
        source,
      });
      return;
    }

    this.copyCardsIntoZone(zone.id, cardNames, worldPos, {
      useZonePlacement: options?.useZonePlacement ?? false,
      placements,
    });
  }

  private copyCardsIntoZone(
    zoneId: string,
    cardNames: string[],
    worldPos: { x: number; y: number },
    options?: { useZonePlacement?: boolean; placements?: DraggedCardPlacement[] },
  ): void {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone) return;
    const { additions, anchorBoard } = this.planZoneCardAdditions(
      zone,
      cardNames,
      worldPos,
      {
        useZonePlacement: options?.useZonePlacement ?? false,
        placements: options?.placements ?? [],
      },
    );

    if (additions.length === 0) {
      return;
    }

    zone.cards = [...zone.cards, ...additions];
    this.applyLabelDrop(additions, zone, zone, worldPos, false);
    this.registerDeckVariantAdditions(zone, additions);
    this.onCardsAddedToCanvasArea?.(
      zone.id,
      additions.map((addition) => addition.cardName),
    );

    if (zone.type === "stack") {
      this.reconcileCanvasAreaBounds(zone.id);
      this.rebuildZoneVisuals();
      this.playCardsEffect('stack', additions.flatMap(card => this.getZoneStackEffectKeys(zone.id, card.id)));
      this.emitCanvasAreasChange();
      return;
    }

    this.reconcileCanvasAreaBounds(zone.id, { anchorBoard });
    this.rebuildZoneVisuals();
    this.playCardsEffect('arrive', additions.flatMap(card => this.getZoneStackEffectKeys(zone.id, card.id)));
    this.emitCanvasAreasChange();
  }

  private reconcileCanvasAreaBounds(
    zoneId: string,
    options?: {
      anchorBoard?: DeckZoneBoard | null;
      preserveTopLeft?: boolean;
    },
  ): void {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone) return;

    if (zone.type === "deck") {
      zone.bounds = getDeckAreaBounds(zone, this.getZoneHeaderHeight(zone),
        (name) => this.isLandscapeCard(name), options?.preserveTopLeft);
      this.fitLabelRegionBounds(zone);
      return;
    }

    const minSize = ZONE_DEFAULT_SIZE.stack;
    const headerHeight = this.getZoneHeaderHeight(zone);
    if (zone.cards.length === 0) {
      zone.bounds.width = minSize.width;
      zone.bounds.height = minSize.height;
      return;
    }

    let minCardLeft = Infinity;
    let minCardTop = Infinity;
    let maxCardRight = -Infinity;
    let maxCardBottom = -Infinity;

    for (const instance of zone.cards) {
      const isLandscape = this.isLandscapeCard(instance.cardName);
      const size = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      minCardLeft = Math.min(minCardLeft, instance.x);
      minCardTop = Math.min(minCardTop, instance.y);
      maxCardRight = Math.max(maxCardRight, instance.x + size.width);
      maxCardBottom = Math.max(maxCardBottom, instance.y + size.height);
    }

    if (
      minCardLeft === Infinity ||
      minCardTop === Infinity ||
      maxCardRight === -Infinity ||
      maxCardBottom === -Infinity
    ) {
      return;
    }

    const nextX = minCardLeft - (ZONE_BODY_PADDING + ZONE_AUTO_EXPAND_PADDING);
    const nextY =
      minCardTop -
      (headerHeight + ZONE_BODY_PADDING + ZONE_AUTO_EXPAND_PADDING);
    const nextRight = maxCardRight + ZONE_BODY_PADDING + ZONE_AUTO_EXPAND_PADDING;
    const nextBottom = maxCardBottom + ZONE_BODY_PADDING + ZONE_AUTO_EXPAND_PADDING;

    const prevX = zone.bounds.x;
    const prevY = zone.bounds.y;
    if (options?.preserveTopLeft) {
      zone.bounds.width = Math.max(minSize.width, nextRight - prevX);
      zone.bounds.height = Math.max(minSize.height, nextBottom - prevY);
      return;
    }

    zone.bounds.x = nextX;
    zone.bounds.y = nextY;
    zone.bounds.width = Math.max(minSize.width, nextRight - nextX);
    zone.bounds.height = Math.max(minSize.height, nextBottom - nextY);

  }

  // ============================================================================
  // Card Stacking
  // ============================================================================

  private rebuildCardStacks(): void {
    this.cardStacks.clear();

    // Group collection cards by grid position
    for (const [cardName, data] of this.cardSprites) {
      const gridKey = data.gridKey;
      let stack = this.cardStacks.get(gridKey);
      if (!stack) {
        stack = [];
        this.cardStacks.set(gridKey, stack);
      }
      stack.push(cardName);
    }

    // Group deck cards by grid position
    for (const [key, data] of this.deckSprites) {
      const gridKey = data.gridKey;
      let stack = this.cardStacks.get(gridKey);
      if (!stack) {
        stack = [];
        this.cardStacks.set(gridKey, stack);
      }
      stack.push(key);
    }

    // Apply stacking offsets and z-indices
    for (const cardNames of this.cardStacks.values()) {
      this.applyStackOffsets(cardNames);
    }

    this.cardContainer.sortChildren();
  }

  /**
   * Apply visual offsets to cards in a stack
   * - Spells (portrait): offset downward (names on top visible)
   * - Sites (landscape): offset upward (names on bottom visible)
   * @param skipPositionUpdates - If true, only update z-indices (during animation)
   */
  private applyStackOffsets(
    cardNames: string[],
    skipPositionUpdates = false,
  ): void {
    const stackSize = cardNames.length;

    if (stackSize <= 1) {
      // Single card, reset to base position
      const firstCard = cardNames[0];
      if (firstCard) {
        const data = this.getSpriteData(firstCard);
        if (data) {
          if (!skipPositionUpdates) {
            data.sprite.x = data.basePosition.x;
            data.sprite.y = data.basePosition.y;
            this.updateCardBounds(data);
          }
          data.sprite.zIndex = 0;
        }
      }
      return;
    }

    // Calculate total stack offset for centering
    const totalOffset = (stackSize - 1) * STACK_OFFSET;

    for (const [i, cardName] of cardNames.entries()) {
      const data = this.getSpriteData(cardName);
      if (!data) continue;

      // Higher index = higher z-index (on top)
      data.sprite.zIndex = i;

      // Skip position updates during animation
      if (skipPositionUpdates) continue;

      const isSite = data.layout.isLandscape;

      // Calculate offset from center of stack
      const indexOffset = i * STACK_OFFSET - totalOffset / 2;

      // Sites offset upward (negative Y), Spells offset downward (positive Y)
      const yOffset = isSite ? -indexOffset : indexOffset;

      data.sprite.x = data.basePosition.x;
      data.sprite.y = data.basePosition.y + yOffset;

      // Update bounds for hit testing
      const displaySize = data.displaySize;
      data.bounds = {
        left: data.sprite.x,
        top: data.sprite.y,
        right: data.sprite.x + displaySize.width,
        bottom: data.sprite.y + displaySize.height,
      };
    }
  }

  private updateCardBounds(data: CardSpriteData): void {
    const cardSize = data.displaySize;
    data.bounds = {
      left: data.sprite.x,
      top: data.sprite.y,
      right: data.sprite.x + cardSize.width,
      bottom: data.sprite.y + cardSize.height,
    };
  }

  // ============================================================================
  // Selection Box
  // ============================================================================

  private startSelectionBox(worldPos: { x: number; y: number }, additive = false): void {
    this.selectionBox.additive = additive;
    this.selectionBox.isActive = true;
    this.selectionBox.startWorldPos = { ...worldPos };

    if (this.selectionBox.graphics) {
      this.selectionBox.graphics.clear();
      this.selectionBox.graphics.visible = true;
    }
  }

  private updateSelectionBox(worldPos: { x: number; y: number }): void {
    if (!this.selectionBox.startWorldPos || !this.selectionBox.graphics) return;

    const start = this.selectionBox.startWorldPos;
    const left = Math.min(start.x, worldPos.x);
    const top = Math.min(start.y, worldPos.y);
    const width = Math.abs(worldPos.x - start.x);
    const height = Math.abs(worldPos.y - start.y);

    this.selectionBox.graphics.clear();
    this.selectionBox.graphics.rect(left, top, width, height);
    this.selectionBox.graphics.fill({ color: MANGA_PALETTE.gold, alpha: 0.07 });
    this.selectionBox.graphics.stroke({ width: 1.5 / Math.max(0.01, this.camera?.zoom ?? 1), color: MANGA_PALETTE.paper });
  }

  private endSelectionBox(worldPos: { x: number; y: number }): void {
    if (!this.selectionBox.startWorldPos) return;

    const start = this.selectionBox.startWorldPos;
    const selectionBounds = {
      left: Math.min(start.x, worldPos.x),
      top: Math.min(start.y, worldPos.y),
      right: Math.max(start.x, worldPos.x),
      bottom: Math.max(start.y, worldPos.y),
    };

    // Only change selection if box is large enough (not just a click)
    const boxWidth = Math.abs(worldPos.x - start.x);
    const boxHeight = Math.abs(worldPos.y - start.y);

    if (boxWidth > 10 || boxHeight > 10) {
      const zoneHitsById = new Map<string, string[]>();
      for (const [key, data] of this.zoneCardSprites) {
        if (!this.boundsIntersect(data.bounds, selectionBounds)) continue;
        const hits = zoneHitsById.get(data.zoneId) ?? [];
        hits.push(key);
        zoneHitsById.set(data.zoneId, hits);
      }

      if (!this.selectionBox.additive) this.clearSelection(true);

      if (zoneHitsById.size > 0) {
        this.clearMainSelection(true);
        for (const keys of zoneHitsById.values()) {
          for (const key of keys) this.selectZoneCard(key);
        }
      } else {
        const mainHits = [...this.cardSprites, ...this.deckSprites, ...this.associationShelfSprites]
          .filter(([, data]) => data.sprite.visible && this.boundsIntersect(data.bounds, selectionBounds));
        // An empty additive marquee must leave the existing deck selection intact.
        if (mainHits.length > 0) this.clearZoneSelection();
        for (const [key] of mainHits) this.selectCard(key, true);
      }
      this.emitSelectionChange();
    }

    this.cancelSelectionBox();
  }

  private cancelSelectionBox(): void {
    if (this.selectionBox.graphics) {
      this.selectionBox.graphics.clear();
      this.selectionBox.graphics.visible = false;
    }

    this.selectionBox.isActive = false;
    this.selectionBox.startWorldPos = null;
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  setCards(cards: Card[], options?: { catalogueCards?: Card[]; catalogueLayout?: CatalogueLayoutConfig }): void {
    const catalogueCards = options?.catalogueCards ?? cards;
    const catalogueLayout = options?.catalogueLayout ?? createDefaultCatalogueLayout();
    if (!this.isInitialized) {
      this.pendingCardSet = { cards, catalogueCards, catalogueLayout };
      return;
    }

    const sourceChanged = this.cards !== cards;
    const layoutChanged = JSON.stringify(this.catalogueLayout) !== JSON.stringify(catalogueLayout);
    const restartReveal = this.isRevealInProgress;
    this.cards = cards;
    this.catalogueCards = catalogueCards;
    this.catalogueLayout = catalogueLayout;
    this.onBackgroundTextureProgress?.(0, 0);
    // A filter/layout change touches only catalogue sprites. Deck metadata,
    // selections, custom positions, variants and frame geometry stay intact.
    this.rebuildCardSprites(sourceChanged);
    // Filters and restored preferences can replace sprites while startup is
    // awaiting their textures. Continue with the current sprites, not the dead queue.
    if (restartReveal) void this.startTextureReveal();
    if (this.catalogueEffectTimer) clearTimeout(this.catalogueEffectTimer);
    if (!sourceChanged && this.camera && this.motionEnabled()) {
      this.catalogueEffectTimer = setTimeout(() => {
        this.catalogueEffectTimer = null;
        const data = [...this.cardSprites.values()].find(entry => entry.sprite.visible);
        this.playMangaEffect(layoutChanged ? 'sort' : 'filter', data?.bounds);
      }, 220);
    }
  }

  setCanvasAreas(areas: CanvasArea[]): void {
    const previous = this.canvasAreas;
    const canAnimate = this.hasReceivedAreas && this.isInitialized && this.initialRevealCompleted;
    this.hasReceivedAreas = true;
    this.canvasAreas = this.cloneCanvasAreas(areas);
    this.hoveredDeckFilterChip = null;
    for (const zone of this.canvasAreas) {
      if (zone.type === "deck") {
        this.ensureDeckZoneVariants(zone);
        zone.cardFilters = ensureCardFilterState(zone.cardFilters);
      }
    }
    this.clearZoneDropPreview();
    this.deactivateQuickTransfer();
    this.closeDeckCardDeletePrompt();
    this.rebuildZoneVisuals();
    if (canAnimate) {
      const previousIds = new Set(previous.flatMap(area => area.cards.map(card => card.id)));
      for (const area of this.canvasAreas) {
        if (!area.pinned) continue;
        const old = previous.find(entry => entry.id === area.id);
        if (!old?.pinned) { this.playAreaEffect('reveal', area); continue; }
        const added = area.cards.filter(card => !previousIds.has(card.id));
        if (added.length) this.playCardsEffect(area.type === 'stack' ? 'stack' : 'arrive',
          added.flatMap(card => this.getZoneStackEffectKeys(area.id, card.id)));
      }
      for (const old of previous) if (old.pinned && !this.canvasAreas.some(area => area.id === old.id && area.pinned)) this.playAreaEffect('hide', old);
    }
  }

  setDeckTransferTargets(targets: QuickTransferDeckTarget[]): void {
    this.deckTransferTargets = targets.map((target) => ({ ...target }));
    if (this.quickTransferState.active) {
      this.deactivateQuickTransfer();
    }
  }

  focusZone(zoneId: string, bottomInset = 0): void {
    if (!this.camera) return;
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId && entry.pinned);
    if (!zone) return;

    const safeWidth = Math.max(zone.bounds.width, DRAWN_GRID.width);
    const safeHeight = Math.max(zone.bounds.height, DRAWN_GRID.height);
    this.camera.fitToContent(
      {
        left: zone.bounds.x,
        top: zone.bounds.y,
        right: zone.bounds.x + safeWidth,
        bottom: zone.bounds.y + safeHeight,
      },
      120,
      this.motionEnabled() ? 450 : 1,
      bottomInset,
    );
    if (this.focusEffectTimer) clearTimeout(this.focusEffectTimer);
    this.focusEffectTimer = setTimeout(() => { this.focusEffectTimer = null; this.playAreaEffect('focus', zone); }, this.motionEnabled() ? 460 : 0);
  }

  /** Explicit canvas tools: effects describe successful actions, never delay them. */
  runCanvasGesture(command: CanvasGestureCommand, bottomInset = 0): string | null {
    if (command === 'close-inspection') { this.closeInspection(); return null; }
    if (command === 'undo') {
      const saved = this.removedCardHistory.pop();
      if (!saved) return 'There is no card removal to undo in this session.';
      const area = this.canvasAreas.find(entry => entry.id === saved.areaId);
      if (!area) return 'That deck or stack is no longer on this canvas.';
      if (area.cards.some(card => card.id === saved.card.id)) return null;
      // An immediate undo must not leave "pooft" playing over a restored card.
      for (const { effect } of this.deletionPuffs) effect.destroy();
      this.deletionPuffs = [];
      this.mangaEffects = this.mangaEffects.filter(entry => {
        if (entry.effect.kind !== 'delete') return true;
        entry.effect.destroy(); return false;
      });
      const card = { ...saved.card };
      if (!this.canvasLabels.some(label => label.id === card.labelId)) delete card.labelId;
      area.cards.splice(Math.min(saved.index, area.cards.length), 0, card);
      for (const variant of area.deckVariants ?? []) if (saved.variants.includes(variant.id) && !variant.activeCardIds.includes(card.id)) variant.activeCardIds.push(card.id);
      this.reconcileCanvasAreaBounds(area.id);
      this.rebuildZoneVisuals();
      this.playMangaEffect('restore', this.zoneCardSprites.get(`${area.id}:${card.id}`)?.bounds);
      this.emitCanvasAreasChange();
      return null;
    }
    if (command === 'new') {
      const added = this.canvasAreas.filter(area => area.pinned).flatMap(area => area.cards.filter(card => card.isNew).map(card => `${area.id}:${card.id}`));
      if (!added.length) return 'All added cards have already been picked up.';
      this.clearSelection(true);
      for (const key of added) this.selectZoneCard(key);
      this.emitSelectionChange();
      const first = this.zoneCardSprites.get(added[0] ?? '');
      if (first) {
        this.camera?.fitToContent(first.bounds, 130, this.motionEnabled() ? 300 : 1, bottomInset);
        if (this.focusEffectTimer) clearTimeout(this.focusEffectTimer);
        this.focusEffectTimer = setTimeout(() => { this.focusEffectTimer = null; this.playMangaEffect('arrive', first.bounds); }, 310);
      }
      return null;
    }
    const selected = [...this.selectedZoneCardKeys, ...this.selectedCards];
    if (!selected.length) return 'Select cards on the canvas first.';
    if (command === 'compare' || command === 'peek') {
      const names = selected.flatMap(key => {
        const name = this.zoneCardSprites.get(key)?.cardName ?? this.getSpriteData(key)?.layout.name;
        return name ? [name] : [];
      });
      const unique = [...new Set(names)];
      if (command === 'compare' && unique.length < 2) return 'Select two different cards to compare.';
      this.openInspection(command === 'compare' ? unique.slice(0, 2) : names, command === 'compare', 0);
      return null;
    }
    const firstKey = selected[0] ?? '';
    const first = this.zoneCardSprites.get(firstKey) ?? this.getSpriteData(firstKey);
    if (command === 'focus') {
      const zone = this.zoneCardSprites.get(firstKey);
      if (zone) this.focusZone(zone.zoneId, bottomInset);
      else if (first) {
        this.camera?.fitToContent(first.bounds, 100, this.motionEnabled() ? 300 : 1, bottomInset);
        if (this.focusEffectTimer) clearTimeout(this.focusEffectTimer);
        this.focusEffectTimer = setTimeout(() => { this.focusEffectTimer = null; this.playMangaEffect('focus', first.bounds); }, 310);
      }
      return null;
    }
    if (command === 'tidy') {
      // Align the selection by a shared grid translation. Keep group offsets,
      // labels, board membership and unselected cards exactly where they were.
      if (!first) return null;
      if (this.selectedZoneCardKeys.size) {
        const data = this.zoneCardSprites.get(firstKey);
        if (!data) return null;
        const original = this.canvasAreas.find(area => area.id === data.zoneId)?.cards.find(card => card.id === data.instanceId);
        if (!original) return null;
        const snapped = snapCardCenter(original.x + data.displaySize.width / 2, original.y + data.displaySize.height / 2, data.cardType === 'Site');
        const dx = snapped.x - data.displaySize.width / 2 - original.x;
        const dy = snapped.y - data.displaySize.height / 2 - original.y;
        for (const area of this.canvasAreas) {
          const previousCards = area.cards;
          area.cards = area.cards.map(card => this.selectedZoneCardKeys.has(`${area.id}:${card.id}`) ? { ...card, x: card.x + dx, y: card.y + dy } : card);
          this.canvasLabels = repositionLabelsAfterCardLayout(this.canvasLabels, area.id, previousCards, area.cards);
          this.reconcileCanvasAreaBounds(area.id);
        }
        this.rebuildZoneVisuals();
        this.emitCanvasAreasChange();
        this.emitCanvasLabelsChange();
      } else {
        this.startCardDrag({ x: first.bounds.left, y: first.bounds.top });
        this.endCardDrag();
      }
      this.playMangaEffect('snap', first.bounds);
      return null;
    }
    return null;
  }

  private closeInspection(): void {
    this.inspection?.destroy({ children: true });
    this.inspection = null;
  }

  private openInspection(names: string[], compare: boolean, page: number): void {
    this.closeInspection();
    const root = new Container();
    this.inspection = root;
    root.eventMode = 'static';
    root.on('pointerdown', event => event.stopPropagation());
    root.on('pointerup', event => event.stopPropagation());
    const width = this.app.screen.width; const height = this.app.screen.height;
    const background = new Graphics().rect(0, 0, width, height).fill({ color: 0x0f1423, alpha: 0.96 });
    background.eventMode = 'static';
    root.addChild(background);
    const pageSize = compare ? 2 : Math.max(1, Math.min(8, Math.floor((width - 40) / 140)));
    const shown = names.slice(page * pageSize, (page + 1) * pageSize);
    const title = new Text({ text: compare ? 'Compare cards' : `Peek · ${page * pageSize + 1}–${page * pageSize + shown.length} of ${names.length}`, style: { fontFamily: 'Arial', fontSize: 22, fill: 0xfff6df } });
    title.anchor.set(0.5, 0); title.position.set(width / 2, 54); root.addChild(title);
    const close = new Text({ text: 'Close ×', style: { fontFamily: 'Arial', fontSize: 20, fill: 0xfff6df } });
    // Keep inspection controls clear of the edge drawers and the account button.
    close.position.set(width / 2 + 30, 94); close.eventMode = 'static'; close.cursor = 'pointer';
    close.on('pointertap', () => this.closeInspection()); root.addChild(close);
    if (!compare && names.length > pageSize) {
      const next = new Text({ text: 'Next →', style: { fontFamily: 'Arial', fontSize: 19, fill: 0x9debd2 } });
      next.position.set(width / 2 - 120, 94); next.eventMode = 'static'; next.cursor = 'pointer';
      next.on('pointertap', () => this.openInspection(names, compare, (page + 1) % Math.ceil(names.length / pageSize))); root.addChild(next);
    }
    const cellWidth = Math.min(compare ? 470 : 230, (width - 48) / Math.max(1, shown.length));
    const maxHeight = Math.min(height - 210, compare ? 650 : 360);
    for (const [index, name] of shown.entries()) {
      const landscape = this.isLandscapeCard(name);
      const ratio = landscape ? 1039 / 744 : 744 / 1039;
      const cardWidth = Math.min(cellWidth - 18, maxHeight * ratio);
      const cardHeight = cardWidth / ratio;
      const x = width / 2 - shown.length * cellWidth / 2 + index * cellWidth + (cellWidth - cardWidth) / 2;
      const y = Math.max(130, (height - cardHeight) / 2);
      const sprite = new CardSprite({ name, isLandscape: landscape, x: x + cardWidth / 2, y: y + cardHeight / 2, displaySize: { width: cardWidth, height: cardHeight } });
      sprite.eventMode = 'none'; sprite.loadInitialTexture(); sprite.updateLOD(compare ? 4 : 0.8);
      root.addChild(sprite);
      const caption = new Text({ text: name, style: { fontFamily: 'Arial', fontSize: 13, fill: 0xc7cede, wordWrap: true, wordWrapWidth: cellWidth - 18 } });
      caption.position.set(x, y + cardHeight + 8); root.addChild(caption);
    }
    this.app.stage.addChild(root);
    if (this.motionEnabled()) {
      const now = performance.now();
      const accepted = this.effectGate.accept(compare ? 'inspect' : 'sort', now, this.effectSettings, false);
      if (accepted) {
        const effect = new MangaEffect(compare ? 'inspect' : 'sort', { left: 24, top: 130, right: 150, bottom: 185 }, 1, this.effectSettings, accepted.words);
        root.addChild(effect.root);
        // Screen-space inspection effects use their own ticker, with cleanup on close.
        const tick = () => {
          if (root.destroyed || !this.motionEnabled()) { effect.destroy(); this.app.ticker.remove(tick); }
          else if (!effect.update(performance.now() - now, 1)) this.app.ticker.remove(tick);
        };
        this.app.ticker.add(tick);
        root.once('destroyed', () => this.app.ticker.remove(tick));
      }
    }
  }

  updateDeckOverlays(
    deck: Deck | null,
    _activeBoard: ActiveBoard,
    collection: CollectionItem[],
    canvasLabels: CanvasLabel[],
  ): void {
    this.activeDeck = deck;
    this.setCanvasLabels(canvasLabels);

    // Update collection card quantity badges
    const deckQuantities = new Map<string, number>();
    const collectionQuantities = new Map<string, number>();

    if (deck) {
      // cspell:disable-next-line
      for (const board of ["mainboard", "collection", "avatar"] as const) {
        for (const card of deck.boards[board]) {
          const current = deckQuantities.get(card.name) ?? 0;
          deckQuantities.set(card.name, current + card.quantity);
        }
      }
    }

    for (const item of collection) {
      collectionQuantities.set(item.name, item.quantity);
    }

    for (const [name, data] of this.cardSprites) {
      const deckQty = deckQuantities.get(name) ?? 0;
      const collectionQty = collectionQuantities.get(name) ?? 0;
      const hasCollection = collection.length > 0;

      let quantityColor: CardSpriteState["quantityColor"] = "white";
      if (hasCollection && deckQty > 0) {
        if (deckQty > collectionQty) {
          quantityColor = "red";
        } else if (collectionQty === 0) {
          quantityColor = "black";
        }
      }

      data.sprite.updateState({
        quantity: deckQty,
        quantityColor,
        isHighlighted: true,
      });
    }

    // Rebuild deck card display below collection
    this.rebuildDeckSprites();
  }

  /** Animate the camera to fit the deck content area */
  panToDeckBounds(): void {
    if (!this.camera || this.deckSprites.size === 0) return;
    this.camera.fitToContent(this.deckBounds, 300, 1500);
  }

  updateCardCategoryHighlight(
    categoryId: string | null,
    data: CardCategoryData | null,
  ): void {
    this.selectedCardCategoryId = categoryId;
    this.cardCategoryData = data;
    this.rebuildAssociationShelfSprites();
    this.applyActiveMetricHighlighting();
  }

  updateDeckStyleAssociationHighlight(options: {
    enabled: boolean;
    mode: DeckStyleAssociationMode;
    selectedStyleId: string | null;
    selectedSubStyleId: string | null;
    associations: DeckStyleAssociationData | null;
  }): void {
    this.associationsEnabled = options.enabled;
    this.deckStyleAssociationMode = options.mode;
    this.selectedAssociationStyleId = options.selectedStyleId;
    this.selectedAssociationSubStyleId = options.selectedSubStyleId;
    this.deckStyleAssociations = options.associations;
    this.rebuildAssociationShelfSprites();
    this.applyActiveMetricHighlighting();
    if (!options.enabled) {
      this.hideAssociationTooltip();
    }
  }

  setLabelPlacementMode(enabled: boolean): void {
    this.labelPlacementMode = enabled;
  }

  /**
   * Start texture-driven reveal.
   * Textures begin downloading immediately in a randomized start order,
   * and each card is revealed as soon as its texture is ready.
   * Cards start at alpha=0, become 0.5 as they're revealed, then all
   * fade to 1.0 once every card has been revealed.
   */
  async startTextureReveal(): Promise<void> {
    const wasRevealing = this.isRevealInProgress;
    this.isRevealInProgress = true;
    this.initialRevealCompleted = false;
    this.onBackgroundTextureProgress?.(0, 0);

    for (const id of this.pendingRevealTimeouts) {
      clearTimeout(id);
    }
    this.pendingRevealTimeouts = [];

    const runId = ++this.revealRunId;

    const all = [...this.cardSprites.values()];
    const totalAll = all.length;

    if (totalAll === 0) {
      // Nothing to reveal — skip without reporting progress so we don't
      // schedule a stale clear-timeout that could wipe a later real reveal.
      this.isRevealInProgress = false;
      this.initialRevealCompleted = true;
      if (wasRevealing) this.onTextureProgress?.(0, 0);
      this.performCulling();
      return;
    }

    // Start invisible so refresh always looks random
    for (const data of all) {
      data.sprite.alpha = 0;
    }

    for (const label of this.headerLabels) {
      label.alpha = 0.5;
    }

    // Fisher–Yates shuffle
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = all[i];
      const b = all[j];
      if (a && b) {
        all[i] = b;
        all[j] = a;
      }
    }

    let revealed = 0;
    this.onTextureProgress?.(0, totalAll);

    const startupLOD = lodManager.getStartupLOD();
    const atlasAssignments = await lodManager.getAtlasAssignments(
      all.map((data) => data.layout.name),
      startupLOD,
    );
    if (this.isDestroyed || this.revealRunId !== runId) return;
    const atlasCardCounts = new Map<string, number>();
    for (const data of all) {
      const slug = cardNameToSlug(data.layout.name);
      const atlasId = atlasAssignments.get(slug);
      if (!atlasId) continue;
      atlasCardCounts.set(atlasId, (atlasCardCounts.get(atlasId) ?? 0) + 1);
    }
    const atlasRevealState = new Map<
      string,
      { nextSlot: number; startTimeMs: number | null; slotMs: number }
    >();
    for (const [atlasId, count] of atlasCardCounts) {
      atlasRevealState.set(atlasId, {
        nextSlot: 0,
        startTimeMs: null,
        slotMs:
          count <= 1 ? 0 : ATLAS_CARD_REVEAL_SPREAD_MS / Math.max(count - 1, 1),
      });
    }

    // Allow one frame for React to render the loading bar
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    if (this.isDestroyed || this.revealRunId !== runId) return;

    const tryFinish = () => {
      if (revealed >= totalAll && !this.initialRevealCompleted) {
        this.initialRevealCompleted = true;
        this.isRevealInProgress = false;
        this.revealFading = true;
        this.revealFadeStart = performance.now();
        // The camera may have moved while startup textures were downloading.
        // Set visible sprites to that zoom before preloading/refreshing detail.
        this.performCulling();
      }
    };

    const revealCard = (data: CardSpriteData) => {
      if (this.isDestroyed || this.revealRunId !== runId) return;
      // Reveal the sprite only if nothing else already made it visible
      if (data.sprite.alpha < 0.5) {
        data.sprite.alpha = 0.5;
      }
      revealed++;
      this.onTextureProgress?.(revealed, totalAll);
      tryFinish();
    };

    const scheduleReveal = (data: CardSpriteData) => {
      const slug = cardNameToSlug(data.layout.name);
      const atlasId = atlasAssignments.get(slug);
      if (!atlasId) {
        revealCard(data);
        return;
      }

      const state = atlasRevealState.get(atlasId);
      if (!state || state.slotMs <= 0) {
        revealCard(data);
        return;
      }

      const slot = state.nextSlot++;
      const now = performance.now();
      if (state.startTimeMs === null) {
        state.startTimeMs = now;
      }

      const targetTimeMs = state.startTimeMs + slot * state.slotMs;
      const delayMs = Math.max(0, targetTimeMs - now);
      if (delayMs <= 0) {
        revealCard(data);
        return;
      }

      const timeoutId = window.setTimeout(() => {
        this.pendingRevealTimeouts = this.pendingRevealTimeouts.filter(
          (id) => id !== timeoutId,
        );
        revealCard(data);
      }, delayMs);
      this.pendingRevealTimeouts.push(timeoutId);
    };

    // Start initial LOD loads in a controlled queue to avoid flooding requests.
    const queue = [...all];
    const workerCount = Math.min(getInitialRevealConcurrentLoads(), queue.length);

    for (let worker = 0; worker < workerCount; worker++) {
      void (async () => {
        while (queue.length > 0) {
          const data = queue.shift();
          if (!data) break;
          if (this.isDestroyed || this.revealRunId !== runId) return;

          data.sprite.loadInitialTexture();
          await data.sprite.textureReady;

          if (this.isDestroyed || this.revealRunId !== runId) return;

          scheduleReveal(data);
        }
      })();
    }
  }

  destroy(): void {
    window.removeEventListener('resize', this.handleInspectionResize);
    if (this.isInitialized) this.app.canvas.removeEventListener('wheel', this.handleInspectionWheel, true);
    if (this.focusEffectTimer) clearTimeout(this.focusEffectTimer);
    this.closeInspection();
    if (this.catalogueEffectTimer) clearTimeout(this.catalogueEffectTimer);
    for (const entry of this.mangaEffects ?? []) entry.effect.destroy();
    this.mangaEffects = [];
    window.removeEventListener("keydown", this.handlePanKeyDown);
    window.removeEventListener("keyup", this.handlePanKeyUp);
    window.removeEventListener("blur", this.handleCanvasBlur);
    this.isDestroyed = true;
    this.setHoveredCard(null);
    this.highDetailPreloadQueued = false;
    this.highDetailPreloadRunId++;
    this.onBackgroundTextureProgress?.(0, 0);
    this.onSelectionChange?.([]);

    for (const id of this.pendingRevealTimeouts) {
      clearTimeout(id);
    }
    this.pendingRevealTimeouts = [];
    this.revealRunId++;
    this.isRevealInProgress = false;
    if (this.mediumLoadResumeTimerId !== null) {
      clearTimeout(this.mediumLoadResumeTimerId);
      this.mediumLoadResumeTimerId = null;
    }
    this.removeTextureInvalidationListener?.();
    this.removeTextureInvalidationListener = null;
    this.closeLabelEditor?.();
    this.closeLabelEditor = null;
    this.closeDeckVariantDialog();
    this.closeDeckCardDeletePrompt();
    this.closeTouchActionSheet();
    this.deactivateQuickTransfer();
    this.clearZoneCardDragFeedback();
    for (const puff of this.deletionPuffs) puff.effect.destroy();
    this.deletionPuffs = [];
    this.mangaEffectLayer?.destroy({ children: true });
    this.mangaEffectLayer = null;
    this.destroyAssociationTooltip();

    for (const data of this.labelSprites.values()) {
      data.text.destroy();
    }
    this.labelSprites.clear();
    this.clearAssociationShelfSprites();
    this.clearZoneDropPreview();
    this.clearZoneVisuals();

    if (this.isInitialized) {
      this.app.ticker.stop();
      if (this.webglContextLostHandler) {
        this.app.canvas.removeEventListener(
          "webglcontextlost",
          this.webglContextLostHandler,
        );
      }
      if (this.webglContextRestoredHandler) {
        this.app.canvas.removeEventListener(
          "webglcontextrestored",
          this.webglContextRestoredHandler,
        );
      }
      this.camera?.destroy();
      lodManager.clearCache();
      this.app.destroy(
        { removeView: true },
        {
          children: true,
          texture: true,
          textureSource: true,
          context: true,
        },
      );
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private applyCardCategoryHighlighting(): void {
    const categoryId = this.selectedCardCategoryId;
    const scores = this.cardCategoryData;
    const active = !!categoryId && !!scores;
    const applyToSprite = (cardName: string, sprite: CardSprite): void => {
      if (!active) {
        sprite.setMetricScore(null);
        return;
      }
      sprite.setMetricScore(getCategoryScore(scores, cardName, categoryId), {
        color: MANGA_PALETTE.gold,
      });
    };

    for (const [name, data] of this.cardSprites) {
      applyToSprite(name, data.sprite);
    }
    for (const [, data] of this.deckSprites) {
      data.sprite.setMetricScore(null);
    }
    for (const [, data] of this.associationShelfSprites) {
      applyToSprite(data.layout.name, data.sprite);
    }
    for (const [, data] of this.zoneCardSprites) {
      const zone = this.canvasAreas.find((entry) => entry.id === data.zoneId);
      if (!zone?.lookupDeckId || !active) {
        data.sprite.setMetricScore(null);
        continue;
      }

      data.sprite.setMetricScore(
        getDeckStyleCardScore(
          this.deckStyleAssociations,
          this.deckStyleAssociationMode,
          this.selectedAssociationStyleId,
          this.selectedAssociationSubStyleId,
          data.cardName,
        ),
        {
          color: MANGA_PALETTE.gold,
          dimInactive: false,
          showValue: false,
        },
      );
    }
  }

  private clearAssociationShelfSprites(): void {
    for (const data of this.associationShelfSprites.values()) {
      data.sprite.destroy();
    }
    for (const label of this.associationShelfHeaderLabels) {
      label.destroy();
    }
    this.associationShelfSprites.clear();
    this.associationShelfHeaderLabels = [];
    this.associationShelfBounds = { left: 0, top: 0, right: 0, bottom: 0 };
  }

  private rebuildAssociationShelfSprites(rebuildDeck = true): void {
    this.clearAssociationShelfSprites();

    const entries = this.getAssociationShelfEntries();
    if (entries.length === 0) {
      if (rebuildDeck && this.activeDeck) {
        this.rebuildDeckSprites();
      } else {
        this.performCulling();
      }
      return;
    }

    const layoutCards = entries.map((entry) => this.getLayoutCardInput(entry.card));
    const { cards: layout, bounds: contentBounds } = calculateCardLayout({
      cards: layoutCards,
      mode: "typeRows",
      layoutVariant: this.collectionLayoutVariant ?? this.getCollectionLayoutVariant(),
    });

    const targetLeft = this.collectionBounds.left;
    const headerY = this.collectionBounds.bottom + ASSOCIATION_SHELF_TOP_GAP;
    const targetCardTop = headerY + ASSOCIATION_SHELF_TITLE_CARD_GAP;
    const shelfOffset = snapToDrawnGrid(
      targetLeft - contentBounds.left,
      targetCardTop - contentBounds.top,
    );
    const offsetX = shelfOffset.x;
    const offsetY = shelfOffset.y;
    const shiftedBounds: ContentBounds = {
      left: contentBounds.left + offsetX,
      top: contentBounds.top + offsetY,
      right: contentBounds.right + offsetX,
      bottom: contentBounds.bottom + offsetY,
    };

    const header = new Text({
      text: `${this.getAssociationShelfTitle()} (${entries.length})`,
      style: {
        fontFamily: "Arial",
        fontSize: Math.round(HEADER_HEIGHT * 0.34),
        fill: 0x7fb7ff,
        fontWeight: "bold",
      },
    });
    header.x = targetLeft;
    header.y = headerY;
    this.cardContainer.addChild(header);
    this.associationShelfHeaderLabels.push(header);

    const entryByName = new Map(entries.map((entry) => [entry.card.name, entry]));
    for (const cardLayout of layout) {
      const entry = entryByName.get(cardLayout.name);
      if (!entry) continue;

      const shiftedLayout: CardLayoutInfo = {
        ...cardLayout,
        position: {
          x: cardLayout.position.x + offsetX,
          y: cardLayout.position.y + offsetY,
        },
      };
      const cardSize = shiftedLayout.isLandscape
        ? CARD_SIZE.LANDSCAPE
        : CARD_SIZE.PORTRAIT;
      const centerX = shiftedLayout.position.x;
      const centerY = shiftedLayout.position.y;
      const topLeftX = centerX - cardSize.width / 2;
      const topLeftY = centerY - cardSize.height / 2;
      const gridPos = pixelsToSnapGrid(centerX, centerY, shiftedLayout.isLandscape);
      const key = this.getAssociationShelfSpriteKey(entry.key);

      const sprite = new CardSprite({
        name: shiftedLayout.name,
        isLandscape: shiftedLayout.isLandscape,
        x: centerX,
        y: centerY,
      });
      sprite.on("pointerover", () => this.setHoveredCard(shiftedLayout.name));
      sprite.on("pointerout", () => this.setHoveredCard(null));
      sprite.setSelected(this.selectedCards.has(key));

      this.associationShelfSprites.set(key, {
        sprite,
        bounds: {
          left: topLeftX,
          top: topLeftY,
          right: topLeftX + cardSize.width,
          bottom: topLeftY + cardSize.height,
        },
        layout: shiftedLayout,
        gridKey: `association:${gridPos.x},${gridPos.y}`,
        displaySize: { width: cardSize.width, height: cardSize.height },
        basePosition: { x: topLeftX, y: topLeftY },
      });

      this.cardContainer.addChild(sprite);
    }

    this.associationShelfBounds = {
      left: Math.min(shiftedBounds.left, header.x),
      top: Math.min(shiftedBounds.top, header.y),
      right: Math.max(shiftedBounds.right, header.x + header.width),
      bottom: Math.max(shiftedBounds.bottom, header.y + header.height),
    };

    if (rebuildDeck && this.activeDeck) {
      this.rebuildDeckSprites();
    } else {
      this.performCulling();
    }
  }

  private getAssociationShelfEntries(): AssociationShelfEntry[] {
    if (this.selectedCardCategoryId && this.cardCategoryData) {
      return getCategoryShelfCards(
        this.cardCategoryData,
        this.cards,
        this.selectedCardCategoryId,
      )
        .map((entry) => ({
          key: `category:${entry.card.name}`,
          card: entry.card,
          score: entry.score,
        }));
    }

    if (
      this.associationsEnabled &&
      this.deckStyleAssociations &&
      this.selectedAssociationStyleId
    ) {
      return getDeckStyleShelfCards(
        this.deckStyleAssociations,
        this.deckStyleAssociationMode,
        this.selectedAssociationStyleId,
        this.selectedAssociationSubStyleId,
        this.cards,
      )
        .map((entry) => ({
          key: `style:${entry.card.name}`,
          card: entry.card,
          score: entry.score,
        }));
    }

    return [];
  }

  private getLayoutCardInput(card: Card): {
    name: string;
    type: CardType;
    thresholdGroup: ThresholdGroup;
    cost: number | null;
    isLandscape: boolean;
    primarySet: string | undefined;
    rarity: Card["guardian"]["rarity"];
  } {
    return {
      name: card.name,
      type: card.guardian.type,
      thresholdGroup: getThresholdGroup(card.guardian.thresholds),
      cost: card.guardian.cost,
      isLandscape: card.guardian.type === "Site",
      primarySet: card.sets[0]?.name,
      rarity: card.guardian.rarity,
    };
  }

  private getAssociationShelfSpriteKey(key: string): string {
    return `association:${key}`;
  }

  private getDeckLayoutCollectionBottom(): number {
    return this.associationShelfSprites.size > 0
      ? Math.max(this.collectionBounds.bottom, this.associationShelfBounds.bottom)
      : this.collectionBounds.bottom;
  }

  private applyActiveMetricHighlighting(): void {
    if (this.selectedCardCategoryId && this.cardCategoryData) {
      this.applyCardCategoryHighlighting();
      return;
    }
    this.applyDeckStyleAssociationHighlighting();
  }

  private applyDeckStyleAssociationHighlighting(): void {
    const active =
      this.associationsEnabled &&
      !!this.deckStyleAssociations &&
      !!this.selectedAssociationStyleId;
    const applyToSprite = (cardName: string, sprite: CardSprite): void => {
      if (!active) {
        sprite.setMetricScore(null);
        return;
      }
      sprite.setMetricScore(
        getDeckStyleCardScore(
          this.deckStyleAssociations,
          this.deckStyleAssociationMode,
          this.selectedAssociationStyleId,
          this.selectedAssociationSubStyleId,
          cardName,
        ),
        { color: MANGA_PALETTE.gold },
      );
    };

    for (const [name, data] of this.cardSprites) {
      applyToSprite(name, data.sprite);
    }
    for (const [, data] of this.deckSprites) {
      data.sprite.setMetricScore(null);
    }
    for (const [, data] of this.associationShelfSprites) {
      applyToSprite(data.layout.name, data.sprite);
    }
    for (const [, data] of this.zoneCardSprites) {
      data.sprite.setMetricScore(null);
    }
  }

  private getAssociationShelfTitle(): string {
    if (this.selectedCardCategoryId && this.cardCategoryData) {
      return (
        this.cardCategoryData.categories.find(
          (category) => category.id === this.selectedCardCategoryId,
        )?.name ?? "Category cards"
      );
    }
    if (this.selectedAssociationStyleId && this.deckStyleAssociations) {
      const style = this.deckStyleAssociations.styles.find(
        (entry) => entry.id === this.selectedAssociationStyleId,
      );
      const subStyle = style?.subStyles.find(
        (entry) => entry.id === this.selectedAssociationSubStyleId,
      );
      if (style && subStyle) return `${style.name} / ${subStyle.name}`;
      if (style) return style.name;
      return "Deck style cards";
    }
    return "Cards";
  }

  private modifyCardCategoryScore(cardName: string, delta: number): void {
    if (!this.selectedCardCategoryId || !this.cardCategoryData) return;
    const current = getCategoryScore(
      this.cardCategoryData,
      cardName,
      this.selectedCardCategoryId,
    );
    const next = Math.max(0, Math.min(1, Math.round((current + delta) * 100) / 100));
    this.onCardCategoryScoreChange?.(cardName, this.selectedCardCategoryId, next);
    this.updateLocalCardCategoryScore(cardName, next);
  }

  private promptCardCategoryScore(cardName: string): void {
    if (!this.selectedCardCategoryId || !this.cardCategoryData) return;
    const current = getCategoryScore(
      this.cardCategoryData,
      cardName,
      this.selectedCardCategoryId,
    );
    const value = window.prompt("Card category value", formatCategoryScore(current));
    if (value === null) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const next = Math.max(0, Math.min(1, Math.round(parsed * 100) / 100));
    this.onCardCategoryScoreChange?.(cardName, this.selectedCardCategoryId, next);
    this.updateLocalCardCategoryScore(cardName, next);
  }

  private handleCardCategoryDoubleClick(
    cardName: string,
    bounds: { left: number; top: number; right: number; bottom: number } | undefined,
    worldPos: { x: number; y: number },
  ): void {
    if (!bounds) {
      this.modifyCardCategoryScore(cardName, 0.1);
      return;
    }

    const height = Math.max(1, bounds.bottom - bounds.top);
    const ratio = (worldPos.y - bounds.top) / height;
    if (ratio >= 0.38 && ratio <= 0.62) {
      this.promptCardCategoryScore(cardName);
      return;
    }

    this.modifyCardCategoryScore(cardName, ratio < 0.5 ? 0.1 : -0.1);
  }

  private updateLocalCardCategoryScore(cardName: string, score: number): void {
    if (!this.selectedCardCategoryId || !this.cardCategoryData) return;
    this.cardCategoryData = setCategoryScore(
      this.cardCategoryData,
      cardName,
      this.selectedCardCategoryId,
      score,
    );
    this.rebuildAssociationShelfSprites();
    this.applyCardCategoryHighlighting();
  }

  private clearZoneVisuals(): void {
    this.clearZoneDropPreview();
    this.destroyDeckGraphHoverTooltip();
    this.deactivateQuickTransfer();
    this.closeTouchActionSheet();
    for (const data of this.zoneCardSprites.values()) {
      data.sprite.destroy();
    }
    this.zoneCardSprites.clear();

    for (const frame of this.zoneFrames.values()) {
      frame.frame.destroy();
      frame.title.destroy();
      frame.avatarSprite?.destroy();
      for (const label of frame.subzoneLabels) {
        label.destroy();
      }
    }
    this.zoneFrames.clear();
    this.zoneHeaderBounds.clear();
    this.zoneContainer.removeChildren();
    this.hoveredZoneCardKey = null;
    this.drawZoneDeleteOverlay();
  }

  private getDeckBoardRects(
    bounds: CanvasArea["bounds"],
    zone: CanvasArea,
  ): Record<DeckZoneBoard, CanvasArea["bounds"]> {
    const rects = computeDeckBoardRects(bounds, zone.cards, this.getZoneHeaderHeight(zone),
      (name) => this.isLandscapeCard(name));
    for (const board of DECK_BOARD_ORDER) {
      for (const label of this.getPopulatedLabelBounds(zone, board)) {
        const rect = rects[board];
        const right = Math.max(rect.x + rect.width, label.x + label.width);
        const bottom = Math.max(rect.y + rect.height, label.y + label.height);
        rect.x = Math.min(rect.x, label.x);
        rect.y = Math.min(rect.y, label.y);
        rect.width = right - rect.x;
        rect.height = bottom - rect.y;
      }
    }
    return rects;
  }

  private fitDeckSections(zone: CanvasArea): boolean {
    const previous = { ...zone.bounds };
    fitDeckBoardSections(zone, this.getZoneHeaderHeight(zone),
      (name) => this.isLandscapeCard(name));
    this.fitLabelRegionBounds(zone);
    return previous.x !== zone.bounds.x || previous.y !== zone.bounds.y ||
      previous.width !== zone.bounds.width || previous.height !== zone.bounds.height;
  }

  private drawZoneFrame(
    zone: CanvasArea,
    zoneIndex: number,
  ): {
    frame: Graphics;
    title: Text;
    subzoneLabels: Container[];
    avatarSprite: CardSprite | null;
  } {
    const frame = new Graphics();
    const headerHeight = this.getZoneHeaderHeight(zone);
    const closeButtonSize = Math.max(20, Math.min(32, headerHeight - 16));
    const buttonMargin = 6;
    const buttonTop = zone.bounds.y + buttonMargin;
    const headerBottom = zone.bounds.y + headerHeight;
    const closeButtonRight = zone.bounds.x + zone.bounds.width - buttonMargin;
    frame.zIndex = 2000 + zoneIndex * 1000;
    frame.rect(zone.bounds.x, zone.bounds.y, zone.bounds.width, zone.bounds.height);
    frame.fill({ color: MANGA_PALETTE.ink, alpha: 0.88 });
    frame.stroke({ width: 2, color: MANGA_PALETTE.line, alpha: 0.92 });

    frame.rect(zone.bounds.x, zone.bounds.y, zone.bounds.width, headerHeight);
    frame.fill({ color: MANGA_PALETTE.raised, alpha: 0.96 });
    frame.stroke({ width: 1, color: MANGA_PALETTE.line, alpha: 0.88 });

    const closeBounds = {
      left: closeButtonRight - closeButtonSize,
      top: buttonTop,
      right: closeButtonRight,
      bottom: buttonTop + closeButtonSize,
    };
    const sortLeft = zone.bounds.x + buttonMargin;
    const sortButtonWidth = zone.type === 'deck' ? 92 : ZONE_SORT_BUTTON_WIDTH;
    const sortBounds = {
      right: sortLeft + sortButtonWidth,
      bottom: headerBottom,
      left: sortLeft,
      top: headerBottom - ZONE_SORT_BUTTON_HEIGHT,
    };
    frame.roundRect(
      sortBounds.left,
      sortBounds.top,
      sortButtonWidth,
      ZONE_SORT_BUTTON_HEIGHT,
      6,
    );
    frame.fill({ color: MANGA_PALETTE.raised, alpha: 0.94 });
    frame.stroke({ width: 1, color: MANGA_PALETTE.line, alpha: 0.85 });

    const sortGlyph = this.configureTextQuality(new Text({
      text: zone.type === 'deck' ? "Reset layout" : "sort",
      style: {
        fontFamily: "Arial",
        fontSize: 11,
        fill: MANGA_PALETTE.paper,
        fontWeight: "bold",
      },
    }));
    sortGlyph.x =
      sortBounds.left + (sortButtonWidth - sortGlyph.width) / 2;
    sortGlyph.y =
      sortBounds.top + (ZONE_SORT_BUTTON_HEIGHT - sortGlyph.height) / 2 - 1;
    sortGlyph.zIndex = frame.zIndex + 2;
    const subzoneLabels: Container[] = [sortGlyph];

    let filterBounds: ZoneHeaderData["filterBounds"] = null;
    const filterChipBounds: ZoneHeaderData["filterChipBounds"] = [];
    let filterGlyph: Text | null = null;
    if (zone.type === "deck") {
      const filterLeft = sortBounds.right + 4;
      filterBounds = {
        left: filterLeft,
        top: headerBottom - ZONE_FILTER_BUTTON_HEIGHT,
        right: filterLeft + ZONE_FILTER_BUTTON_WIDTH,
        bottom: headerBottom,
      };

      frame.roundRect(
        filterBounds.left,
        filterBounds.top,
        ZONE_FILTER_BUTTON_WIDTH,
        ZONE_FILTER_BUTTON_HEIGHT,
        6,
      );
      frame.fill({ color: MANGA_PALETTE.raised, alpha: 0.94 });
      frame.stroke({ width: 1, color: MANGA_PALETTE.line, alpha: 0.85 });

      filterGlyph = this.configureTextQuality(new Text({
        text: "filter",
        style: {
          fontFamily: "Arial",
          fontSize: 10,
          fill: MANGA_PALETTE.paper,
          fontWeight: "bold",
        },
      }));
      filterGlyph.x =
        filterBounds.left + (ZONE_FILTER_BUTTON_WIDTH - filterGlyph.width) / 2;
      filterGlyph.y =
        filterBounds.top + (ZONE_FILTER_BUTTON_HEIGHT - filterGlyph.height) / 2 - 1;
      filterGlyph.zIndex = frame.zIndex + 2;

      const deckFilters = ensureCardFilterState(zone.cardFilters);
      const filterChips = deckFilters.clauses
        .map((clause, index) => ({ clause, index }))
        .filter(
          ({ clause }) =>
            clause.enabled && !isCardFilterCriteriaEmpty(clause.criteria),
        );
      const maxChipRight = closeBounds.left - buttonMargin;
      let chipLeft = filterBounds.right + ZONE_FILTER_CHIP_GAP;
      for (const { clause, index } of filterChips) {
        if (chipLeft >= maxChipRight) break;
        const chipLabel = describeFilterButton(clause.criteria);
        const removeHovered =
          this.hoveredDeckFilterChip?.zoneId === zone.id &&
          this.hoveredDeckFilterChip.clauseIndex === index &&
          this.hoveredDeckFilterChip.removeHovered;
        const chipHovered =
          removeHovered ||
          (this.hoveredDeckFilterChip?.zoneId === zone.id &&
            this.hoveredDeckFilterChip.clauseIndex === index);
        const labelText = this.configureTextQuality(new Text({
          text: chipLabel,
          style: {
            fontFamily: "Arial",
            fontSize: 10,
            fill: MANGA_PALETTE.paper,
            fontWeight: "bold",
          },
        }));
        const removePad = chipHovered ? ZONE_FILTER_CHIP_REMOVE_SIZE + 4 : 0;
        const chipWidth = Math.min(
          150,
          labelText.width + ZONE_FILTER_CHIP_PADDING_X * 2 + removePad,
        );
        if (chipLeft + chipWidth > maxChipRight) {
          labelText.destroy();
          break;
        }

        const chipTop = headerBottom - ZONE_FILTER_CHIP_HEIGHT;
        frame.roundRect(chipLeft, chipTop, chipWidth, ZONE_FILTER_CHIP_HEIGHT, 5);
        frame.fill({
          color: chipHovered ? MANGA_PALETTE.active : MANGA_PALETTE.raised,
          alpha: clause.enabled ? 0.94 : 0.65,
        });
        frame.stroke({
          width: 1,
          color: chipHovered ? MANGA_PALETTE.paper : MANGA_PALETTE.line,
          alpha: 0.85,
        });

        labelText.x = chipLeft + ZONE_FILTER_CHIP_PADDING_X;
        labelText.y = chipTop + (ZONE_FILTER_CHIP_HEIGHT - labelText.height) / 2 - 0.5;
        labelText.zIndex = frame.zIndex + 2;
        this.zoneContainer.addChild(labelText);

        const chipBounds = {
          left: chipLeft,
          top: chipTop,
          right: chipLeft + chipWidth,
          bottom: chipTop + ZONE_FILTER_CHIP_HEIGHT,
        };
        let removeBounds: {
          left: number;
          top: number;
          right: number;
          bottom: number;
        } | null = null;

        if (chipHovered) {
          const removeSize = ZONE_FILTER_CHIP_REMOVE_SIZE;
          const removeX = chipBounds.right - removeSize - 3;
          const removeY = chipTop + (ZONE_FILTER_CHIP_HEIGHT - removeSize) / 2;
          frame.roundRect(removeX, removeY, removeSize, removeSize, 4);
          frame.fill({
            color: removeHovered ? 0x6b3038 : 0x4b4f78,
            alpha: 0.95,
          });
          frame.stroke({
            width: 1,
            color: removeHovered ? 0xffb4bf : 0xc0caf7,
            alpha: 0.92,
          });
          frame.moveTo(removeX + 3, removeY + 3);
          frame.lineTo(removeX + removeSize - 3, removeY + removeSize - 3);
          frame.moveTo(removeX + removeSize - 3, removeY + 3);
          frame.lineTo(removeX + 3, removeY + removeSize - 3);
          frame.stroke({ width: 1.2, color: 0xf8fbff, alpha: 0.92 });
          removeBounds = {
            left: removeX,
            top: removeY,
            right: removeX + removeSize,
            bottom: removeY + removeSize,
          };
        }

        filterChipBounds.push({
          clauseIndex: index,
          bounds: chipBounds,
          removeBounds,
        });
        subzoneLabels.push(labelText);
        chipLeft += chipWidth + ZONE_FILTER_CHIP_GAP;
      }
    }

    frame.roundRect(
      closeBounds.left,
      closeBounds.top,
      closeButtonSize,
      closeButtonSize,
      6,
    );
    frame.fill({ color: MANGA_PALETTE.raised, alpha: 0.94 });
    frame.stroke({ width: 1, color: MANGA_PALETTE.line, alpha: 0.85 });
    frame.moveTo(closeBounds.left + 5, closeBounds.top + 5);
    frame.lineTo(closeBounds.right - 5, closeBounds.bottom - 5);
    frame.moveTo(closeBounds.right - 5, closeBounds.top + 5);
    frame.lineTo(closeBounds.left + 5, closeBounds.bottom - 5);
    frame.stroke({ width: 1.6, color: 0xf0f3ff, alpha: 0.9 });

    const variantTabBounds: ZoneHeaderData["variantTabBounds"] = [];
    const graphHoverRegions: ZoneHeaderData["graphHoverRegions"] = [];
    if (filterGlyph) {
      subzoneLabels.push(filterGlyph);
    }
    if (zone.type === "deck") {
      const boardRects = this.getDeckBoardRects(zone.bounds, zone);

      frame.rect(
        boardRects.mainboard.x,
        boardRects.mainboard.y,
        boardRects.mainboard.width,
        boardRects.mainboard.height,
      );
      frame.stroke({ width: 1, color: MANGA_PALETTE.line, alpha: 0.56 });
      const mainSections = getMainDeckSectionRects(zone.cards, name => this.isLandscapeCard(name));
      for (const [key, name] of [['spellbook', 'Spellbook'], ['atlas', 'Atlas']] as const) {
        const rect = mainSections[key];
        if (!rect) continue;
        frame.roundRect(rect.x, rect.y, rect.width, rect.height, 8);
        frame.stroke({ width: 1, color: MANGA_PALETTE.line, alpha: 0.4 });
        const sectionLabel = this.configureTextQuality(new Text({ text: name,
          style: { fontFamily: 'Arial', fontSize: 12, fill: MANGA_PALETTE.muted, fontWeight: 'bold' } }));
        sectionLabel.position.set(rect.x + 8, rect.y + 4);
        sectionLabel.zIndex = frame.zIndex + 2;
        this.zoneContainer.addChild(sectionLabel);
        subzoneLabels.push(sectionLabel);
      }
      for (const [board, label] of [['mainboard', 'Main'], ['collection', 'Collection'], ['maybeboard', 'Maybe']] as const) {
        const rect = boardRects[board];
        frame.rect(rect.x, rect.y, rect.width, rect.height);
        frame.stroke({ width: 1, color: MANGA_PALETTE.line, alpha: 0.56 });

        const boardLabel = this.configureTextQuality(new Text({
          text: label,
          style: {
            fontFamily: "Arial",
            fontSize: 13,
            fill: MANGA_PALETTE.muted,
            fontWeight: "bold",
          },
        }));
        boardLabel.x = rect.x + 8;
        boardLabel.y = rect.y + 6;
        boardLabel.zIndex = frame.zIndex + 2;
        this.zoneContainer.addChild(boardLabel);
        subzoneLabels.push(boardLabel);
      }
    }

    let avatarSprite: CardSprite | null = null;
    let titleX =
      zone.type === "deck"
        ? zone.bounds.x + 10 + ZONE_DECK_HEADER_X_OFFSET
        : zone.bounds.x + 10;
    let deckHeaderTopY: number | null = null;
    if (zone.type === "deck" && zone.avatarCardName) {
      const avatarHeight = CARD_SIZE.PORTRAIT.height;
      const avatarWidth = CARD_SIZE.PORTRAIT.width;
      const avatarCenterX =
        zone.bounds.x +
        ZONE_DECK_AVATAR_CENTER_GRID_X * DRAWN_GRID.width +
        ZONE_DECK_HEADER_X_OFFSET;
      const avatarCenterY =
        zone.bounds.y + ZONE_DECK_AVATAR_CENTER_GRID_Y * DRAWN_GRID.height;
      const avatarLeft = avatarCenterX - avatarWidth / 2;
      const avatarTop = avatarCenterY - avatarHeight / 2;
      avatarSprite = new CardSprite({
        name: zone.avatarCardName,
        isLandscape: false,
        x: avatarCenterX,
        y: avatarCenterY,
        displaySize: { width: avatarWidth, height: avatarHeight },
      });
      avatarSprite.zIndex = frame.zIndex + 2;
      this.zoneContainer.addChild(avatarSprite);
      titleX = avatarLeft + avatarWidth + ZONE_DECK_AVATAR_TITLE_GAP;
      deckHeaderTopY = avatarTop;
    }

    const titleText = this.getZoneDisplayName(zone);
    const title = this.configureTextQuality(new Text({
      text: titleText,
      style: {
        fontFamily: "Arial",
        fontSize: HEADER_HEIGHT * 0.3,
        fill: zone.type === "deck" ? MANGA_PALETTE.paper : zone.type === "stack" ? MANGA_PALETTE.paper : 0xf1d6a0,
        fontWeight: "bold",
      },
    }));
    title.x = titleX;
    let titleBottomY = title.y + title.height;
    if (zone.type === "deck" && zone.deckAuthor) {
      title.y = deckHeaderTopY ?? zone.bounds.y + 8;
      const author = this.configureTextQuality(new Text({
        text: this.formatDeckAuthorLabel(zone.deckAuthor),
        style: {
          fontFamily: "Arial",
          fontSize: 12,
          fill: MANGA_PALETTE.muted,
          fontWeight: "normal",
        },
      }));
      author.x = titleX;
      author.y = title.y + title.height + 2;
      author.zIndex = frame.zIndex + 2;
      this.zoneContainer.addChild(author);
      subzoneLabels.push(author);
      titleBottomY = author.y + author.height;
    } else if (zone.type === "deck" && deckHeaderTopY !== null) {
      title.y = deckHeaderTopY;
    } else {
      title.y = zone.bounds.y + Math.max(4, (headerHeight - title.height) / 2);
    }
    if (!(zone.type === "deck" && zone.deckAuthor)) {
      titleBottomY = title.y + title.height;
    }
    title.zIndex = frame.zIndex + 2;

    if (zone.type === "deck") {
      const variants = this.ensureDeckZoneVariants(zone);
      const activeVariant = this.getActiveDeckZoneVariant(zone);
      const tabTop = zone.bounds.y + headerHeight - ZONE_DECK_TAB_HEIGHT;
      const headerToolRight = filterBounds ? filterBounds.right : sortBounds.right;
      const filterChipRight =
        filterChipBounds.at(-1)?.bounds.right ?? 0;
      const tabStartX = Math.max(headerToolRight, filterChipRight);
      let tabCursorX = Math.max(titleX, tabStartX + ZONE_DECK_TAB_GAP);
      const maxTabRight = closeBounds.left - buttonMargin;
      graphHoverRegions.push(
        ...this.renderDeckHeaderStats(zone, subzoneLabels, {
        left: Math.max(titleX, headerToolRight + ZONE_DECK_TAB_GAP),
        top: titleBottomY + 3,
        graphTop: zone.bounds.y + 8,
        right: maxTabRight,
        bottom: tabTop - 2,
        zIndex: frame.zIndex + 2,
      }),
      );

      const fitTabLabel = (text: Text, maxWidth: number): void => {
        if (maxWidth <= 0) {
          text.text = "";
          return;
        }
        while (text.width > maxWidth && text.text.length > 4) {
          text.text = `${text.text.slice(0, -4).trimEnd()}...`;
        }
      };

      let renderedVariantCount = 0;
      for (const variant of variants) {
        const tabText = this.configureTextQuality(new Text({
          text: variant.name,
          style: {
            fontFamily: "Arial",
            fontSize: 12,
            fill: activeVariant?.id === variant.id ? MANGA_PALETTE.paper : MANGA_PALETTE.muted,
            fontWeight: activeVariant?.id === variant.id ? "bold" : "normal",
          },
        }));
        const remainingWidth = maxTabRight - tabCursorX;
        if (remainingWidth < 42) {
          tabText.destroy();
          break;
        }
        const targetWidth = Math.max(
          54,
          Math.min(remainingWidth, tabText.width + ZONE_DECK_TAB_PADDING_X * 2),
        );
        fitTabLabel(tabText, targetWidth - ZONE_DECK_TAB_PADDING_X * 2);
        const tabWidth = Math.max(
          42,
          Math.min(remainingWidth, tabText.width + ZONE_DECK_TAB_PADDING_X * 2),
        );

        frame.roundRect(tabCursorX, tabTop, tabWidth, ZONE_DECK_TAB_HEIGHT, 6);
        frame.fill({
          color: activeVariant?.id === variant.id ? MANGA_PALETTE.active : MANGA_PALETTE.raised,
          alpha: activeVariant?.id === variant.id ? 0.96 : 0.9,
        });
        frame.stroke({
          width: 1,
          color: activeVariant?.id === variant.id ? MANGA_PALETTE.gold : MANGA_PALETTE.line,
          alpha: activeVariant?.id === variant.id ? 0.95 : 0.75,
        });

        tabText.x = tabCursorX + (tabWidth - tabText.width) / 2;
        tabText.y = tabTop + (ZONE_DECK_TAB_HEIGHT - tabText.height) / 2;
        tabText.zIndex = frame.zIndex + 2;
        this.zoneContainer.addChild(tabText);
        subzoneLabels.push(tabText);
        variantTabBounds.push({
          variantId: variant.id,
          isAdd: false,
          bounds: {
            left: tabCursorX,
            top: tabTop,
            right: tabCursorX + tabWidth,
            bottom: tabTop + ZONE_DECK_TAB_HEIGHT,
          },
        });
        renderedVariantCount += 1;
        tabCursorX += tabWidth + ZONE_DECK_TAB_GAP;
      }

      if (renderedVariantCount === 0 && activeVariant) {
        const availableWidth = maxTabRight - tabCursorX;
        if (availableWidth >= 42) {
          const tabWidth = Math.min(88, availableWidth);
          const fallbackText = this.configureTextQuality(new Text({
            text: activeVariant.name,
            style: {
              fontFamily: "Arial",
              fontSize: 12,
              fill: MANGA_PALETTE.paper,
              fontWeight: "bold",
            },
          }));
          fitTabLabel(fallbackText, tabWidth - ZONE_DECK_TAB_PADDING_X * 2);

          frame.roundRect(tabCursorX, tabTop, tabWidth, ZONE_DECK_TAB_HEIGHT, 6);
          frame.fill({ color: MANGA_PALETTE.active, alpha: 0.96 });
          frame.stroke({ width: 1, color: MANGA_PALETTE.gold, alpha: 0.95 });

          fallbackText.x = tabCursorX + (tabWidth - fallbackText.width) / 2;
          fallbackText.y = tabTop + (ZONE_DECK_TAB_HEIGHT - fallbackText.height) / 2;
          fallbackText.zIndex = frame.zIndex + 2;
          this.zoneContainer.addChild(fallbackText);
          subzoneLabels.push(fallbackText);
          variantTabBounds.push({
            variantId: activeVariant.id,
            isAdd: false,
            bounds: {
              left: tabCursorX,
              top: tabTop,
              right: tabCursorX + tabWidth,
              bottom: tabTop + ZONE_DECK_TAB_HEIGHT,
            },
          });
          tabCursorX += tabWidth + ZONE_DECK_TAB_GAP;
        }
      }

      if (tabCursorX + ZONE_DECK_ADD_TAB_WIDTH <= maxTabRight) {
        frame.roundRect(
          tabCursorX,
          tabTop,
          ZONE_DECK_ADD_TAB_WIDTH,
          ZONE_DECK_TAB_HEIGHT,
          6,
        );
        frame.fill({ color: MANGA_PALETTE.raised, alpha: 0.9 });
        frame.stroke({ width: 1, color: MANGA_PALETTE.line, alpha: 0.8 });

        const addText = this.configureTextQuality(new Text({
          text: "+",
          style: {
            fontFamily: "Arial",
            fontSize: 16,
            fill: MANGA_PALETTE.paper,
            fontWeight: "bold",
          },
        }));
        addText.x = tabCursorX + (ZONE_DECK_ADD_TAB_WIDTH - addText.width) / 2;
        addText.y = tabTop + (ZONE_DECK_TAB_HEIGHT - addText.height) / 2 - 1;
        addText.zIndex = frame.zIndex + 2;
        this.zoneContainer.addChild(addText);
        subzoneLabels.push(addText);
        variantTabBounds.push({
          variantId: "",
          isAdd: true,
          bounds: {
            left: tabCursorX,
            top: tabTop,
            right: tabCursorX + ZONE_DECK_ADD_TAB_WIDTH,
            bottom: tabTop + ZONE_DECK_TAB_HEIGHT,
          },
        });
      }
    }

    this.zoneContainer.addChild(frame);
    this.zoneContainer.addChild(sortGlyph);
    if (filterGlyph) {
      this.zoneContainer.addChild(filterGlyph);
    }
    this.zoneContainer.addChild(title);
    this.zoneHeaderBounds.set(zone.id, {
      bounds: {
        left: zone.bounds.x,
        top: zone.bounds.y,
        right: zone.bounds.x + zone.bounds.width,
        bottom: zone.bounds.y + headerHeight,
      },
      closeBounds,
      sortBounds,
      filterBounds,
      filterChipBounds,
      variantTabBounds,
      graphHoverRegions,
    });

    return { frame, title, subzoneLabels, avatarSprite };
  }

  private rebuildZoneVisuals(): void {
    this.clearZoneVisuals();
    if (!this.camera) return;

    let layoutChanged = false;
    if (this.cards.length > 0) {
      for (const zone of this.canvasAreas) {
        if (this.fitDeckSections(zone)) layoutChanged = true;
      }
    }
    const filteredDeckCardNameCache = new Map<string, Set<string>>();
    const pinnedZones = this.canvasAreas.filter((zone) => zone.pinned);
    pinnedZones.forEach((zone, zoneIndex) => {
      const frameData = this.drawZoneFrame(zone, zoneIndex);
      this.zoneFrames.set(zone.id, frameData);
      const activeDeckCardIds =
        zone.type === "deck"
          ? new Set(this.getActiveDeckZoneVariant(zone)?.activeCardIds ?? [])
          : null;
      const visibleZoneCards =
        zone.type === "deck"
          ? this.getVisibleDeckZoneCards(zone, filteredDeckCardNameCache)
          : zone.cards;

      const stacks = new Map<string, CanvasCardInstance[]>();
      for (const instance of visibleZoneCards) {
        const isLandscape = this.isLandscapeCard(instance.cardName);
        const size = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
        const centerX = instance.x + size.width / 2;
        const centerY = instance.y + size.height / 2;
        const grid = pixelsToSnapGrid(centerX, centerY, isLandscape);
        const boardKey =
          zone.type === "deck"
            ? this.normalizeDeckBoard(instance.board)
            : instance.board ?? "zone";
        const stackKey = `${boardKey}:${
          isLandscape ? "L" : "P"
        }:${grid.x},${grid.y}`;
        let stack = stacks.get(stackKey);
        if (!stack) {
          stack = [];
          stacks.set(stackKey, stack);
        }
        stack.push(instance);
      }

      let instanceIndex = 0;
      for (const stack of stacks.values()) {
        if (zone.type === "deck" && activeDeckCardIds) {
          stack.sort((left, right) => {
            const leftActive = activeDeckCardIds.has(left.id);
            const rightActive = activeDeckCardIds.has(right.id);
            if (leftActive === rightActive) return 0;
            return leftActive ? 1 : -1;
          });
        }

        const stackSize = stack.length;
        const totalOffset = (stackSize - 1) * STACK_OFFSET;
        stack.forEach((instance, stackIndex) => {
          const key = `${zone.id}:${instance.id}`;
          const isLandscape = this.isLandscapeCard(instance.cardName);
          const cardSize = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
          const indexOffset = stackIndex * STACK_OFFSET - totalOffset / 2;
          const yOffset = isLandscape ? -indexOffset : indexOffset;
          const drawX = instance.x;
          const drawY = instance.y + yOffset;
          const centerX = drawX + cardSize.width / 2;
          const centerY = drawY + cardSize.height / 2;
          const sprite = new CardSprite({
            name: instance.cardName,
            isLandscape,
            x: centerX,
            y: centerY,
          });
          sprite.setNewlyAdded(instance.isNew === true);
          sprite.setSelected(this.selectedZoneCardKeys.has(key));
          sprite.zIndex = frameData.frame.zIndex + 10 + instanceIndex;
          if (zone.type === "deck" && activeDeckCardIds && !activeDeckCardIds.has(instance.id)) {
            sprite.alpha = 0.46;
          }

          this.zoneContainer.addChild(sprite);

          this.zoneCardSprites.set(key, {
            key,
            zoneId: zone.id,
            instanceId: instance.id,
            cardName: instance.cardName,
            cardType: this.getCardType(instance.cardName),
            sprite,
            bounds: {
              left: drawX,
              top: drawY,
              right: drawX + cardSize.width,
              bottom: drawY + cardSize.height,
            },
            displaySize: { width: cardSize.width, height: cardSize.height },
          });
          instanceIndex += 1;
        });
      }
    });

    this.zoneContainer.sortChildren();
    this.updateCanvasAreaCardVisibility(this.expandBounds(
      this.camera.getVisibleBounds(), CULLING_MARGIN, CULLING_MARGIN,
    ));
    this.queueVisibleHighDetailPreload();
    this.syncZoneSelectionVisuals();
    this.applyActiveMetricHighlighting();
    this.drawZoneDeleteOverlay();
    this.rebuildLabelSprites();
    if (layoutChanged) this.emitCanvasAreasChange();
  }

  private rebuildCardSprites(rebuildDecks = true): void {
    const viewport = this.camera?.getVisibleBounds();
    const keepDeckInView = !rebuildDecks && viewport && this.canvasAreas.some(area => area.pinned && this.boundsIntersect(viewport, {
      left: area.bounds.x, top: area.bounds.y, right: area.bounds.x + area.bounds.width, bottom: area.bounds.y + area.bounds.height,
    }));
    this.setHoveredCard(null);

    for (const data of this.cardSprites.values()) {
      data.sprite.destroy();
    }
    for (const label of this.headerLabels) {
      label.destroy();
    }
    this.clearAssociationShelfSprites();
    this.destroyAssociationTooltip();
    this.headerLabels = [];
    this.cardSprites.clear();
    this.cardContainer.removeChildren();
    this.visibleCardNames.clear();
    if (rebuildDecks) this.clearSelection();
    else this.clearMainSelection();
    this.cardStacks.clear();

    if (this.cards.length === 0) {
      if (rebuildDecks) this.rebuildZoneVisuals();
      return;
    }

    const layoutCards = this.catalogueCards.map((card) => ({
      name: card.name,
      type: card.guardian.type,
      thresholdGroup: getThresholdGroup(card.guardian.thresholds),
      cost: card.guardian.cost,
      isLandscape: card.guardian.type === "Site",
      primarySet: card.sets[0]?.name,
      rarity: card.guardian.rarity,
    }));
    const layoutVariant = this.getCollectionLayoutVariant();
    this.collectionLayoutVariant = layoutVariant;

    const {
      cards: layout,
      headers,
      bounds: contentBounds,
    } = calculateCardLayout({
      cards: layoutCards,
      catalogueLayout: this.catalogueLayout,
      layoutVariant,
    });

    const mainQuadrant = QUADRANT_BOUNDS.main;
    const targetLeft = mainQuadrant.x + MAIN_QUADRANT_CARD_PADDING;
    const targetBottom =
      mainQuadrant.y + mainQuadrant.height - MAIN_QUADRANT_CARD_PADDING;
    const collectionOffset = snapToDrawnGrid(
      targetLeft - contentBounds.left,
      targetBottom - contentBounds.bottom,
    );
    const offsetX = collectionOffset.x;
    const offsetY = collectionOffset.y;
    const shiftedLayout = layout.map((entry) => ({
      ...entry,
      position: {
        x: entry.position.x + offsetX,
        y: entry.position.y + offsetY,
      },
    }));
    const shiftedHeaders = headers.map((header) => ({
      ...header,
      position: {
        x: header.position.x + offsetX,
        y: header.position.y + offsetY,
      },
    }));
    const shiftedBounds = {
      left: contentBounds.left + offsetX,
      top: contentBounds.top + offsetY,
      right: contentBounds.right + offsetX,
      bottom: contentBounds.bottom + offsetY,
    };

    // Store collection bounds for deck layout positioning
    this.collectionBounds = shiftedBounds;

    // Move camera to content area before creating sprites
    if (shiftedLayout.length > 0 && this.camera && !keepDeckInView) {
      this.camera.fitToContent(shiftedBounds, 100);
    }

    // Create group header labels
    const subgroupFontSize = HEADER_HEIGHT * 0.3;
    for (const header of shiftedHeaders) {
      const isTypeSubgroup = header.kind === "type-subgroup";
      const text = new Text({
        text: header.label,
        style: {
          fontFamily: "Arial",
          fontSize: header.fontSize ?? (isTypeSubgroup ? subgroupFontSize : HEADER_HEIGHT),
          fill: 0x888888,
          fontWeight: isTypeSubgroup ? "normal" : "bold",
        },
      });
      text.x = header.position.x;
      text.y = header.position.y;
      this.cardContainer.addChild(text);
      this.headerLabels.push(text);
    }

    // Shuffle layout BEFORE sprite creation to remove Map insertion bias
    const shuffledLayout = [...shiftedLayout];
    for (let i = shuffledLayout.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = shuffledLayout[i];
      const b = shuffledLayout[j];
      if (a && b) {
        shuffledLayout[i] = b;
        shuffledLayout[j] = a;
      }
    }

    // Create sprites in randomized order
    for (const cardLayout of shuffledLayout) {
      const cardSize = cardLayout.isLandscape
        ? CARD_SIZE.LANDSCAPE
        : CARD_SIZE.PORTRAIT;
      const isLandscape = cardLayout.isLandscape;

      const centerX = cardLayout.position.x;
      const centerY = cardLayout.position.y;

      const sprite = new CardSprite({
        name: cardLayout.name,
        isLandscape: cardLayout.isLandscape,
        x: centerX,
        y: centerY,
      });
      sprite.on("pointerover", () => this.setHoveredCard(cardLayout.name));
      sprite.on("pointerout", () => this.setHoveredCard(null));

      const topLeftX = centerX - cardSize.width / 2;
      const topLeftY = centerY - cardSize.height / 2;

      const gridPos = pixelsToSnapGrid(centerX, centerY, isLandscape);
      const gridKey = `${isLandscape ? "L" : "P"}:${gridPos.x},${gridPos.y}`;

      const spriteData: CardSpriteData = {
        sprite,
        bounds: {
          left: topLeftX,
          top: topLeftY,
          right: topLeftX + cardSize.width,
          bottom: topLeftY + cardSize.height,
        },
        layout: cardLayout,
        gridKey,
        displaySize: { width: cardSize.width, height: cardSize.height },
        basePosition: { x: topLeftX, y: topLeftY },
      };

      this.cardSprites.set(cardLayout.name, spriteData);
      this.cardContainer.addChild(sprite);
    }

    this.rebuildCardStacks();
    this.performCulling();
    this.drawGrid();
    if (rebuildDecks) this.rebuildZoneVisuals();
    this.rebuildAssociationShelfSprites(false);

    // Rebuild deck display if a deck is active
    if (rebuildDecks && this.activeDeck) {
      this.rebuildDeckSprites();
    }
    this.applyActiveMetricHighlighting();
  }

  private rebuildDeckSprites(): void {
    this.setHoveredCard(null);

    // Clean up old deck sprites
    for (const data of this.deckSprites.values()) {
      data.sprite.destroy();
    }
    for (const label of this.deckHeaderLabels) {
      label.destroy();
    }
    this.deckSprites.clear();
    this.deckHeaderLabels = [];

    if (!this.activeDeck || this.cards.length === 0) return;

    // Build card lookup from loaded card database
    const cardLookup = new Map<
      string,
      {
        type: import("@/data/dataModels").CardType;
        cost: number;
        isLandscape: boolean;
        thresholdGroup: import("@/data/dataModels").ThresholdGroup;
      }
    >();
    for (const card of this.cards) {
      cardLookup.set(card.name, {
        type: card.guardian.type,
        cost: card.guardian.cost ?? 0,
        isLandscape: card.guardian.type === "Site",
        thresholdGroup: getThresholdGroup(card.guardian.thresholds),
      });
    }

    const {
      cards: deckLayout,
      headers,
      bounds: newDeckBounds,
    } = calculateDeckLayout({
      deck: this.activeDeck,
      cardLookup,
      collectionBottom: this.getDeckLayoutCollectionBottom(),
    });

    this.deckBounds = newDeckBounds;

    // Create deck header labels with kind-specific sizing
    const deckSmallFontSize = HEADER_HEIGHT * 0.3;
    for (const header of headers) {
      const isDeckName = header.kind === "deck-name";
      const isBoard = header.kind === "deck-board";
      const isAuthor = header.kind === "deck-author";
      const fontSize = isDeckName ? HEADER_HEIGHT : deckSmallFontSize;
      const fill = isAuthor ? 0x666666 : 0x888888;
      const fontWeight = isDeckName || isBoard ? "bold" : "normal";

      const text = new Text({
        text: header.label,
        style: {
          fontFamily: "Arial",
          fontSize,
          fill,
          fontWeight,
        },
      });
      text.x = header.position.x;
      text.y = header.position.y;
      this.cardContainer.addChild(text);
      this.deckHeaderLabels.push(text);
    }

    // Create deck card sprites - one per copy for stacking
    for (const cardLayout of deckLayout) {
      const defaultCardSize = cardLayout.isLandscape
        ? CARD_SIZE.LANDSCAPE
        : CARD_SIZE.PORTRAIT;
      const cardSize =
        cardLayout.board === "avatar" ? DECK_AVATAR_SIZE : defaultCardSize;
      const centerX = cardLayout.position.x;
      const centerY = cardLayout.position.y;
      const topLeftX = centerX - cardSize.width / 2;
      const topLeftY = centerY - cardSize.height / 2;
      const gridPos = pixelsToSnapGrid(
        centerX,
        centerY,
        cardLayout.isLandscape,
      );
      const gridKey = `deck:${cardLayout.board}:${gridPos.x},${gridPos.y}`;

      for (let copy = 0; copy < cardLayout.quantity; copy++) {
        const sprite = new CardSprite({
          name: cardLayout.name,
          isLandscape: cardLayout.isLandscape,
          x: centerX,
          y: centerY,
          displaySize: cardSize,
        });
        sprite.on("pointerover", () => this.setHoveredCard(cardLayout.name));
        sprite.on("pointerout", () => this.setHoveredCard(null));

        const key = `${cardLayout.board}:${cardLayout.name}:${copy}`;

        this.deckSprites.set(key, {
          sprite,
          bounds: {
            left: topLeftX,
            top: topLeftY,
            right: topLeftX + cardSize.width,
            bottom: topLeftY + cardSize.height,
          },
          layout: cardLayout,
          gridKey,
          displaySize: { width: cardSize.width, height: cardSize.height },
          basePosition: { x: topLeftX, y: topLeftY },
        });

        this.cardContainer.addChild(sprite);
      }
    }

    // Apply stack offsets for deck cards at the same grid position
    const deckStacks = new Map<string, string[]>();
    for (const [key, data] of this.deckSprites) {
      let stack = deckStacks.get(data.gridKey);
      if (!stack) {
        stack = [];
        deckStacks.set(data.gridKey, stack);
      }
      stack.push(key);
    }

    for (const keys of deckStacks.values()) {
      if (keys.length <= 1) continue;
      const totalOffset = (keys.length - 1) * STACK_OFFSET;

      for (const [i, key] of keys.entries()) {
        const data = this.deckSprites.get(key);
        if (!data) continue;

        const isSite = data.layout.isLandscape;
        const indexOffset = i * STACK_OFFSET - totalOffset / 2;
        const yOffset = isSite ? -indexOffset : indexOffset;

        data.sprite.x = data.basePosition.x;
        data.sprite.y = data.basePosition.y + yOffset;
        data.sprite.zIndex = i;

        const cardSize = data.displaySize;
        data.bounds = {
          left: data.sprite.x,
          top: data.sprite.y,
          right: data.sprite.x + cardSize.width,
          bottom: data.sprite.y + cardSize.height,
        };
      }
    }

    // Load textures for deck sprites (they don't participate in the reveal animation)
    for (const data of this.deckSprites.values()) {
      data.sprite.loadInitialTexture();
    }

    this.applyActiveMetricHighlighting();
    this.performCulling();
  }

  private handleZoomChange(): void {
    // Recompute visibility before promoting textures. A large wheel step can
    // go from the entire catalogue to a few cards in one event; the previous
    // visible set must not trigger high-detail downloads for all of them.
    this.scheduleCulling();
  }

  private handleViewportChange(): void {
    this.updateViewportVelocity();
    this.rebuildCollectionForLayoutVariantChange();
    this.scheduleCulling();
    this.drawGrid();
    if (this.camera) {
      this.onViewportCenterChange?.(this.camera.getScreenCenter());
    }
  }

  private updateViewportVelocity(): void {
    if (!this.camera) return;

    const now = performance.now();
    const center = this.camera.getScreenCenter();
    if (!this.lastViewportCenter || this.lastViewportMoveMs <= 0) {
      this.lastViewportCenter = center;
      this.lastViewportMoveMs = now;
      return;
    }

    const elapsed = Math.max(now - this.lastViewportMoveMs, 1);
    this.viewportVelocityPxPerMs = {
      x: ((center.x - this.lastViewportCenter.x) * this.camera.zoom) / elapsed,
      y: ((center.y - this.lastViewportCenter.y) * this.camera.zoom) / elapsed,
    };
    this.lastViewportCenter = center;
    this.lastViewportMoveMs = now;

    const speed = Math.hypot(
      this.viewportVelocityPxPerMs.x,
      this.viewportVelocityPxPerMs.y,
    );
    if (speed >= PHONE_MEDIUM_HIGH_PAN_VELOCITY_PX_PER_MS) {
      this.lastHighVelocityPanMs = now;
    }
  }

  private isPhoneMediumLoadingPaused(): boolean {
    if (!isConstrainedTextureDevice() || isLowDetailTextureDevice()) {
      return false;
    }
    return (
      performance.now() - this.lastHighVelocityPanMs <
      PHONE_MEDIUM_LOAD_RESUME_IDLE_MS
    );
  }

  private schedulePhoneMediumLoadResume(): void {
    if (this.mediumLoadResumeTimerId !== null) return;

    this.mediumLoadResumeTimerId = window.setTimeout(() => {
      this.mediumLoadResumeTimerId = null;
      this.queueVisibleHighDetailPreload();
    }, PHONE_MEDIUM_LOAD_RESUME_IDLE_MS);
  }

  private getCollectionLayoutVariant(): CollectionLayoutVariant {
    // Prefer the visual viewport so mobile browser chrome and orientation changes
    // trigger the same collection layout decision the user actually sees.
    const viewport = globalThis.window?.visualViewport;
    const width = viewport?.width ?? globalThis.window?.innerWidth;
    const height = viewport?.height ?? globalThis.window?.innerHeight;

    if (
      typeof width === "number" &&
      typeof height === "number" &&
      width > 0 &&
      height > 0
    ) {
      return height > width ? "portrait" : "wide";
    }

    return this.app.screen.height > this.app.screen.width ? "portrait" : "wide";
  }

  private rebuildCollectionForLayoutVariantChange(): void {
    const nextVariant = this.getCollectionLayoutVariant();
    if (this.collectionLayoutVariant === nextVariant) return;

    this.collectionLayoutVariant = nextVariant;
    if (this.cards.length === 0) return;

    this.rebuildCardSprites(false);
  }

  private scheduleCulling(): void {
    if (this.cullingScheduled || this.isDestroyed) return;

    const now = performance.now();
    const elapsed = now - this.lastCullingUpdate;
    this.cullingScheduled = true;
    const update = () => {
      this.cullingScheduled = false;
      if (!this.isDestroyed) this.performCulling();
    };

    if (elapsed >= CULLING_THROTTLE_MS) {
      // pixi-viewport emits zoomed before it moves to keep the cursor fixed.
      // Wait until that event finishes so LOD uses the final camera bounds.
      queueMicrotask(update);
    } else {
      setTimeout(update, CULLING_THROTTLE_MS - elapsed);
    }
  }

  private performCulling(): void {
    if (!this.camera) return;

    this.lastCullingUpdate = performance.now();

    const viewport = this.camera.getVisibleBounds();
    const expandedBounds: CameraBounds = {
      left: viewport.left - CULLING_MARGIN,
      top: viewport.top - CULLING_MARGIN,
      right: viewport.right + CULLING_MARGIN,
      bottom: viewport.bottom + CULLING_MARGIN,
    };

    const newVisible = new Set<string>();
    const cardsToLoad: string[] = [];

    for (const [name, data] of this.cardSprites) {
      const isVisible = this.boundsIntersect(data.bounds, expandedBounds);

      if (isVisible) {
        newVisible.add(name);

        if (!data.sprite.visible) {
          data.sprite.visible = true;
          cardsToLoad.push(name);
        }

        if (this.initialRevealCompleted && !this.isRevealInProgress) {
          // Filter/layout rebuilds recreate sprites; ensure visible cards start
          // loading immediately even when zoom level hasn't changed yet.
          if (!data.sprite.isTextureReady) {
            data.sprite.loadInitialTexture();
          }
          data.sprite.updateLOD(this.camera.zoom);
        }
      } else {
        if (data.sprite.visible) {
          data.sprite.visible = false;
        }
      }
    }

    // Cull deck sprites
    for (const [, data] of this.deckSprites) {
      const isVisible = this.boundsIntersect(data.bounds, expandedBounds);
      if (isVisible) {
        if (!data.sprite.visible) {
          data.sprite.visible = true;
          cardsToLoad.push(data.layout.name);
        }

        if (this.initialRevealCompleted && !this.isRevealInProgress) {
          if (!data.sprite.isTextureReady) {
            data.sprite.loadInitialTexture();
          }
          data.sprite.updateLOD(this.camera.zoom);
        }
      } else {
        if (data.sprite.visible) {
          data.sprite.visible = false;
        }
      }
    }

    for (const [, data] of this.associationShelfSprites) {
      const isVisible = this.boundsIntersect(data.bounds, expandedBounds);
      if (isVisible) {
        if (!data.sprite.visible) {
          data.sprite.visible = true;
          cardsToLoad.push(data.layout.name);
        }

        if (this.initialRevealCompleted && !this.isRevealInProgress) {
          if (!data.sprite.isTextureReady) {
            data.sprite.loadInitialTexture();
          }
          data.sprite.updateLOD(this.camera.zoom);
        }
      } else if (data.sprite.visible) {
        data.sprite.visible = false;
      }
    }

    this.updateCanvasAreaCardVisibility(expandedBounds);
    this.visibleCardNames = newVisible;

    // During the initial reveal we let `startTextureReveal()` own texture loading so
    // it can randomize start order and drive the progress UI. After reveal completes,
    // culling can freely preload as the user pans/zooms.
    if (
      cardsToLoad.length > 0 &&
      this.initialRevealCompleted &&
      !this.isRevealInProgress
    ) {
      lodManager.preloadTextures(cardsToLoad);
    }

    this.queueVisibleHighDetailPreload();
    if (this.initialRevealCompleted && !this.isRevealInProgress) {
      this.pruneFullTextureCache();
    }
  }

  private *getCanvasAreaCardSprites(): IterableIterator<CardSprite> {
    for (const data of this.zoneCardSprites.values()) yield data.sprite;
    for (const frame of this.zoneFrames.values()) {
      if (frame.avatarSprite) yield frame.avatarSprite;
    }
  }

  private updateCanvasAreaCardVisibility(bounds: CameraBounds): void {
    if (!this.camera) return;
    // Apply the catalogue's near-viewport policy to saved decks and stacks too.
    // Distant decks must not compete with the cards the user is zooming into.
    for (const sprite of this.getCanvasAreaCardSprites()) {
      sprite.visible = this.boundsIntersect(sprite.getWorldBounds(), bounds);
      if (sprite.visible) {
        sprite.loadInitialTexture();
        sprite.updateLOD(this.camera.zoom);
      }
    }
  }

  private shouldLoadHighDetail(): boolean {
    if (this.isRevealInProgress || !this.initialRevealCompleted) return false;
    if (isConstrainedTextureDevice() && isLowDetailTextureDevice()) {
      return false;
    }
    return this.getVisibleDetailLOD() !== LOD_LEVELS.THUMBNAIL;
  }

  private getVisibleDetailLOD(): LODLevel {
    if (!this.camera) return LOD_LEVELS.THUMBNAIL;
    return lodManager.getLODForCardDisplay(
      this.camera.zoom,
      CARD_SIZE.PORTRAIT.height,
    );
  }

  private getVisibleCardNamesForHighDetail(): string[] {
    if (
      isConstrainedTextureDevice() &&
      !isLowDetailTextureDevice() &&
      this.getVisibleDetailLOD() === LOD_LEVELS.MEDIUM
    ) {
      return this.getPhoneMediumPriorityCardNames();
    }

    const names = new Set<string>();
    for (const name of this.visibleCardNames) {
      names.add(name);
    }
    for (const [, data] of this.deckSprites) {
      if (data.sprite.visible) {
        names.add(data.layout.name);
      }
    }
    for (const data of this.associationShelfSprites.values()) {
      if (data.sprite.visible) {
        names.add(data.layout.name);
      }
    }
    for (const sprite of this.getCanvasAreaCardSprites()) {
      if (sprite.visible) {
        names.add(sprite.cardName);
      }
    }
    return [...names];
  }

  private getPhoneMediumPriorityCardNames(): string[] {
    if (!this.camera) return [];

    const viewport = this.camera.getVisibleBounds();
    const viewportWidth = viewport.right - viewport.left;
    const viewportHeight = viewport.bottom - viewport.top;
    const nearBounds = this.expandBounds(
      viewport,
      viewportWidth * PHONE_MEDIUM_NEAR_VIEWPORT_MULTIPLIER,
      viewportHeight * PHONE_MEDIUM_NEAR_VIEWPORT_MULTIPLIER,
    );
    const directionBounds = this.getPanDirectionBounds(
      nearBounds,
      viewportWidth,
      viewportHeight,
    );

    const exact: string[] = [];
    const near: string[] = [];
    const directional: string[] = [];
    const seen = new Set<string>();

    const add = (bucket: string[], name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      bucket.push(name);
    };

    const visit = (
      name: string,
      bounds: { left: number; top: number; right: number; bottom: number },
    ) => {
      if (this.boundsIntersect(bounds, viewport)) {
        add(exact, name);
      } else if (this.boundsIntersect(bounds, nearBounds)) {
        add(near, name);
      } else if (directionBounds && this.boundsIntersect(bounds, directionBounds)) {
        add(directional, name);
      }
    };

    for (const [name, data] of this.cardSprites) {
      visit(name, data.bounds);
    }
    for (const [, data] of this.deckSprites) {
      visit(data.layout.name, data.bounds);
    }
    for (const data of this.associationShelfSprites.values()) {
      visit(data.layout.name, data.bounds);
    }
    for (const sprite of this.getCanvasAreaCardSprites()) {
      visit(sprite.cardName, sprite.getWorldBounds());
    }

    return [...exact, ...near, ...directional];
  }

  private expandBounds(
    bounds: CameraBounds,
    xPadding: number,
    yPadding: number,
  ): CameraBounds {
    return {
      left: bounds.left - xPadding,
      top: bounds.top - yPadding,
      right: bounds.right + xPadding,
      bottom: bounds.bottom + yPadding,
    };
  }

  private getPanDirectionBounds(
    nearBounds: CameraBounds,
    viewportWidth: number,
    viewportHeight: number,
  ): CameraBounds | null {
    const velocity = this.viewportVelocityPxPerMs;
    const hasHorizontalDirection =
      Math.abs(velocity.x) >= PHONE_MEDIUM_HIGH_PAN_VELOCITY_PX_PER_MS * 0.25;
    const hasVerticalDirection =
      Math.abs(velocity.y) >= PHONE_MEDIUM_HIGH_PAN_VELOCITY_PX_PER_MS * 0.25;

    if (!hasHorizontalDirection && !hasVerticalDirection) {
      return null;
    }

    const bounds = { ...nearBounds };
    const xLookahead = viewportWidth * PHONE_MEDIUM_PAN_DIRECTION_VIEWPORTS;
    const yLookahead = viewportHeight * PHONE_MEDIUM_PAN_DIRECTION_VIEWPORTS;

    if (hasHorizontalDirection) {
      if (velocity.x > 0) {
        bounds.right += xLookahead;
      } else {
        bounds.left -= xLookahead;
      }
    }

    if (hasVerticalDirection) {
      if (velocity.y > 0) {
        bounds.bottom += yLookahead;
      } else {
        bounds.top -= yLookahead;
      }
    }

    return bounds;
  }

  private getFullTextureCacheKeepNames(): string[] {
    const names = new Set(this.getVisibleCardNamesForHighDetail());
    if (this.hoveredCardName) {
      names.add(this.hoveredCardName);
    }

    for (const key of this.selectedCards) {
      const data = this.getSpriteData(key);
      if (data) {
        names.add(data.layout.name);
      }
    }

    for (const key of this.selectedZoneCardKeys) {
      const data = this.zoneCardSprites.get(key);
      if (data) {
        names.add(data.cardName);
      }
    }

    return [...names];
  }

  private pruneFullTextureCache(): void {
    if (this.isDestroyed) return;
    const keepNames = this.getFullTextureCacheKeepNames();
    lodManager.pruneFullTextureCache(keepNames);
    lodManager.pruneCache(keepNames);
  }

  private queueVisibleHighDetailPreload(): void {
    if (this.isDestroyed) return;
    if (!this.shouldLoadHighDetail()) {
      this.highDetailPreloadRunId++;
      this.highDetailPreloadQueued = false;
      this.onBackgroundTextureProgress?.(0, 0);
      return;
    }

    const lod = this.getVisibleDetailLOD();
    const priorityNames = this.getVisibleCardNamesForHighDetail();
    if (
      lod === LOD_LEVELS.MEDIUM &&
      isConstrainedTextureDevice() &&
      !isLowDetailTextureDevice()
    ) {
      lodManager.cancelQueuedAtlasLoads(LOD_LEVELS.MEDIUM, priorityNames);
      if (this.isPhoneMediumLoadingPaused()) {
        this.highDetailPreloadRunId++;
        this.highDetailPreloadQueued = false;
        this.onBackgroundTextureProgress?.(0, 0);
        this.schedulePhoneMediumLoadResume();
        return;
      }
    }

    if (this.highDetailPreloadRunning) {
      // Finish in-flight downloads, then replace stale queued work with the
      // latest viewport. Keep the existing bounded loader and texture cache.
      this.highDetailPreloadRunId++;
      this.highDetailPreloadQueued = true;
      return;
    }

    void this.runVisibleHighDetailPreload();
  }

  private async runVisibleHighDetailPreload(): Promise<void> {
    if (!this.shouldLoadHighDetail()) {
      this.onBackgroundTextureProgress?.(0, 0);
      return;
    }

    const names = this.getVisibleCardNamesForHighDetail();
    const lod = this.getVisibleDetailLOD();
    const loadOptions = getHighDetailLoadOptions();
    const runId = ++this.highDetailPreloadRunId;
    this.highDetailPreloadRunning = true;

    try {
      await lodManager.preloadTextures(names, {
        lod,
        concurrentLoads: loadOptions.concurrentLoads,
        batchSize: loadOptions.batchSize,
        shouldContinue: () => {
          if (this.isDestroyed || runId !== this.highDetailPreloadRunId) {
            return false;
          }
          return !(
            lod === LOD_LEVELS.MEDIUM &&
            isConstrainedTextureDevice() &&
            !isLowDetailTextureDevice() &&
            this.isPhoneMediumLoadingPaused()
          );
        },
        onProgress: (loaded, total) => {
          if (this.isDestroyed || runId !== this.highDetailPreloadRunId) return;
          this.onBackgroundTextureProgress?.(loaded, total);
        },
      });
      this.refreshVisibleTextureLODs();
    } finally {
      this.highDetailPreloadRunning = false;
      this.pruneFullTextureCache();
      if (this.highDetailPreloadQueued) {
        this.highDetailPreloadQueued = false;
        this.queueVisibleHighDetailPreload();
      }
    }
  }

  private refreshVisibleTextureLODs(): void {
    for (const name of this.visibleCardNames) {
      const data = this.cardSprites.get(name);
      data?.sprite.refreshCurrentLOD();
    }
    for (const data of this.deckSprites.values()) {
      if (data.sprite.visible) {
        data.sprite.refreshCurrentLOD();
      }
    }
    for (const data of this.associationShelfSprites.values()) {
      if (data.sprite.visible) {
        data.sprite.refreshCurrentLOD();
      }
    }
    for (const sprite of this.getCanvasAreaCardSprites()) {
      if (sprite.visible) {
        sprite.refreshCurrentLOD();
      }
    }
  }

  private reloadVisibleTexturesAfterContextRestore(): void {
    for (const name of this.visibleCardNames) {
      const data = this.cardSprites.get(name);
      data?.sprite.reloadCurrentTexture();
    }
    for (const data of this.deckSprites.values()) {
      if (data.sprite.visible) {
        data.sprite.reloadCurrentTexture();
      }
    }
    for (const data of this.associationShelfSprites.values()) {
      if (data.sprite.visible) {
        data.sprite.reloadCurrentTexture();
      }
    }
    for (const sprite of this.getCanvasAreaCardSprites()) {
      if (sprite.visible) {
        sprite.reloadCurrentTexture();
      }
    }
  }

  private boundsIntersect(
    a: { left: number; top: number; right: number; bottom: number },
    b: CameraBounds,
  ): boolean {
    return !(
      a.right < b.left ||
      a.left > b.right ||
      a.bottom < b.top ||
      a.top > b.bottom
    );
  }

  private update(): void {
    const nowMs = performance.now();
    if (!this.motionEnabled()) {
      for (const entry of this.mangaEffects ?? []) entry.effect.destroy();
      this.mangaEffects = [];
      for (const entry of this.deletionPuffs) entry.effect.destroy();
      this.deletionPuffs = [];
    }
    if ((this.mangaEffects?.length ?? 0) || this.deletionPuffs.length) this.getMangaEffectLayer();
    this.mangaEffects = (this.mangaEffects ?? []).filter(entry => entry.effect.update(nowMs - entry.start, this.camera?.zoom ?? 1,
      entry.follow ? this.getCardsEffectBounds(entry.follow) : undefined));
    if (this.armedDelete && Date.now() > this.armedDelete.expires) {
      this.armedDelete = null;
      this.drawZoneDeleteOverlay();
    }
    if (this.dragFeedbackGraphic && this.dragFeedbackBounds) {
      this.dragFeedbackGraphic.alpha = this.motionEnabled() ? 0.75 + Math.sin(nowMs / 220) * 0.12 : 0.85;
    }
    if (this.dragDetachedAt && this.zoneCardDragState.isDragging) {
      const elapsed = nowMs - this.dragDetachedAt;
      for (const key of this.zoneCardDragState.cards.keys()) {
        const sprite = this.zoneCardSprites.get(key)?.sprite;
        if (sprite) sprite.rotation = this.motionEnabled() && elapsed < 240 ? Math.sin(elapsed / 30) * 0.025 * (1 - elapsed / 240) : 0;
      }
      if (elapsed >= 360) this.dragDetachedAt = 0;
    }
    this.deletionPuffs = this.deletionPuffs.filter(puff => puff.effect.update(nowMs - puff.start));
    if (
      this.quickTransferState.active &&
      this.lastPointerScreenPos &&
      nowMs - this.quickTransferLastTickMs >= 80
    ) {
      this.quickTransferLastTickMs = nowMs;
      this.updateQuickTransferHover(this.lastPointerScreenPos, nowMs);
    }

    // Reveal animation: smooth fade from 0.5 → 1.0 over 500ms
    if (this.revealFading) {
      const elapsed = nowMs - this.revealFadeStart;
      const t = Math.min(elapsed / 500, 1);
      const alpha = 0.5 + 0.5 * t;

      for (const data of this.cardSprites.values()) {
        if (data.sprite.alpha > 0) {
          data.sprite.alpha = alpha;
        }
      }
      for (const label of this.headerLabels) {
        if (label.alpha > 0) {
          label.alpha = alpha;
        }
      }

      if (t >= 1) {
        this.revealFading = false;
      }
    }
  }
}
