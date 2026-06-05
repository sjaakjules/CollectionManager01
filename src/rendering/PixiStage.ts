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
 * - Right-drag anywhere: Pans viewport
 * - Left-click on card: Select (or add to selection with shift)
 * - Left-drag on selected card: Move all selected cards
 * - Left-drag on empty space OR unselected card: Selection box
 * - Ctrl+left-drag: Selection box (alternative)
 * - Double left-click: Add card to deck
 * - Double right-click: Remove card from deck
 * - Click on stacked card: Brings it to front of stack
 */

import {
  Application,
  Container,
  Graphics,
  Text,
  FederatedPointerEvent,
} from "pixi.js";
import { Camera, type CameraBounds } from "./Camera";
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
  pixelsToSnapGrid,
  type CardLayoutInfo,
  type ContentBounds,
} from "./Grid";
import {
  lodManager,
  LOD_LEVELS,
  LOD_ZOOM_THRESHOLDS,
  cardNameToSlug,
} from "./LODManager";
import {
  getHighDetailLoadOptions,
  getInitialRevealConcurrentLoads,
  getPixiCanvasResolution,
  getPixiTextResolution,
  isConstrainedTextureDevice,
  shouldPreloadFullTextureCatalog,
} from "./deviceProfile";
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
  updateArchetypeScore,
  saveScoreUpdate,
  flushPendingScoreUpdates,
  type ArchetypeScores,
} from "@/data/archetypeScores";
import {
  applyCardFilters,
  cloneCardFilterState,
  createDefaultCardFilters,
  ensureCardFilterState,
  isCardFilterActive,
  isCardFilterCriteriaEmpty,
  type CardFilterState,
} from "@/data/cardFilters";
import { DECK_LIMITS, getThresholdGroup } from "@/data/dataModels";
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
}

export interface CardDragDropPayload {
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
}

interface ZoneDragState {
  isDragging: boolean;
  zoneId: string | null;
  startWorldPos: { x: number; y: number };
  startBounds: { x: number; y: number } | null;
}

type QuickTransferCategory = "deck" | "stack";

interface QuickTransferCategoryBounds {
  category: QuickTransferCategory;
  bounds: { left: number; top: number; right: number; bottom: number };
}

interface QuickTransferCanvasAreaBounds {
  zoneId: string;
  bounds: { left: number; top: number; right: number; bottom: number };
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

type DeckZoneBoard = "mainboard" | "sideboard";

interface DeckVariantDialogResult {
  name: string;
  sourceVariantId: string | null;
}

interface DeckCostBucketStats {
  total: number;
  byType: Record<"Minion" | "Magic" | "Aura" | "Artifact", number>;
  byThreshold: Record<ThresholdGroup, number>;
}

interface DeckHeaderStats {
  spellsTotal: number;
  sitesTotal: number;
  collectionTotal: number;
  spellTypeCounts: Record<"Minion" | "Magic" | "Aura" | "Artifact", number>;
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

// ============================================================================
// Constants
// ============================================================================

const CULLING_MARGIN = 300;
const CULLING_THROTTLE_MS = 50;
const DOUBLE_CLICK_TIME_MS = 300;
const ATLAS_CARD_REVEAL_SPREAD_MS = 300;
const ZONE_BODY_PADDING = 14;
const ZONE_AUTO_EXPAND_PADDING = 24;
const ZONE_DELETE_SIZE = 18;
const ZONE_CARD_ACTION_GAP = 4;
const MAIN_QUADRANT_CARD_PADDING = 220;
const ZONE_DECK_BOARD_GAP = 10;
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
const ZONE_DECK_MIN_BOARD_HEIGHT = {
  mainboard: CARD_SIZE.PORTRAIT.height + ZONE_DECK_CARD_TOP_GAP + 6,
  sideboard: CARD_SIZE.PORTRAIT.height + ZONE_DECK_CARD_TOP_GAP - 6,
} as const;
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
  total: 0xf2f5ff,
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
  private zoneDropPreviewOverlay: Graphics | null = null;
  private zoneDropPreviewSprites: CardSprite[] = [];
  private zoneDropPreviewSignature: string | null = null;
  private quickTransferOverlay: Graphics | null = null;
  private quickTransferOverlayTexts: Text[] = [];
  private deckCardDeletePromptRoot: HTMLElement | null = null;
  private deckCardDeletePromptPointerHandler: ((event: PointerEvent) => void) | null = null;
  private deckCardDeletePromptKeyHandler: ((event: KeyboardEvent) => void) | null = null;
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
    | { cards: Card[]; filteredMode: boolean }
    | null = null;
  private collectionFilteredMode = false;

  // Culling state
  private lastCullingUpdate = 0;
  private visibleCardNames: Set<string> = new Set();
  private cullingScheduled = false;

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
  private stacksDropVisualActive = false;
  private zoneCardDragState: ZoneCardDragState = {
    isDragging: false,
    key: null,
    zoneId: null,
    instanceId: null,
    startWorldPos: { x: 0, y: 0 },
    startCardPos: { x: 0, y: 0 },
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

  // Label state
  private labelPlacementMode = false;
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
  private collectionBounds: ContentBounds = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  };
  private deckBounds: ContentBounds = { left: 0, top: 0, right: 0, bottom: 0 };
  private activeDeck: Deck | null = null;

  // Archetype highlighting state
  private archetypeScores: ArchetypeScores | null = null;
  private selectedArchetype: string | null = null;

  // Reveal animation state
  private revealFading = false;
  private revealFadeStart = 0;
  private revealRunId = 0;
  private pendingRevealTimeouts: number[] = [];
  private isRevealInProgress = false;
  private initialRevealCompleted = false;
  private highDetailPreloadRunning = false;
  private highDetailPreloadQueued = false;
  private catalogHighDetailPreloadRunId = 0;
  private catalogHighDetailPreloadStarted = false;

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
  private hoveredCardName: string | null = null;
  private lastPointerScreenPos: { x: number; y: number } | null = null;
  private quickTransferLastTickMs = 0;

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
      background: 0x1a1a2e,
      resizeTo: container,
      antialias: true,
      resolution: getPixiCanvasResolution(),
      autoDensity: true,
      powerPreference: "high-performance",
    });

    if (this.isDestroyed) {
      this.app.destroy(true, { children: true });
      return;
    }

    container.appendChild(this.app.canvas);

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

    this.setupPointerEvents();

    this.app.ticker.add(this.update.bind(this));

    this.isInitialized = true;
    this.onViewportCenterChange?.(this.camera.getScreenCenter());

    if (this.pendingCardSet) {
      this.cards = this.pendingCardSet.cards;
      this.collectionFilteredMode = this.pendingCardSet.filteredMode;
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
    viewport.eventMode = "static";

    viewport.on("pointerdown", this.onPointerDown.bind(this));
    viewport.on("pointermove", this.onPointerMove.bind(this));
    viewport.on("pointerup", this.onPointerUp.bind(this));
    // cspell:disable-next-line
    viewport.on("pointerupoutside", this.onPointerUp.bind(this));
    viewport.on("pointerleave", () => {
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
    this.app.canvas.addEventListener("pointerleave", () => {
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

  private setHoveredCard(cardName: string | null): void {
    if (this.hoveredCardName === cardName) return;
    this.hoveredCardName = cardName;
    if (cardName) {
      this.prioritizeHoveredCardHighDetail(cardName);
    }
    this.onHoveredCardChange?.(cardName);
  }

  private prioritizeHoveredCardHighDetail(cardName: string): void {
    void lodManager
      .preloadTextures([cardName], {
        lod: LOD_LEVELS.FULL,
        concurrentLoads: 1,
        batchSize: 1,
      })
      .catch(() => null);
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

    return target.closest(".stacks-panel.open, .stack-tab, .stack-tab-add");
  }

  private isPointInsideStacksDropTarget(clientX: number, clientY: number): boolean {
    return this.getStacksDropTargetAtPoint(clientX, clientY) !== null;
  }

  private isPointInsideOpenStacksPanel(clientX: number, clientY: number): boolean {
    const dropTarget = this.getStacksDropTargetAtPoint(clientX, clientY);
    return dropTarget instanceof HTMLElement && dropTarget.classList.contains("stacks-panel");
  }

  private getStackZoneIdFromDropTarget(clientX: number, clientY: number): string | null {
    const dropTarget = this.getStacksDropTargetAtPoint(clientX, clientY);
    if (!(dropTarget instanceof HTMLElement)) return null;

    const stackTarget = dropTarget.closest("[data-stack-area-id]");
    if (!(stackTarget instanceof HTMLElement)) return null;

    const zoneId = stackTarget.dataset.stackAreaId;
    if (!zoneId) return null;

    const matching = this.canvasAreas.find(
      (zone) => zone.id === zoneId && zone.type === "stack",
    );
    return matching ? matching.id : null;
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

  private getQuickTransferTargets(category: QuickTransferCategory): CanvasArea[] {
    const zoneType = category === "deck" ? "deck" : "stack";
    return this.canvasAreas
      .filter((zone) => zone.type === zoneType)
      .sort((left, right) => left.name.localeCompare(right.name));
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

  private getQuickTransferZoneAtPosition(screenPos: { x: number; y: number }): string | null {
    for (const entry of this.quickTransferState.zoneBounds) {
      if (this.pointInBounds(screenPos, entry.bounds)) {
        return entry.zoneId;
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
    const visibleTargets = zoneTargets.slice(0, maxRows);

    if (zoneTargets.length === 0) {
      const noDataWidth = zoneWidth;
      overlay.roundRect(zoneLeft, zoneTop, noDataWidth, boxHeight, cornerRadius);
      overlay.fill({ color: QUICK_TRANSFER_COLORS.baseFill, alpha: 1 });
      overlay.stroke({
        width: borderWidth,
        color: QUICK_TRANSFER_COLORS.baseBorder,
        alpha: 1,
      });
      this.addQuickTransferText(
        expandedCategory === "deck" ? "No saved decks" : "No saved stacks",
        {
          x: zoneLeft + textInsetX,
          y: zoneTop + textInsetY,
          maxWidth: noDataWidth - textInsetX * 2,
          fill: QUICK_TRANSFER_COLORS.hoverText,
          fontSize: rowFontSize,
          bold: true,
          strokeWidth: textStrokeWidth,
        },
      );
      return;
    }

    visibleTargets.forEach((zone, index) => {
      const topY = zoneTop + index * (boxHeight + gap);
      const right = zoneLeft + zoneWidth;
      const bottom = topY + boxHeight;
      const isHover = this.quickTransferState.zoneHoverId === zone.id;
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
        zoneId: zone.id,
        bounds: { left: zoneLeft, top: topY, right, bottom },
      });

      this.addQuickTransferText(zone.name.trim() || "(Unnamed)", {
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

    const hiddenCount = zoneTargets.length - visibleTargets.length;
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
      this.quickTransferState.zoneHoverId = this.getQuickTransferZoneAtPosition(screenPos);
    }

    this.drawQuickTransferOverlay(anchorScreenPos, nowMs);
  }

  private beginQuickTransferDrag(
    cardKey: string,
    worldPos: { x: number; y: number },
    screenPos: { x: number; y: number },
  ): boolean {
    if (!this.cardSprites.has(cardKey)) return false;
    const hasTargets = this.canvasAreas.some(
      (zone) => zone.type === "deck" || zone.type === "stack",
    );
    if (!hasTargets) return false;

    this.clearSelection(true);
    this.selectCard(cardKey, true);
    this.emitSelectionChange();

    this.pointerDownOnSelectedCard = true;
    this.startCardDrag(worldPos);
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

  private completeQuickTransferDrop(
    worldPos: { x: number; y: number },
    screenPos: { x: number; y: number },
  ): void {
    if (!this.quickTransferState.active) return;

    this.updateQuickTransferHover(screenPos);
    const dropZoneId = this.getQuickTransferZoneAtPosition(screenPos);
    const draggedCardNames = this.getDraggedCardNames();
    const draggedPlacements = this.getDraggedCardPlacements();

    this.endCardDrag(true);
    this.pointerDownOnSelectedCard = false;
    this.camera?.resumeDrag();
    this.setStacksDropVisual(false);

    if (dropZoneId && draggedCardNames.length > 0) {
      this.copyCardsIntoZone(dropZoneId, draggedCardNames, worldPos, {
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
    if (this.deckCardDeletePromptPointerHandler) {
      window.removeEventListener("pointerdown", this.deckCardDeletePromptPointerHandler, true);
      this.deckCardDeletePromptPointerHandler = null;
    }
    if (this.deckCardDeletePromptKeyHandler) {
      window.removeEventListener("keydown", this.deckCardDeletePromptKeyHandler, true);
      this.deckCardDeletePromptKeyHandler = null;
    }
    if (this.deckCardDeletePromptRoot?.parentNode) {
      this.deckCardDeletePromptRoot.parentNode.removeChild(this.deckCardDeletePromptRoot);
    }
    this.deckCardDeletePromptRoot = null;
  }

  private getDeckCardActiveVariants(
    zoneId: string,
    instanceId: string,
  ): Array<{ id: string; name: string; isActiveVariant: boolean }> {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone || zone.type !== "deck") return [];

    const variants = this.ensureDeckZoneVariants(zone);
    const matches = variants
      .filter((variant) => variant.activeCardIds.includes(instanceId))
      .map((variant) => ({
        id: variant.id,
        name: variant.name,
        isActiveVariant: zone.activeDeckVariantId === variant.id,
      }));

    matches.sort((left, right) => {
      if (left.isActiveVariant !== right.isActiveVariant) {
        return left.isActiveVariant ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    return matches;
  }

  private deactivateDeckZoneCardInVariant(
    zoneId: string,
    instanceId: string,
    variantId: string,
  ): boolean {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone || zone.type !== "deck") return false;
    const variants = this.ensureDeckZoneVariants(zone);
    const variant = variants.find((entry) => entry.id === variantId);
    if (!variant) return false;
    if (!variant.activeCardIds.includes(instanceId)) return false;

    variant.activeCardIds = variant.activeCardIds.filter((cardId) => cardId !== instanceId);
    if (zone.activeDeckVariantId === variantId) {
      this.moveDeckZoneCardToStackBack(zone, instanceId);
    }
    return true;
  }

  private showDeckCardDeletePrompt(
    zoneId: string,
    instanceId: string,
    anchorClientX: number,
    anchorClientY: number,
  ): void {
    if (typeof document === "undefined") return;
    const activeVariants = this.getDeckCardActiveVariants(zoneId, instanceId);
    if (activeVariants.length === 0) {
      this.closeDeckCardDeletePrompt();
      this.removeCanvasCardInstance(zoneId, instanceId);
      this.emitCanvasAreasChange();
      this.hoveredZoneCardKey = null;
      this.drawZoneDeleteOverlay();
      return;
    }

    this.closeDeckCardDeletePrompt();

    const panel = document.createElement("div");
    panel.style.position = "fixed";
    panel.style.zIndex = "10001";
    panel.style.minWidth = "188px";
    panel.style.maxWidth = "260px";
    panel.style.maxHeight = "320px";
    panel.style.overflowY = "auto";
    panel.style.padding = "8px";
    panel.style.background = "rgba(22, 22, 38, 0.98)";
    panel.style.border = "1px solid #3a3a5a";
    panel.style.borderRadius = "10px";
    panel.style.boxShadow = "0 10px 24px rgba(0, 0, 0, 0.38)";
    panel.style.display = "grid";
    panel.style.gap = "6px";
    panel.style.fontFamily = "Arial, sans-serif";

    const title = document.createElement("div");
    title.textContent = "Deactivate in variants";
    title.style.fontSize = "11px";
    title.style.fontWeight = "700";
    title.style.color = "#d4d6ff";
    title.style.letterSpacing = "0.02em";
    title.style.padding = "0 2px 2px";
    panel.appendChild(title);

    for (const variant of activeVariants) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.gap = "8px";
      row.style.padding = "6px 8px";
      row.style.border = "1px solid #3a3a5a";
      row.style.borderRadius = "8px";
      row.style.background = variant.isActiveVariant ? "#4a4a8a" : "rgba(22, 22, 38, 0.92)";

      const name = document.createElement("span");
      name.textContent = variant.name;
      name.style.fontSize = "12px";
      name.style.fontWeight = variant.isActiveVariant ? "700" : "600";
      name.style.color = variant.isActiveVariant ? "#ffffff" : "#e0e0e0";
      name.style.whiteSpace = "nowrap";
      name.style.overflow = "hidden";
      name.style.textOverflow = "ellipsis";
      row.appendChild(name);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "X";
      removeButton.title = `Deactivate in ${variant.name}`;
      removeButton.style.width = "20px";
      removeButton.style.height = "20px";
      removeButton.style.minWidth = "20px";
      removeButton.style.border = "1px solid #6a6aba";
      removeButton.style.borderRadius = "6px";
      removeButton.style.background = "#3a3a5a";
      removeButton.style.color = "#ffffff";
      removeButton.style.fontSize = "11px";
      removeButton.style.fontWeight = "800";
      removeButton.style.cursor = "pointer";
      removeButton.style.opacity = "0";
      removeButton.style.transition = "opacity 0.12s ease, background 0.12s ease";
      row.appendChild(removeButton);

      row.addEventListener("mouseenter", () => {
        removeButton.style.opacity = "1";
      });
      row.addEventListener("mouseleave", () => {
        removeButton.style.opacity = "0";
      });
      removeButton.addEventListener("mouseenter", () => {
        removeButton.style.background = "#4a4a8a";
      });
      removeButton.addEventListener("mouseleave", () => {
        removeButton.style.background = "#3a3a5a";
      });
      removeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const changed = this.deactivateDeckZoneCardInVariant(zoneId, instanceId, variant.id);
        if (!changed) return;

        this.rebuildZoneVisuals();
        this.emitCanvasAreasChange();

        const remaining = this.getDeckCardActiveVariants(zoneId, instanceId);
        if (remaining.length === 0) {
          this.closeDeckCardDeletePrompt();
          this.removeCanvasCardInstance(zoneId, instanceId);
          this.emitCanvasAreasChange();
          this.hoveredZoneCardKey = null;
          this.drawZoneDeleteOverlay();
          return;
        }
        this.showDeckCardDeletePrompt(zoneId, instanceId, anchorClientX, anchorClientY);
      });

      panel.appendChild(row);
    }

    const clamp = (
      value: number,
      minValue: number,
      maxValue: number,
    ): number => Math.max(minValue, Math.min(value, maxValue));
    const panelWidth = 220;
    const estimatedHeight = 52 + activeVariants.length * 36;
    const left = clamp(
      anchorClientX + 10,
      8,
      window.innerWidth - panelWidth - 8,
    );
    const top = clamp(
      anchorClientY + 10,
      8,
      window.innerHeight - Math.min(estimatedHeight, 320) - 8,
    );
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;

    document.body.appendChild(panel);
    this.deckCardDeletePromptRoot = panel;

    this.deckCardDeletePromptPointerHandler = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        this.closeDeckCardDeletePrompt();
        return;
      }
      if (!this.deckCardDeletePromptRoot?.contains(target)) {
        this.closeDeckCardDeletePrompt();
      }
    };
    this.deckCardDeletePromptKeyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeDeckCardDeletePrompt();
      }
    };
    window.addEventListener("pointerdown", this.deckCardDeletePromptPointerHandler, true);
    window.addEventListener("keydown", this.deckCardDeletePromptKeyHandler, true);
  }

  private handleZoneCardDelete(
    zoneCard: ZoneCardSpriteData,
    clientX: number,
    clientY: number,
  ): void {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneCard.zoneId);
    if (!zone || zone.type !== "deck") {
      this.closeDeckCardDeletePrompt();
      this.removeCanvasCardInstance(zoneCard.zoneId, zoneCard.instanceId);
      this.emitCanvasAreasChange();
      this.hoveredZoneCardKey = null;
      this.drawZoneDeleteOverlay();
      return;
    }

    const activeVariants = this.getDeckCardActiveVariants(zone.id, zoneCard.instanceId);
    if (activeVariants.length === 0) {
      this.closeDeckCardDeletePrompt();
      this.removeCanvasCardInstance(zone.id, zoneCard.instanceId);
      this.emitCanvasAreasChange();
      this.hoveredZoneCardKey = null;
      this.drawZoneDeleteOverlay();
      return;
    }

    this.showDeckCardDeletePrompt(zone.id, zoneCard.instanceId, clientX, clientY);
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
    return board === "sideboard" ? "sideboard" : "mainboard";
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
    const collectionSideboard = zone.cards.filter(
      (instance) => this.normalizeDeckBoard(instance.board) === "sideboard",
    );
    const collectionTotal = collectionSideboard.length;

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

      if (
        type !== "Minion" &&
        type !== "Magic" &&
        type !== "Aura" &&
        type !== "Artifact"
      ) {
        continue;
      }

      spellsTotal += 1;
      spellTypeCounts[type] += 1;

      const cost = Number.isFinite(card.guardian.cost)
        ? Math.max(0, card.guardian.cost)
        : 0;
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
      increment(thresholdSumByManaType[type], manaCost, thresholdSum);
      increment(spellCountByManaType[type], manaCost);

      const bucket = costBuckets[this.getDeckCostBucketKey(cost)];
      bucket.total += 1;
      bucket.byType[type] += 1;
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
    for (const instance of collectionSideboard) {
      duplicateCounts.set(
        instance.cardName,
        (duplicateCounts.get(instance.cardName) ?? 0) + 1,
      );
    }

    const duplicateViolations: DeckHeaderStats["duplicateViolations"] = [];
    for (const [name, count] of duplicateCounts) {
      const card = cardLookup.get(name);
      if (!card) continue;
      const limit = DECK_LIMITS.RARITY_LIMITS[card.guardian.rarity];
      if (count > limit) {
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
    if (board === "sideboard") {
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
        const nextX = snapped.x - cardSize.width / 2;
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
      const boardOrder: DeckZoneBoard[] = [
        "mainboard",
        "sideboard",
      ];

      for (const board of boardOrder) {
        const boardCards = nextCards.filter((card) => {
          const normalizedBoard = this.normalizeDeckBoard(card.board);
          if (normalizedBoard !== board) return false;
          card.board = normalizedBoard;
          return true;
        });
        const boardBottom = this.layoutZoneBoardCards(boardCards, {
          left: bodyLeft + ZONE_DECK_BOARD_INNER_LEFT,
          top: cursorY,
          width: bodyWidth - ZONE_DECK_BOARD_INNER_LEFT * 2,
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

    zone.cards = nextCards;
    this.reconcileCanvasAreaBounds(zone.id, { preserveTopLeft: true });
    this.rebuildZoneVisuals();
    if (options?.emitChange ?? true) {
      this.emitCanvasAreasChange();
    }
  }

  private hideZoneFromCanvas(zoneId: string): void {
    const zone = this.canvasAreas.find((entry) => entry.id === zoneId);
    if (!zone || !zone.pinned) return;
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
      this.zoneDeleteOverlay.fill({ color: 0x223b78, alpha: 0.95 });
      this.zoneDeleteOverlay.stroke({ width: 1.5, color: 0xbccaff, alpha: 0.85 });
      this.zoneDeleteOverlay.moveTo(duplicateBounds.left + 4, duplicateCenterY);
      this.zoneDeleteOverlay.lineTo(duplicateBounds.right - 4, duplicateCenterY);
      this.zoneDeleteOverlay.moveTo(duplicateCenterX, duplicateBounds.top + 4);
      this.zoneDeleteOverlay.lineTo(duplicateCenterX, duplicateBounds.bottom - 4);
      this.zoneDeleteOverlay.stroke({ width: 1.45, color: 0xf2f5ff, alpha: 0.94 });
    }

    const bounds = this.getDeleteButtonBounds(data);
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    const radius = (bounds.right - bounds.left) / 2;

    this.zoneDeleteOverlay.circle(centerX, centerY, radius);
    this.zoneDeleteOverlay.fill({ color: 0x1b1b2f, alpha: 0.94 });
    this.zoneDeleteOverlay.stroke({ width: 1.5, color: 0xc8d0ff, alpha: 0.8 });
    this.zoneDeleteOverlay.moveTo(bounds.left + 4, bounds.top + 4);
    this.zoneDeleteOverlay.lineTo(bounds.right - 4, bounds.bottom - 4);
    this.zoneDeleteOverlay.moveTo(bounds.right - 4, bounds.top + 4);
    this.zoneDeleteOverlay.lineTo(bounds.left + 4, bounds.bottom - 4);
    this.zoneDeleteOverlay.stroke({ width: 1.4, color: 0xf2f4ff, alpha: 0.92 });
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
      return;
    }

    if (zoneUnderPointer) {
      this.setHoveredCard(null);
      this.updateDeckGraphHoverTooltip(worldPos);
      return;
    }

    const cardKey = this.getCardAtPosition(worldPos);
    if (!cardKey) {
      this.setHoveredCard(null);
      this.updateDeckGraphHoverTooltip(worldPos);
      return;
    }

    const data = this.getSpriteData(cardKey);
    this.setHoveredCard(data?.layout.name ?? null);
    this.updateDeckGraphHoverTooltip(worldPos);
  }

  private onPointerDown(event: FederatedPointerEvent): void {
    if (!this.camera) return;

    const isRightClick = event.button === 2;
    const isCtrlHeld = event.ctrlKey || event.metaKey;
    const isShiftHeld = event.shiftKey;

    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);
    this.lastPointerScreenPos = { x: event.globalX, y: event.globalY };
    this.clearZoneDropPreview();
    const clickedZoneVariantTab = this.getZoneVariantTabTargetAtPosition(worldPos);
    if (!isRightClick && clickedZoneVariantTab) {
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
    if (!isRightClick && clickedZoneSort) {
      this.cancelSelectionBox();
      this.sortZoneCards(clickedZoneSort.id);
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    const clickedZoneFilterChip = this.getDeckFilterChipTargetAtPosition(worldPos);
    if (!isRightClick && clickedZoneFilterChip) {
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
    if (!isRightClick && clickedZoneFilter) {
      this.cancelSelectionBox();
      this.openDeckFilterRequest(clickedZoneFilter.id, null);
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    const clickedZoneClose = this.getZoneCloseTargetAtPosition(worldPos);
    if (!isRightClick && clickedZoneClose) {
      this.cancelSelectionBox();
      this.hideZoneFromCanvas(clickedZoneClose.id);
      this.updateHoveredFromWorldPos(worldPos);
      return;
    }

    const clickedZoneCard = this.getZoneCardAtPosition(worldPos);
    const clickedZoneHeader = this.getZoneHeaderAtPosition(worldPos);
    if (
      !isRightClick &&
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

    const clickedLabel = this.getLabelAtPosition(worldPos);

    // Label placement mode: next left-click places a label.
    if (this.labelPlacementMode && !isRightClick) {
      this.addLabelAtPosition(worldPos);
      this.consumeLabelPlacementMode();
      return;
    }

    if (clickedLabel) {
      if (isRightClick) {
        return;
      }

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

    if (!isRightClick && clickedZoneCard) {
      this.cancelSelectionBox();
      this.clearMainSelection(true);

      if (isShiftHeld) {
        if (
          this.selectedZoneId !== null &&
          this.selectedZoneId !== clickedZoneCard.zoneId
        ) {
          this.clearZoneSelection();
        }
        if (this.selectedZoneCardKeys.has(clickedZoneCard.key)) {
          this.deselectZoneCard(clickedZoneCard.key);
        } else {
          this.selectZoneCard(clickedZoneCard.key);
        }
        this.emitSelectionChange();
        this.updateHoveredFromWorldPos(worldPos);
        return;
      }

      if (
        !this.selectedZoneCardKeys.has(clickedZoneCard.key) ||
        this.selectedZoneId !== clickedZoneCard.zoneId
      ) {
        this.clearZoneSelection();
        this.selectZoneCard(clickedZoneCard.key);
      }
      this.emitSelectionChange();

      const now = Date.now();
      const isDoubleClick =
        now - this.lastZoneCardClickTime < DOUBLE_CLICK_TIME_MS &&
        this.lastClickedZoneCardKey === clickedZoneCard.key;
      this.lastZoneCardClickTime = now;
      this.lastClickedZoneCardKey = clickedZoneCard.key;

      if (isDoubleClick) {
        const zone = this.canvasAreas.find((entry) => entry.id === clickedZoneCard.zoneId);
        if (zone?.type === "deck") {
          const changed = this.toggleDeckZoneCardActive(
            clickedZoneCard.zoneId,
            clickedZoneCard.instanceId,
          );
          if (changed) {
            this.rebuildZoneVisuals();
            this.emitCanvasAreasChange();
          }
        } else {
          this.duplicateCanvasCardInstance(
            clickedZoneCard.zoneId,
            clickedZoneCard.instanceId,
          );
          this.rebuildZoneVisuals();
          this.emitCanvasAreasChange();
        }
        this.updateHoveredFromWorldPos(worldPos);
        return;
      }

      this.startZoneCardDrag(clickedZoneCard, worldPos);
      this.camera.pauseDrag();
      return;
    }

    if (!isRightClick && clickedZoneHeader) {
      this.cancelSelectionBox();
      if (clickedZoneHeader.type === "stack") {
        this.onStackZoneHeaderClick?.(clickedZoneHeader.id);
      }
      this.startZoneDrag(clickedZoneHeader.id, worldPos);
      this.camera.pauseDrag();
      return;
    }

    this.pointerDownOnSelectedCard = false;

    // Right-click always pans (do nothing special, let viewport handle it)
    if (isRightClick) {
      return;
    }

    const clickedCard = this.getCardAtPosition(worldPos);

    if (clickedCard) {
      this.clearZoneSelection();
      const wasSelected = this.selectedCards.has(clickedCard);

      // Check for double-click
      const now = Date.now();
      const isDoubleClick =
        now - this.lastClickTime < DOUBLE_CLICK_TIME_MS &&
        this.lastClickedCard === clickedCard;

      this.lastClickTime = now;
      this.lastClickedCard = clickedCard;

      if (isDoubleClick) {
        if (this.selectedArchetype && this.archetypeScores) {
          this.modifyArchetypeScore(clickedCard, +1);
        } else {
          const startedQuickTransfer = this.beginQuickTransferDrag(
            clickedCard,
            worldPos,
            { x: event.globalX, y: event.globalY },
          );
          if (!startedQuickTransfer) {
            this.onAddToDeck(clickedCard);
          }
        }
        return;
      }

      if (isShiftHeld) {
        // Shift+click toggles selection
        if (wasSelected) {
          this.deselectCard(clickedCard);
        } else {
          this.selectCard(clickedCard);
        }
      } else if (isCtrlHeld) {
        // Ctrl+click starts selection box
        this.startSelectionBox(worldPos);
        this.camera.pauseDrag();
      } else if (wasSelected) {
        // Clicked on ALREADY selected card - prepare for drag
        this.pointerDownOnSelectedCard = true;
        this.startCardDrag(worldPos);
        this.camera.pauseDrag();
      } else {
        // Clicked on unselected card - select it and start dragging
        this.clearSelection(true);
        this.selectCard(clickedCard, true);
        this.emitSelectionChange();
        this.pointerDownOnSelectedCard = true;
        this.startCardDrag(worldPos);
        this.camera.pauseDrag();
      }
    } else {
      // Clicked on empty space - start selection box
      if (!isShiftHeld) {
        this.clearSelection();
      }
      this.startSelectionBox(worldPos);
      this.camera.pauseDrag();
    }

    this.updateHoveredFromWorldPos(worldPos);
  }

  private onPointerMove(event: FederatedPointerEvent): void {
    if (!this.camera) return;

    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);
    this.lastPointerScreenPos = { x: event.globalX, y: event.globalY };

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
        if (this.selectedArchetype && this.archetypeScores) {
          this.modifyArchetypeScore(clickedCard, -1);
        } else {
          this.onRemoveFromDeck(clickedCard);
        }
      }
      this.lastClickTime = now;
      this.lastClickedCard = clickedCard;
      return;
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
      const droppedStackZoneId = droppedInStacksTarget
        ? this.getStackZoneIdFromDropTarget(clientX, clientY)
        : null;
      const draggedCardNames = this.getDraggedCardNames();
      const droppedZone = this.getZoneAtPosition(worldPos);
      const shouldDropToStackTarget =
        !!droppedStackZoneId && draggedCardNames.length > 0;
      const shouldDropToCanvasZone =
        !droppedInStacksTarget && !!droppedZone && draggedCardNames.length > 0;
      if (shouldDropToCanvasZone && droppedZone) {
        this.copyCardsIntoZone(droppedZone.id, draggedCardNames, worldPos, {
          placements: draggedPlacements,
        });
      }
      this.endCardDrag(true);
      this.camera.resumeDrag();
      this.setStacksDropVisual(false);

      if (shouldDropToStackTarget && droppedStackZoneId) {
        this.copyCardsIntoZone(droppedStackZoneId, draggedCardNames, worldPos, {
          useZonePlacement: true,
          placements: draggedPlacements,
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
    return this.cardSprites.get(key) ?? this.deckSprites.get(key);
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
        left.y !== right.y
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
    const data = this.labelSprites.get(labelId);
    if (!data) return;

    this.labelDragState.isDragging = true;
    this.labelDragState.labelId = labelId;
    this.labelDragState.startWorldPos = { ...worldPos };
    this.labelDragState.labelStartPos = { x: data.label.x, y: data.label.y };

    // Bring dragged label to top.
    this.labelContainer.addChild(data.text);
  }

  private updateLabelDrag(worldPos: { x: number; y: number }): void {
    if (!this.labelDragState.isDragging || !this.labelDragState.labelId) return;

    const data = this.labelSprites.get(this.labelDragState.labelId);
    if (!data) return;

    const dx = worldPos.x - this.labelDragState.startWorldPos.x;
    const dy = worldPos.y - this.labelDragState.startWorldPos.y;
    const x = this.labelDragState.labelStartPos.x + dx;
    const y = this.labelDragState.labelStartPos.y + dy;

    data.label.x = x;
    data.label.y = y;
    data.text.x = x;
    data.text.y = y;
    this.updateLabelBounds(data);
  }

  private endLabelDrag(): void {
    const { labelId } = this.labelDragState;
    if (labelId) {
      const data = this.labelSprites.get(labelId);
      if (data) {
        this.canvasLabels = this.canvasLabels.map((label) =>
          label.id === labelId ? { ...label, x: data.label.x, y: data.label.y } : label,
        );
        this.emitCanvasLabelsChange();
      }
    }

    this.labelDragState.isDragging = false;
    this.labelDragState.labelId = null;
  }

  private addLabelAtPosition(worldPos: { x: number; y: number }): void {
    const text = window.prompt("Label text", "");
    if (text === null) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    const label: CanvasLabel = {
      id: crypto.randomUUID(),
      text: trimmed,
      x: worldPos.x,
      y: worldPos.y,
    };

    this.canvasLabels = [...this.canvasLabels, label];
    this.rebuildLabelSprites();
    this.emitCanvasLabelsChange();
  }

  private editLabel(labelId: string): void {
    const current = this.canvasLabels.find((label) => label.id === labelId);
    if (!current) return;

    const next = window.prompt(
      "Edit label text (leave blank to delete)",
      current.text,
    );
    if (next === null) return;

    const trimmed = next.trim();
    if (!trimmed) {
      this.deleteLabel(labelId);
      return;
    }

    this.canvasLabels = this.canvasLabels.map((label) =>
      label.id === labelId ? { ...label, text: trimmed } : label,
    );
    this.rebuildLabelSprites();
    this.emitCanvasLabelsChange();
  }

  private deleteLabel(labelId: string): void {
    const next = this.canvasLabels.filter((label) => label.id !== labelId);
    if (next.length === this.canvasLabels.length) return;
    this.canvasLabels = next;
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

  private deselectCard(cardName: string, suppressEmit = false): void {
    this.selectedCards.delete(cardName);
    const data = this.getSpriteData(cardName);
    if (data) {
      data.sprite.setSelected(false);
    }
    if (!suppressEmit) {
      this.emitSelectionChange();
    }
  }

  private selectZoneCard(key: string): void {
    const data = this.zoneCardSprites.get(key);
    if (!data) return;

    if (this.selectedZoneId && this.selectedZoneId !== data.zoneId) {
      this.clearZoneSelection();
    }

    this.selectedZoneId = data.zoneId;
    this.selectedZoneCardKeys.add(key);
    data.sprite.setSelected(true);
  }

  private deselectZoneCard(key: string): void {
    this.selectedZoneCardKeys.delete(key);
    const data = this.zoneCardSprites.get(key);
    if (data) {
      data.sprite.setSelected(false);
    }
    if (this.selectedZoneCardKeys.size === 0) {
      this.selectedZoneId = null;
    }
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
      if (data.zoneId !== zoneId) continue;
      nextSelectedKeys.add(key);
    }

    for (const [key, data] of this.zoneCardSprites) {
      data.sprite.setSelected(nextSelectedKeys.has(key));
    }

    this.selectedZoneCardKeys = nextSelectedKeys;
    this.selectedZoneId = zoneId;
  }

  private clearSelection(suppressEmit = false): void {
    this.clearMainSelection(true);
    this.clearZoneSelection();
    if (!suppressEmit) {
      this.emitSelectionChange();
    }
  }

  private getSelectedCardNames(): string[] {
    const names = new Set<string>();
    for (const key of this.selectedCards) {
      const data = this.getSpriteData(key);
      if (!data) continue;
      names.add(data.layout.name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  private emitSelectionChange(): void {
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

        // Get current center position
        const centerX = data.sprite.x + cardSize.width / 2;
        const centerY = data.sprite.y + cardSize.height / 2;

        // Snap center to the appropriate snap grid
        const snappedCenter = snapCardCenter(centerX, centerY, isLandscape);

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
        data.gridKey = isDeckSprite
          ? `deck:${gridPos.x},${gridPos.y}`
          : `${isLandscape ? "L" : "P"}:${gridPos.x},${gridPos.y}`;

        // Restore original zIndex (will be recalculated by rebuildCardStacks)
        const originalZ = this.dragState.cardOriginalZIndices.get(cardName);
        if (originalZ !== undefined) {
          data.sprite.zIndex = originalZ;
        }
      }
    }

    this.rebuildCardStacks();

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
    this.zoneCardDragState.isDragging = true;
    this.zoneCardDragState.key = zoneCard.key;
    this.zoneCardDragState.zoneId = zoneCard.zoneId;
    this.zoneCardDragState.instanceId = zoneCard.instanceId;
    this.zoneCardDragState.startWorldPos = { ...worldPos };
    this.zoneCardDragState.startCardPos = {
      x: zoneCard.sprite.x,
      y: zoneCard.sprite.y,
    };

    const zone = this.canvasAreas.find((entry) => entry.id === zoneCard.zoneId);
    if (zone) {
      const instanceIndex = zone.cards.findIndex(
        (entry) => entry.id === zoneCard.instanceId,
      );
      if (instanceIndex !== -1) {
        const [instance] = zone.cards.splice(instanceIndex, 1);
        if (instance) {
          zone.cards.push(instance);
        }
      }
    }

    zoneCard.sprite.zIndex = 30000;
    this.zoneContainer.sortChildren();
  }

  private updateZoneCardDrag(worldPos: { x: number; y: number }): void {
    if (!this.zoneCardDragState.isDragging || !this.zoneCardDragState.key) return;

    const zoneCard = this.zoneCardSprites.get(this.zoneCardDragState.key);
    if (!zoneCard) return;

    const dx = worldPos.x - this.zoneCardDragState.startWorldPos.x;
    const dy = worldPos.y - this.zoneCardDragState.startWorldPos.y;

    zoneCard.sprite.x = this.zoneCardDragState.startCardPos.x + dx;
    zoneCard.sprite.y = this.zoneCardDragState.startCardPos.y + dy;
    zoneCard.bounds = {
      left: zoneCard.sprite.x,
      top: zoneCard.sprite.y,
      right: zoneCard.sprite.x + zoneCard.displaySize.width,
      bottom: zoneCard.sprite.y + zoneCard.displaySize.height,
    };
    this.drawZoneDeleteOverlay();
  }

  private endZoneCardDrag(worldPos: { x: number; y: number }): void {
    const drag = this.zoneCardDragState;
    if (!drag.zoneId || !drag.instanceId || !drag.key) {
      this.zoneCardDragState = {
        isDragging: false,
        key: null,
        zoneId: null,
        instanceId: null,
        startWorldPos: { x: 0, y: 0 },
        startCardPos: { x: 0, y: 0 },
      };
      return;
    }

    const zone = this.canvasAreas.find((entry) => entry.id === drag.zoneId);
    const zoneCard = this.zoneCardSprites.get(drag.key);
    if (!zone || !zoneCard) {
      this.zoneCardDragState = {
        isDragging: false,
        key: null,
        zoneId: null,
        instanceId: null,
        startWorldPos: { x: 0, y: 0 },
        startCardPos: { x: 0, y: 0 },
      };
      return;
    }

    const isLandscape = zoneCard.cardType === "Site";
    const snapped = snapCardCenter(
      zoneCard.sprite.x + zoneCard.displaySize.width / 2,
      zoneCard.sprite.y + zoneCard.displaySize.height / 2,
      isLandscape,
    );
    const nextX = snapped.x - zoneCard.displaySize.width / 2;
    const nextY = snapped.y - zoneCard.displaySize.height / 2;
    const nextCenter = {
      x: nextX + zoneCard.displaySize.width / 2,
      y: nextY + zoneCard.displaySize.height / 2,
    };
    const movedBoard =
      zone.type === "deck"
        ? this.getDeckBoardForPosition(zone, nextCenter) ??
          this.getDeckBoardForPosition(zone, worldPos)
        : null;
    const draggedInstance = zone.cards.find(
      (instance) => instance.id === drag.instanceId,
    );
    const fallbackBoard = this.normalizeDeckBoard(draggedInstance?.board);
    const resolvedBoard: DeckZoneBoard | null =
      zone.type === "deck" ? movedBoard ?? fallbackBoard : null;
    const movedDistance =
      Math.abs(nextX - drag.startCardPos.x) + Math.abs(nextY - drag.startCardPos.y);
    const boardChanged =
      zone.type === "deck" && resolvedBoard !== fallbackBoard;
    const hasMeaningfulMove = movedDistance >= 1 || boardChanged;

    zone.cards = zone.cards.map((instance) =>
      instance.id === drag.instanceId
        ? {
            ...instance,
            x: nextX,
            y: nextY,
            board:
              zone.type === "deck" ? resolvedBoard : instance.board,
          }
        : instance,
    );
    if (zone.type === "deck" && resolvedBoard && hasMeaningfulMove) {
      this.syncDeckVariantForBoardChange(zone, drag.instanceId, resolvedBoard);
    }
    this.reconcileCanvasAreaBounds(zone.id, { anchorBoard: resolvedBoard });
    this.zoneCardDragState = {
      isDragging: false,
      key: null,
      zoneId: null,
      instanceId: null,
      startWorldPos: { x: 0, y: 0 },
      startCardPos: { x: 0, y: 0 },
    };
    this.rebuildZoneVisuals();
    this.emitCanvasAreasChange();
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
    };

    zone.cards = [...zone.cards, duplicate];
    if (zone.type === "deck" && sourceBoard) {
      this.syncDeckVariantForBoardChange(zone, duplicate.id, sourceBoard);
    }
    this.reconcileCanvasAreaBounds(zone.id, { anchorBoard: sourceBoard });
  }

  private getDeckBoardForPosition(
    zone: CanvasArea,
    worldPos: { x: number; y: number },
  ): DeckZoneBoard | null {
    if (zone.type !== "deck") return null;
    const rects = this.getDeckBoardRects(zone.bounds, zone);
    const boards: DeckZoneBoard[] = [
      "mainboard",
      "sideboard",
    ];

    for (const board of boards) {
      const rect = rects[board];
      if (
        worldPos.x >= rect.x &&
        worldPos.x <= rect.x + rect.width &&
        worldPos.y >= rect.y &&
        worldPos.y <= rect.y + rect.height
      ) {
        return board;
      }
    }

    return null;
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

    if (useZonePlacement && entries.length > 0) {
      const headerHeight = this.getZoneHeaderHeight(zone);
      const minCenterX = entries.reduce(
        (min, entry) => Math.min(min, entry.centerX),
        Number.POSITIVE_INFINITY,
      );
      const minCenterY = entries.reduce(
        (min, entry) => Math.min(min, entry.centerY),
        Number.POSITIVE_INFINITY,
      );
      const anchorCenterX =
        zone.bounds.x +
        ZONE_BODY_PADDING +
        ZONE_DECK_BOARD_INNER_LEFT +
        CARD_SIZE.PORTRAIT.width / 2;
      const anchorCenterY =
        zone.bounds.y +
        headerHeight +
        ZONE_BODY_PADDING +
        CARD_SIZE.PORTRAIT.height / 2;
      for (const entry of entries) {
        entry.centerX = anchorCenterX + (entry.centerX - minCenterX);
        entry.centerY = anchorCenterY + (entry.centerY - minCenterY);
      }
    }

    const fallbackDeckBoard =
      zone.type === "deck"
        ? this.getDeckBoardForPosition(zone, worldPos) ?? "mainboard"
        : null;
    let anchorBoard: DeckZoneBoard | null = fallbackDeckBoard;
    const additions: CanvasCardInstance[] = [];

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
      const snapped = snapCardCenter(
        entry.centerX,
        entry.centerY,
        isLandscape,
      );
      const snappedCenter = { x: snapped.x, y: snapped.y };
      const boardForCard =
        zone.type === "deck"
          ? this.getDeckBoardForPosition(zone, snappedCenter) ??
            fallbackDeckBoard ??
            "mainboard"
          : null;
      if (zone.type === "deck" && additions.length === 0) {
        anchorBoard = boardForCard;
      }

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

    return { additions, anchorBoard };
  }

  private computeCanvasAreaBoundsFromCards(
    zone: CanvasArea,
    cards: CanvasCardInstance[],
  ): { x: number; y: number; width: number; height: number } {
    const usesDefaultMin = !(zone.type === "deck" && cards.length > 0);
    const minSize = usesDefaultMin
      ? ZONE_DEFAULT_SIZE[zone.type]
      : { width: 0, height: 0 };
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
      overlay.fill({ color: 0x4f64bf, alpha: 0.13 });
      overlay.stroke({ width: 2, color: 0xa7b5ff, alpha: 0.78 });
      overlay.roundRect(
        previewBounds.x,
        previewBounds.y,
        previewBounds.width,
        headerHeight,
        8,
      );
      overlay.fill({ color: 0x5f72cc, alpha: 0.1 });
      overlay.stroke({ width: 1, color: 0xc3cdfc, alpha: 0.58 });
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
    this.registerDeckVariantAdditions(zone, additions);

    if (zone.type === "stack") {
      this.reconcileCanvasAreaBounds(zone.id);
      this.rebuildZoneVisuals();
      this.emitCanvasAreasChange();
      return;
    }

    this.reconcileCanvasAreaBounds(zone.id, { anchorBoard });
    this.rebuildZoneVisuals();
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

    const usesDefaultMin = !(zone.type === "deck" && zone.cards.length > 0);
    const minSize = usesDefaultMin
      ? ZONE_DEFAULT_SIZE[zone.type]
      : { width: 0, height: 0 };
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

    if (zone.type === "deck" && zone.cards.length > 0) {
      const anchorBoard = options?.anchorBoard ?? null;
      if (!anchorBoard) return;

      const dx = nextX - prevX;
      const dy = nextY - prevY;
      if (dx === 0 && dy === 0) return;

      zone.cards = zone.cards.map((card) => {
        const normalizedBoard = this.normalizeDeckBoard(card.board);
        if (normalizedBoard === anchorBoard) {
          return normalizedBoard === card.board
            ? card
            : { ...card, board: normalizedBoard };
        }
        return {
          ...card,
          x: card.x + dx,
          y: card.y + dy,
          board: normalizedBoard,
        };
      });
    }
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

  private startSelectionBox(worldPos: { x: number; y: number }): void {
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
    this.selectionBox.graphics.fill({ color: 0x4488ff, alpha: 0.2 });
    this.selectionBox.graphics.stroke({ width: 2, color: 0x4488ff });
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

      this.clearSelection(true);

      if (zoneHitsById.size > 0) {
        const selectionCenter = {
          x: (selectionBounds.left + selectionBounds.right) / 2,
          y: (selectionBounds.top + selectionBounds.bottom) / 2,
        };
        const centerZoneId = this.getZoneAtPosition(selectionCenter)?.id ?? null;
        let targetZoneId =
          centerZoneId && zoneHitsById.has(centerZoneId) ? centerZoneId : null;

        if (!targetZoneId) {
          let bestCount = -1;
          for (const [zoneId, keys] of zoneHitsById) {
            if (keys.length <= bestCount) continue;
            bestCount = keys.length;
            targetZoneId = zoneId;
          }
        }

        if (targetZoneId) {
          const targetKeys = zoneHitsById.get(targetZoneId) ?? [];
          this.selectedZoneId = targetZoneId;
          for (const key of targetKeys) {
            this.selectZoneCard(key);
          }
        }
      } else {
        for (const [cardName, data] of this.cardSprites) {
          if (this.boundsIntersect(data.bounds, selectionBounds)) {
            this.selectCard(cardName, true);
          }
        }
        for (const [key, data] of this.deckSprites) {
          if (this.boundsIntersect(data.bounds, selectionBounds)) {
            this.selectCard(key, true);
          }
        }
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

  setCards(cards: Card[], options?: { filteredMode?: boolean }): void {
    const filteredMode = options?.filteredMode ?? false;
    if (!this.isInitialized) {
      this.pendingCardSet = { cards, filteredMode };
      return;
    }

    this.cards = cards;
    this.collectionFilteredMode = filteredMode;
    this.catalogHighDetailPreloadRunId += 1;
    this.catalogHighDetailPreloadStarted = false;
    this.onBackgroundTextureProgress?.(0, 0);
    this.rebuildCardSprites();
  }

  setCanvasAreas(areas: CanvasArea[]): void {
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
  }

  focusZone(zoneId: string): void {
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
      450,
    );
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
      for (const board of ["mainboard", "sideboard", "avatar"] as const) {
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

  updateArchetypeHighlight(
    archetype: string | null,
    scores: ArchetypeScores | null,
  ): void {
    // Flush any pending score saves before switching filters
    flushPendingScoreUpdates();
    this.selectedArchetype = archetype;
    this.archetypeScores = scores;
    this.applyArchetypeHighlighting();
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

    const tryFinish = () => {
      if (revealed >= totalAll && !this.initialRevealCompleted) {
        this.initialRevealCompleted = true;
        this.isRevealInProgress = false;
        this.revealFading = true;
        this.revealFadeStart = performance.now();
        this.queueVisibleHighDetailPreload();
        this.queueCatalogHighDetailPreload();
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
    this.isDestroyed = true;
    this.setHoveredCard(null);
    this.highDetailPreloadQueued = false;
    this.catalogHighDetailPreloadRunId += 1;
    this.catalogHighDetailPreloadStarted = false;
    this.onBackgroundTextureProgress?.(0, 0);
    this.onSelectionChange?.([]);

    for (const id of this.pendingRevealTimeouts) {
      clearTimeout(id);
    }
    this.pendingRevealTimeouts = [];
    this.revealRunId++;
    this.isRevealInProgress = false;
    this.closeDeckVariantDialog();
    this.closeDeckCardDeletePrompt();
    this.deactivateQuickTransfer();

    for (const data of this.labelSprites.values()) {
      data.text.destroy();
    }
    this.labelSprites.clear();
    this.clearZoneDropPreview();
    this.clearZoneVisuals();

    if (this.isInitialized) {
      this.app.ticker.stop();
      this.camera?.destroy();
      lodManager.clearCache();
      this.app.destroy(true, { children: true });
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private applyArchetypeHighlighting(): void {
    const archetype = this.selectedArchetype;
    const scores = this.archetypeScores;

    // Update collection sprites
    for (const [name, data] of this.cardSprites) {
      if (!archetype || !scores) {
        data.sprite.setArchetypeScore(null);
      } else {
        data.sprite.setArchetypeScore(scores[name]?.[archetype] ?? 0);
      }
    }

    // Update deck sprites
    for (const [, data] of this.deckSprites) {
      const name = data.layout.name;
      if (!archetype || !scores) {
        data.sprite.setArchetypeScore(null);
      } else {
        data.sprite.setArchetypeScore(scores[name]?.[archetype] ?? 0);
      }
    }
  }

  private modifyArchetypeScore(cardName: string, delta: number): void {
    if (!this.selectedArchetype || !this.archetypeScores) return;

    const newScore = updateArchetypeScore(
      this.archetypeScores,
      cardName,
      this.selectedArchetype,
      delta,
    );

    // Update the clicked card's sprite immediately
    const collectionData = this.cardSprites.get(cardName);
    if (collectionData) {
      collectionData.sprite.setArchetypeScore(newScore);
    }

    // Update any deck sprites for the same card
    for (const [, data] of this.deckSprites) {
      if (data.layout.name === cardName) {
        data.sprite.setArchetypeScore(newScore);
      }
    }

    // Persist full scores to server (debounced)
    saveScoreUpdate();
  }

  private clearZoneVisuals(): void {
    this.clearZoneDropPreview();
    this.destroyDeckGraphHoverTooltip();
    this.deactivateQuickTransfer();
    this.closeDeckCardDeletePrompt();
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
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    },
    zone: CanvasArea,
  ): {
    mainboard: { x: number; y: number; width: number; height: number };
    sideboard: { x: number; y: number; width: number; height: number };
  } {
    const bodyTop = bounds.y + this.getZoneHeaderHeight(zone) + ZONE_BODY_PADDING;
    const left = bounds.x + ZONE_BODY_PADDING;
    const width = bounds.width - ZONE_BODY_PADDING * 2;
    const boardGap = ZONE_DECK_BOARD_GAP;
    const boardBottomPadding = ZONE_DECK_BOARD_BOTTOM_PADDING;
    const minBoardHeights = {
      mainboard: ZONE_DECK_MIN_BOARD_HEIGHT.mainboard,
      sideboard: ZONE_DECK_MIN_BOARD_HEIGHT.sideboard,
    } as const;

    const maxBottomByBoard: Partial<Record<DeckZoneBoard, number>> = {};
    for (const card of zone.cards) {
      const board = this.normalizeDeckBoard(card.board);
      const isLandscape = this.isLandscapeCard(card.cardName);
      const size = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      const bottom = card.y + size.height + boardBottomPadding;
      const previous = maxBottomByBoard[board] ?? -Infinity;
      maxBottomByBoard[board] = Math.max(previous, bottom);
    }

    let cursorY = bodyTop;
    const mainboardHeight = Math.max(
      minBoardHeights.mainboard,
      (maxBottomByBoard.mainboard ?? -Infinity) - cursorY,
    );
    const mainboard = {
      x: left,
      y: cursorY,
      width,
      height: mainboardHeight,
    };
    cursorY = mainboard.y + mainboard.height + boardGap;

    const sideboardHeight = Math.max(
      minBoardHeights.sideboard,
      (maxBottomByBoard.sideboard ?? -Infinity) - cursorY,
    );
    const sideboard = {
      x: left,
      y: cursorY,
      width,
      height: sideboardHeight,
    };

    return { mainboard, sideboard };
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
    frame.fill({ color: 0x111528, alpha: 0.88 });
    frame.stroke({ width: 2, color: 0x626fb2, alpha: 0.92 });

    frame.rect(zone.bounds.x, zone.bounds.y, zone.bounds.width, headerHeight);
    frame.fill({ color: 0x1f2746, alpha: 0.96 });
    frame.stroke({ width: 1, color: 0x7d89cf, alpha: 0.88 });

    const closeBounds = {
      left: closeButtonRight - closeButtonSize,
      top: buttonTop,
      right: closeButtonRight,
      bottom: buttonTop + closeButtonSize,
    };
    const sortLeft = zone.bounds.x + buttonMargin;
    const sortBounds = {
      right: sortLeft + ZONE_SORT_BUTTON_WIDTH,
      bottom: headerBottom,
      left: sortLeft,
      top: headerBottom - ZONE_SORT_BUTTON_HEIGHT,
    };
    frame.roundRect(
      sortBounds.left,
      sortBounds.top,
      ZONE_SORT_BUTTON_WIDTH,
      ZONE_SORT_BUTTON_HEIGHT,
      6,
    );
    frame.fill({ color: 0x2a3152, alpha: 0.94 });
    frame.stroke({ width: 1, color: 0x98a4e8, alpha: 0.85 });

    const sortGlyph = this.configureTextQuality(new Text({
      text: "sort",
      style: {
        fontFamily: "Arial",
        fontSize: 11,
        fill: 0xeef2ff,
        fontWeight: "bold",
      },
    }));
    sortGlyph.x =
      sortBounds.left + (ZONE_SORT_BUTTON_WIDTH - sortGlyph.width) / 2;
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
      frame.fill({ color: 0x2a3152, alpha: 0.94 });
      frame.stroke({ width: 1, color: 0x98a4e8, alpha: 0.85 });

      filterGlyph = this.configureTextQuality(new Text({
        text: "filter",
        style: {
          fontFamily: "Arial",
          fontSize: 10,
          fill: 0xeef2ff,
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
            fill: 0xeef2ff,
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
          color: chipHovered ? 0x4257a6 : 0x2a3152,
          alpha: clause.enabled ? 0.94 : 0.65,
        });
        frame.stroke({
          width: 1,
          color: chipHovered ? 0xc6d0ff : 0x95a4e6,
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
    frame.fill({ color: 0x2a3152, alpha: 0.94 });
    frame.stroke({ width: 1, color: 0x98a4e8, alpha: 0.85 });
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
      frame.stroke({ width: 1, color: 0x5d6699, alpha: 0.56 });
      frame.rect(
        boardRects.sideboard.x,
        boardRects.sideboard.y,
        boardRects.sideboard.width,
        boardRects.sideboard.height,
      );
      frame.stroke({ width: 1, color: 0x5d6699, alpha: 0.56 });

      const collectionLabel = this.configureTextQuality(new Text({
        text: "Collection",
        style: {
          fontFamily: "Arial",
          fontSize: 13,
          fill: 0x98a3de,
          fontWeight: "bold",
        },
      }));
      collectionLabel.x = boardRects.sideboard.x + 8;
      collectionLabel.y = boardRects.sideboard.y + 6;
      collectionLabel.zIndex = frame.zIndex + 2;
      this.zoneContainer.addChild(collectionLabel);
      subzoneLabels.push(collectionLabel);
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
      avatarSprite.loadInitialTexture();
      avatarSprite.updateLOD(this.camera?.zoom ?? 0.1);
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
        fill: zone.type === "deck" ? 0xa8b5ff : zone.type === "stack" ? 0x9de5ff : 0xf1d6a0,
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
          fill: 0x9aa6de,
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
            fill: activeVariant?.id === variant.id ? 0xf6f8ff : 0xbfc8f8,
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
          color: activeVariant?.id === variant.id ? 0x3c4f99 : 0x2a3152,
          alpha: activeVariant?.id === variant.id ? 0.96 : 0.9,
        });
        frame.stroke({
          width: 1,
          color: activeVariant?.id === variant.id ? 0xbecbff : 0x7f8ed0,
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
              fill: 0xf6f8ff,
              fontWeight: "bold",
            },
          }));
          fitTabLabel(fallbackText, tabWidth - ZONE_DECK_TAB_PADDING_X * 2);

          frame.roundRect(tabCursorX, tabTop, tabWidth, ZONE_DECK_TAB_HEIGHT, 6);
          frame.fill({ color: 0x3c4f99, alpha: 0.96 });
          frame.stroke({ width: 1, color: 0xbecbff, alpha: 0.95 });

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
        frame.fill({ color: 0x2a3152, alpha: 0.9 });
        frame.stroke({ width: 1, color: 0x8d9adb, alpha: 0.8 });

        const addText = this.configureTextQuality(new Text({
          text: "+",
          style: {
            fontFamily: "Arial",
            fontSize: 16,
            fill: 0xeef2ff,
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
          sprite.setSelected(this.selectedZoneCardKeys.has(key));
          sprite.zIndex = frameData.frame.zIndex + 10 + instanceIndex;
          sprite.loadInitialTexture();
          sprite.updateLOD(this.camera?.zoom ?? 0.1);
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
    this.syncZoneSelectionVisuals();
    this.drawZoneDeleteOverlay();
  }

  private rebuildCardSprites(): void {
    this.setHoveredCard(null);

    for (const data of this.cardSprites.values()) {
      data.sprite.destroy();
    }
    for (const label of this.headerLabels) {
      label.destroy();
    }
    this.headerLabels = [];
    this.cardSprites.clear();
    this.cardContainer.removeChildren();
    this.visibleCardNames.clear();
    this.clearSelection();
    this.cardStacks.clear();

    if (this.cards.length === 0) {
      this.rebuildZoneVisuals();
      return;
    }

    const layoutCards = this.cards.map((card) => ({
      name: card.name,
      type: card.guardian.type,
      thresholdGroup: getThresholdGroup(card.guardian.thresholds),
      cost: card.guardian.cost,
      isLandscape: card.guardian.type === "Site",
      primarySet: card.sets[0]?.name,
      rarity: card.guardian.rarity as
        | "Ordinary"
        | "Exceptional"
        | "Elite"
        | "Unique"
        | null,
    }));

    const {
      cards: layout,
      headers,
      bounds: contentBounds,
    } = calculateCardLayout({
      cards: layoutCards,
      mode: this.collectionFilteredMode ? "filteredFlat" : "grouped",
    });

    const mainQuadrant = QUADRANT_BOUNDS.main;
    const targetLeft = mainQuadrant.x + MAIN_QUADRANT_CARD_PADDING;
    const targetBottom =
      mainQuadrant.y + mainQuadrant.height - MAIN_QUADRANT_CARD_PADDING;
    const offsetX = targetLeft - contentBounds.left;
    const offsetY = targetBottom - contentBounds.bottom;
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
    if (shiftedLayout.length > 0 && this.camera) {
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
          fontSize: isTypeSubgroup ? subgroupFontSize : HEADER_HEIGHT,
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
    this.rebuildZoneVisuals();

    // Rebuild deck display if a deck is active
    if (this.activeDeck) {
      this.rebuildDeckSprites();
    }
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
        cost: card.guardian.cost,
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
      collectionBottom: this.collectionBounds.bottom,
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

    this.performCulling();
  }

  private handleZoomChange(zoom: number): void {
    for (const name of this.visibleCardNames) {
      const data = this.cardSprites.get(name);
      if (data) {
        data.sprite.updateLOD(zoom);
      }
    }
    // Update deck sprite LODs
    for (const data of this.deckSprites.values()) {
      if (data.sprite.visible) {
        data.sprite.updateLOD(zoom);
      }
    }
    for (const data of this.zoneCardSprites.values()) {
      data.sprite.updateLOD(zoom);
    }
    this.queueVisibleHighDetailPreload();
  }

  private handleViewportChange(): void {
    this.scheduleCulling();
    this.drawGrid();
    if (this.camera) {
      this.onViewportCenterChange?.(this.camera.getScreenCenter());
    }
  }

  private scheduleCulling(): void {
    if (this.cullingScheduled) return;

    const now = performance.now();
    const elapsed = now - this.lastCullingUpdate;

    if (elapsed >= CULLING_THROTTLE_MS) {
      this.performCulling();
    } else {
      this.cullingScheduled = true;
      setTimeout(() => {
        this.cullingScheduled = false;
        this.performCulling();
      }, CULLING_THROTTLE_MS - elapsed);
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
  }

  private shouldLoadHighDetail(): boolean {
    if (this.isRevealInProgress || !this.initialRevealCompleted) return false;
    if (isConstrainedTextureDevice()) {
      return (this.camera?.zoom ?? 0) >= LOD_ZOOM_THRESHOLDS.MEDIUM_MAX;
    }
    return true;
  }

  private getVisibleCardNamesForHighDetail(): string[] {
    const names = new Set<string>();
    for (const name of this.visibleCardNames) {
      names.add(name);
    }
    for (const [, data] of this.deckSprites) {
      if (data.sprite.visible) {
        names.add(data.layout.name);
      }
    }
    return [...names];
  }

  private queueVisibleHighDetailPreload(): void {
    if (this.isDestroyed) return;
    if (!this.shouldLoadHighDetail()) {
      this.onBackgroundTextureProgress?.(0, 0);
      return;
    }

    if (this.highDetailPreloadRunning) {
      this.highDetailPreloadQueued = true;
      return;
    }

    void this.runVisibleHighDetailPreload();
  }

  private queueCatalogHighDetailPreload(): void {
    if (this.isDestroyed) return;
    if (!this.shouldLoadHighDetail()) return;
    if (!shouldPreloadFullTextureCatalog()) return;
    if (this.catalogHighDetailPreloadStarted) return;

    const allNames = this.cards.map((card) => card.name);
    if (allNames.length === 0) return;

    this.catalogHighDetailPreloadStarted = true;
    const runId = this.catalogHighDetailPreloadRunId;
    void this.runCatalogHighDetailPreload(allNames, runId);
  }

  private async runVisibleHighDetailPreload(): Promise<void> {
    if (!this.shouldLoadHighDetail()) {
      this.onBackgroundTextureProgress?.(0, 0);
      return;
    }

    const names = this.getVisibleCardNamesForHighDetail();
    const loadOptions = getHighDetailLoadOptions();
    this.highDetailPreloadRunning = true;

    try {
      await lodManager.preloadTextures(names, {
        lod: LOD_LEVELS.FULL,
        concurrentLoads: loadOptions.concurrentLoads,
        batchSize: loadOptions.batchSize,
        onProgress: (loaded, total) => {
          if (this.isDestroyed) return;
          this.onBackgroundTextureProgress?.(loaded, total);
        },
      });
    } finally {
      this.highDetailPreloadRunning = false;
      if (this.highDetailPreloadQueued) {
        this.highDetailPreloadQueued = false;
        this.queueVisibleHighDetailPreload();
      }
    }
  }

  private async runCatalogHighDetailPreload(
    cardNames: string[],
    runId: number,
  ): Promise<void> {
    try {
      await lodManager.preloadFullTextures(cardNames, (loaded, total) => {
        if (this.isDestroyed) return;
        if (runId !== this.catalogHighDetailPreloadRunId) return;
        this.onBackgroundTextureProgress?.(loaded, total);
      });
    } catch {
      // Keep UI responsive even if individual texture loads fail.
    } finally {
      if (runId === this.catalogHighDetailPreloadRunId) {
        this.onBackgroundTextureProgress?.(0, 0);
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
