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
import type {
  Card,
  Deck,
  ActiveBoard,
  CollectionItem,
  CanvasLabel,
  CardType,
} from "@/data/dataModels";
import {
  updateArchetypeScore,
  saveScoreUpdate,
  flushPendingScoreUpdates,
  type ArchetypeScores,
} from "@/data/archetypeScores";
import { getThresholdGroup } from "@/data/dataModels";
import {
  QUADRANT_BOUNDS,
  ZONE_DECK_HEADER_HEIGHT,
  ZONE_DEFAULT_SIZE,
  ZONE_HEADER_HEIGHT,
  sanitizeDeckZoneName,
  type ZoneModel,
  type ZoneCardInstance,
} from "@/zones/zones";

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
  onZonesChange?: (zones: ZoneModel[]) => void;
  onStackZoneHeaderClick?: (zoneId: string) => void;
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

interface ZoneHeaderData {
  bounds: { left: number; top: number; right: number; bottom: number };
  closeBounds: { left: number; top: number; right: number; bottom: number };
  sortBounds: { left: number; top: number; right: number; bottom: number };
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

interface DraggedCardPlacement {
  cardName: string;
  centerX: number;
  centerY: number;
}

// ============================================================================
// Constants
// ============================================================================

const CULLING_MARGIN = 300;
const CULLING_THROTTLE_MS = 50;
const DOUBLE_CLICK_TIME_MS = 300;
const INITIAL_REVEAL_CONCURRENT_LOADS = 24;
const ATLAS_CARD_REVEAL_SPREAD_MS = 300;
const ON_DEMAND_HIGH_DETAIL_CONCURRENT_LOADS = 6;
const ON_DEMAND_HIGH_DETAIL_BATCH_SIZE = 24;
const ZONE_BODY_PADDING = 14;
const ZONE_AUTO_EXPAND_PADDING = 24;
const ZONE_DELETE_SIZE = 18;
const MAIN_QUADRANT_CARD_PADDING = 220;
const ZONE_DECK_BOARD_GAP = 10;
const ZONE_DECK_BOARD_INNER_LEFT = 12;
const ZONE_DECK_CARD_TOP_GAP = DRAWN_GRID.height;
const ZONE_DECK_BOARD_BOTTOM_PADDING = 10;
const ZONE_DECK_TYPE_GAP = Math.round(DRAWN_GRID.height * 0.5);
const ZONE_SORT_BUTTON_WIDTH = 48;
const ZONE_SORT_BUTTON_HEIGHT = 20;
const ZONE_DECK_AVATAR_CENTER_GRID_X = 1;
const ZONE_DECK_AVATAR_CENTER_GRID_Y = 2;
const ZONE_DECK_AVATAR_TITLE_GAP = 20;
const ZONE_DECK_HEADER_X_OFFSET = DRAWN_GRID.width * 0.5;
const ZONE_DECK_MIN_BOARD_HEIGHT = {
  mainboard: CARD_SIZE.PORTRAIT.height + ZONE_DECK_CARD_TOP_GAP + 6,
  sideboard: CARD_SIZE.PORTRAIT.height + ZONE_DECK_CARD_TOP_GAP - 6,
  maybeboard: CARD_SIZE.PORTRAIT.height + ZONE_DECK_CARD_TOP_GAP - 2,
} as const;
const ZONE_SORT_TYPE_ORDER: Record<CardType, number> = {
  Minion: 0,
  Magic: 1,
  Aura: 2,
  Artifact: 3,
  Site: 4,
  Avatar: 5,
};

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
      subzoneLabels: Text[];
      avatarSprite: CardSprite | null;
    }
  > = new Map();
  private zoneHeaderBounds: Map<string, ZoneHeaderData> = new Map();
  private zoneDeleteOverlay: Graphics | null = null;
  private zoneDropPreviewOverlay: Graphics | null = null;
  private zoneDropPreviewSprites: CardSprite[] = [];
  private zoneDropPreviewSignature: string | null = null;
  private hoveredZoneCardKey: string | null = null;
  private zones: ZoneModel[] = [];
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

  // Callbacks
  private onAddToDeck: (cardName: string) => void;
  private onRemoveFromDeck: (cardName: string) => void;
  private onTextureProgress?: (loaded: number, total: number) => void;
  private onBackgroundTextureProgress?: (loaded: number, total: number) => void;
  private onSelectionChange?: (selectedCardNames: string[]) => void;
  private onCanvasLabelsChange?: (labels: CanvasLabel[]) => void;
  private onLabelPlacementConsumed?: () => void;
  private onHoveredCardChange?: (cardName: string | null) => void;
  private onZonesChange?: (zones: ZoneModel[]) => void;
  private onStackZoneHeaderClick?: (zoneId: string) => void;
  private onCardDragDrop?: (payload: CardDragDropPayload) => void;
  private hoveredCardName: string | null = null;

  constructor(config: PixiStageConfig) {
    this.onAddToDeck = config.onAddToDeck;
    this.onRemoveFromDeck = config.onRemoveFromDeck;
    this.onTextureProgress = config.onTextureProgress;
    this.onBackgroundTextureProgress = config.onBackgroundTextureProgress;
    this.onSelectionChange = config.onSelectionChange;
    this.onCanvasLabelsChange = config.onCanvasLabelsChange;
    this.onLabelPlacementConsumed = config.onLabelPlacementConsumed;
    this.onHoveredCardChange = config.onHoveredCardChange;
    this.onZonesChange = config.onZonesChange;
    this.onStackZoneHeaderClick = config.onStackZoneHeaderClick;
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
      resolution: window.devicePixelRatio || 1,
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
    // Zones always render above source cards.
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
    this.zoneDropPreviewOverlay = new Graphics();
    this.zoneDropPreviewContainer.addChild(this.zoneDropPreviewOverlay);

    this.setupPointerEvents();

    this.app.ticker.add(this.update.bind(this));

    this.isInitialized = true;

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
      this.hoveredZoneCardKey = null;
      this.drawZoneDeleteOverlay();
    });

    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.app.canvas.addEventListener("pointerleave", () => {
      this.setHoveredCard(null);
      this.setStacksDropVisual(false);
      this.clearZoneDropPreview();
      this.hoveredZoneCardKey = null;
      this.drawZoneDeleteOverlay();
    });
  }

  private setHoveredCard(cardName: string | null): void {
    if (this.hoveredCardName === cardName) return;
    this.hoveredCardName = cardName;
    this.onHoveredCardChange?.(cardName);
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

    const stackTarget = dropTarget.closest("[data-stack-zone-id]");
    if (!(stackTarget instanceof HTMLElement)) return null;

    const zoneId = stackTarget.dataset.stackZoneId;
    if (!zoneId) return null;

    const matching = this.zones.find(
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

  private cloneZones(zones: ZoneModel[]): ZoneModel[] {
    return zones.map((zone) => ({
      ...zone,
      bounds: { ...zone.bounds },
      cards: zone.cards.map((card) => ({ ...card })),
    }));
  }

  private emitZonesChange(): void {
    this.onZonesChange?.(this.cloneZones(this.zones));
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

  private getZoneDisplayName(zone: ZoneModel): string {
    if (zone.type !== "deck") {
      return zone.name;
    }
    return sanitizeDeckZoneName(zone.name);
  }

  private isLandscapeCard(cardName: string): boolean {
    return this.getCardType(cardName) === "Site";
  }

  private getZoneHeaderHeight(zone: ZoneModel): number {
    return zone.type === "deck" ? ZONE_DECK_HEADER_HEIGHT : ZONE_HEADER_HEIGHT;
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

  private getZoneAtPosition(worldPos: { x: number; y: number }): ZoneModel | null {
    const pinnedZones = this.zones.filter((zone) => zone.pinned);
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

  private getZoneHeaderAtPosition(worldPos: { x: number; y: number }): ZoneModel | null {
    const pinnedZones = this.zones.filter((zone) => zone.pinned);
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
  ): ZoneModel | null {
    const pinnedZones = this.zones.filter((zone) => zone.pinned);
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
  ): ZoneModel | null {
    const pinnedZones = this.zones.filter((zone) => zone.pinned);
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

  private layoutZoneBoardCards(
    cards: ZoneCardInstance[],
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
        instances: ZoneCardInstance[];
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
    const zone = this.zones.find((entry) => entry.id === zoneId);
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
      const boardOrder: Array<Exclude<ActiveBoard, "avatar">> = [
        "mainboard",
        "sideboard",
        "maybeboard",
      ];

      for (const board of boardOrder) {
        const boardCards = nextCards.filter((card) => {
          const normalizedBoard =
            card.board === "mainboard" ||
            card.board === "sideboard" ||
            card.board === "maybeboard"
              ? card.board
              : "mainboard";
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
    this.reconcileZoneBounds(zone.id, { preserveTopLeft: true });
    this.rebuildZoneVisuals();
    if (options?.emitChange ?? true) {
      this.emitZonesChange();
    }
  }

  private hideZoneFromCanvas(zoneId: string): void {
    const zone = this.zones.find((entry) => entry.id === zoneId);
    if (!zone || !zone.pinned) return;
    zone.pinned = false;
    this.rebuildZoneVisuals();
    this.emitZonesChange();
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

  private drawZoneDeleteOverlay(): void {
    if (!this.zoneDeleteOverlay) return;
    this.zoneDeleteOverlay.clear();

    if (!this.hoveredZoneCardKey) return;
    const data = this.zoneCardSprites.get(this.hoveredZoneCardKey);
    if (!data) return;

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

  private updateHoveredFromWorldPos(worldPos: { x: number; y: number }): void {
    const zoneCard = this.getZoneCardAtPosition(worldPos);
    const zoneUnderPointer = this.getZoneAtPosition(worldPos);

    this.hoveredZoneCardKey = zoneCard?.key ?? null;
    this.drawZoneDeleteOverlay();

    if (zoneCard) {
      this.setHoveredCard(zoneCard.cardName);
      return;
    }

    if (zoneUnderPointer) {
      this.setHoveredCard(null);
      return;
    }

    const cardKey = this.getCardAtPosition(worldPos);
    if (!cardKey) {
      this.setHoveredCard(null);
      return;
    }

    const data = this.getSpriteData(cardKey);
    this.setHoveredCard(data?.layout.name ?? null);
  }

  private onPointerDown(event: FederatedPointerEvent): void {
    if (!this.camera) return;

    const isRightClick = event.button === 2;
    const isCtrlHeld = event.ctrlKey || event.metaKey;
    const isShiftHeld = event.shiftKey;

    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);
    this.clearZoneDropPreview();
    const clickedZoneSort = this.getZoneSortTargetAtPosition(worldPos);
    if (!isRightClick && clickedZoneSort) {
      this.cancelSelectionBox();
      this.sortZoneCards(clickedZoneSort.id);
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
      const deleteBounds = this.getDeleteButtonBounds(clickedZoneCard);
      if (this.pointInBounds(worldPos, deleteBounds)) {
        this.removeZoneCardInstance(clickedZoneCard.zoneId, clickedZoneCard.instanceId);
        this.emitZonesChange();
        this.hoveredZoneCardKey = null;
        this.drawZoneDeleteOverlay();
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
        this.duplicateZoneCardInstance(
          clickedZoneCard.zoneId,
          clickedZoneCard.instanceId,
        );
        this.emitZonesChange();
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
          this.onAddToDeck(clickedCard);
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
    } else {
      this.clearZoneDropPreview();
    }

    this.updateHoveredFromWorldPos(worldPos);
  }

  private onPointerUp(event: FederatedPointerEvent): void {
    if (!this.camera) return;

    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);
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

    const zone = this.zones.find((entry) => entry.id === zoneCard.zoneId);
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

    const zone = this.zones.find((entry) => entry.id === drag.zoneId);
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
    const fallbackBoard =
      draggedInstance?.board === "mainboard" ||
      draggedInstance?.board === "sideboard" ||
      draggedInstance?.board === "maybeboard"
        ? draggedInstance.board
        : "mainboard";
    const resolvedBoard = zone.type === "deck" ? movedBoard ?? fallbackBoard : null;

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
    this.reconcileZoneBounds(zone.id, { anchorBoard: resolvedBoard });
    this.zoneCardDragState = {
      isDragging: false,
      key: null,
      zoneId: null,
      instanceId: null,
      startWorldPos: { x: 0, y: 0 },
      startCardPos: { x: 0, y: 0 },
    };
    this.rebuildZoneVisuals();
    this.emitZonesChange();
  }

  private startZoneDrag(zoneId: string, worldPos: { x: number; y: number }): void {
    const zone = this.zones.find((entry) => entry.id === zoneId);
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

    const zone = this.zones.find((entry) => entry.id === this.zoneDragState.zoneId);
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

    const zone = this.zones.find((entry) => entry.id === this.zoneDragState.zoneId);
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
    this.emitZonesChange();
  }

  private removeZoneCardInstance(zoneId: string, instanceId: string): void {
    const zone = this.zones.find((entry) => entry.id === zoneId);
    if (!zone) return;

    zone.cards = zone.cards.filter((entry) => entry.id !== instanceId);
    this.reconcileZoneBounds(zone.id);
    this.rebuildZoneVisuals();
  }

  private duplicateZoneCardInstance(zoneId: string, instanceId: string): void {
    const zone = this.zones.find((entry) => entry.id === zoneId);
    if (!zone) return;
    if (zone.type === "stack") return;

    const source = zone.cards.find((entry) => entry.id === instanceId);
    if (!source) return;

    const sourceBoard =
      zone.type === "deck" &&
      (source.board === "mainboard" ||
        source.board === "sideboard" ||
        source.board === "maybeboard")
        ? source.board
        : zone.type === "deck"
          ? "mainboard"
          : null;

    const duplicate: ZoneCardInstance = {
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
    this.reconcileZoneBounds(zone.id, { anchorBoard: sourceBoard });
    this.rebuildZoneVisuals();
  }

  private getDeckBoardForPosition(
    zone: ZoneModel,
    worldPos: { x: number; y: number },
  ): Exclude<ActiveBoard, "avatar"> | null {
    if (zone.type !== "deck") return null;
    const rects = this.getDeckBoardRects(zone.bounds, zone);
    const boards: Array<Exclude<ActiveBoard, "avatar">> = [
      "mainboard",
      "sideboard",
      "maybeboard",
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
    zone: ZoneModel,
    cardNames: string[],
    worldPos: { x: number; y: number },
    options?: {
      useZonePlacement?: boolean;
      placements?: DraggedCardPlacement[];
      previewIds?: boolean;
    },
  ): {
    additions: ZoneCardInstance[];
    anchorBoard: Exclude<ActiveBoard, "avatar"> | null;
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
    let anchorBoard: Exclude<ActiveBoard, "avatar"> | null = fallbackDeckBoard;
    const additions: ZoneCardInstance[] = [];

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

  private computeZoneBoundsFromCards(
    zone: ZoneModel,
    cards: ZoneCardInstance[],
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
    zone: ZoneModel | null,
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

    const previewBounds = this.computeZoneBoundsFromCards(zone, [
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
    const zone = this.zones.find((entry) => entry.id === zoneId);
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

    if (zone.type === "stack") {
      this.reconcileZoneBounds(zone.id);
      this.rebuildZoneVisuals();
      this.emitZonesChange();
      return;
    }

    this.reconcileZoneBounds(zone.id, { anchorBoard });
    this.rebuildZoneVisuals();
    this.emitZonesChange();
  }

  private reconcileZoneBounds(
    zoneId: string,
    options?: {
      anchorBoard?: ActiveBoard | null;
      preserveTopLeft?: boolean;
    },
  ): void {
    const zone = this.zones.find((entry) => entry.id === zoneId);
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
      const anchorBoard =
        options?.anchorBoard === "mainboard" ||
        options?.anchorBoard === "sideboard" ||
        options?.anchorBoard === "maybeboard"
          ? options.anchorBoard
          : null;
      if (!anchorBoard) return;

      const dx = nextX - prevX;
      const dy = nextY - prevY;
      if (dx === 0 && dy === 0) return;

      zone.cards = zone.cards.map((card) => {
        if (card.board === anchorBoard) return card;
        return {
          ...card,
          x: card.x + dx,
          y: card.y + dy,
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
    this.rebuildCardSprites();
  }

  setZones(zones: ZoneModel[]): void {
    this.zones = this.cloneZones(zones);
    this.clearZoneDropPreview();
    this.rebuildZoneVisuals();
  }

  focusZone(zoneId: string): void {
    if (!this.camera) return;
    const zone = this.zones.find((entry) => entry.id === zoneId && entry.pinned);
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
    const workerCount = Math.min(INITIAL_REVEAL_CONCURRENT_LOADS, queue.length);

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
    this.onBackgroundTextureProgress?.(0, 0);
    this.onSelectionChange?.([]);

    for (const id of this.pendingRevealTimeouts) {
      clearTimeout(id);
    }
    this.pendingRevealTimeouts = [];
    this.revealRunId++;
    this.isRevealInProgress = false;

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
    zone: ZoneModel,
  ): {
    mainboard: { x: number; y: number; width: number; height: number };
    sideboard: { x: number; y: number; width: number; height: number };
    maybeboard: { x: number; y: number; width: number; height: number };
  } {
    const bodyTop = bounds.y + this.getZoneHeaderHeight(zone) + ZONE_BODY_PADDING;
    const left = bounds.x + ZONE_BODY_PADDING;
    const width = bounds.width - ZONE_BODY_PADDING * 2;
    const boardGap = ZONE_DECK_BOARD_GAP;
    const boardBottomPadding = ZONE_DECK_BOARD_BOTTOM_PADDING;
    const minBoardHeights = {
      mainboard: ZONE_DECK_MIN_BOARD_HEIGHT.mainboard,
      sideboard: ZONE_DECK_MIN_BOARD_HEIGHT.sideboard,
      maybeboard: ZONE_DECK_MIN_BOARD_HEIGHT.maybeboard,
    } as const;

    const maxBottomByBoard: Partial<
      Record<Exclude<ActiveBoard, "avatar">, number>
    > = {};
    for (const card of zone.cards) {
      if (
        card.board !== "mainboard" &&
        card.board !== "sideboard" &&
        card.board !== "maybeboard"
      ) {
        continue;
      }
      const isLandscape = this.isLandscapeCard(card.cardName);
      const size = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      const bottom = card.y + size.height + boardBottomPadding;
      const previous = maxBottomByBoard[card.board] ?? -Infinity;
      maxBottomByBoard[card.board] = Math.max(previous, bottom);
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
    cursorY = sideboard.y + sideboard.height + boardGap;

    const maybeboardHeight = Math.max(
      minBoardHeights.maybeboard,
      (maxBottomByBoard.maybeboard ?? -Infinity) - cursorY,
    );
    const maybeboard = {
      x: left,
      y: cursorY,
      width,
      height: maybeboardHeight,
    };

    return { mainboard, sideboard, maybeboard };
  }

  private drawZoneFrame(
    zone: ZoneModel,
    zoneIndex: number,
  ): {
    frame: Graphics;
    title: Text;
    subzoneLabels: Text[];
    avatarSprite: CardSprite | null;
  } {
    const frame = new Graphics();
    const headerHeight = this.getZoneHeaderHeight(zone);
    const closeButtonSize = Math.max(20, Math.min(32, headerHeight - 16));
    const buttonMargin = 6;
    const buttonTop = zone.bounds.y + buttonMargin;
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
    const sortAnchorLeft =
      zone.type === "deck" && zone.avatarCardName
        ? zone.bounds.x +
          ZONE_DECK_AVATAR_CENTER_GRID_X * DRAWN_GRID.width +
          ZONE_DECK_HEADER_X_OFFSET -
          DECK_AVATAR_SIZE.width / 2 +
          DECK_AVATAR_SIZE.width +
          ZONE_DECK_AVATAR_TITLE_GAP
        : zone.type === "deck"
          ? zone.bounds.x + 10 + ZONE_DECK_HEADER_X_OFFSET
          : zone.bounds.x + 10;
    const minSortLeft = zone.bounds.x + buttonMargin;
    const maxSortLeft = closeBounds.left - buttonMargin - ZONE_SORT_BUTTON_WIDTH;
    const sortLeft = Math.max(
      minSortLeft,
      Math.min(sortAnchorLeft, maxSortLeft),
    );
    const sortBounds = {
      right: sortLeft + ZONE_SORT_BUTTON_WIDTH,
      bottom: zone.bounds.y + headerHeight - buttonMargin,
      left: sortLeft,
      top:
        zone.bounds.y +
        headerHeight -
        buttonMargin -
        ZONE_SORT_BUTTON_HEIGHT,
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

    const sortGlyph = new Text({
      text: "sort",
      style: {
        fontFamily: "Arial",
        fontSize: 11,
        fill: 0xeef2ff,
        fontWeight: "bold",
      },
    });
    sortGlyph.x =
      sortBounds.left + (ZONE_SORT_BUTTON_WIDTH - sortGlyph.width) / 2;
    sortGlyph.y =
      sortBounds.top + (ZONE_SORT_BUTTON_HEIGHT - sortGlyph.height) / 2 - 1;
    sortGlyph.zIndex = frame.zIndex + 2;

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

    const subzoneLabels: Text[] = [sortGlyph];
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
      frame.rect(
        boardRects.maybeboard.x,
        boardRects.maybeboard.y,
        boardRects.maybeboard.width,
        boardRects.maybeboard.height,
      );
      frame.stroke({ width: 1, color: 0x5d6699, alpha: 0.56 });

      const labels: Array<{
        text: string;
        x: number;
        y: number;
      }> = [
        {
          text: "Mainboard",
          x: boardRects.mainboard.x + 8,
          y: boardRects.mainboard.y + 6,
        },
        {
          text: "Sideboard",
          x: boardRects.sideboard.x + 8,
          y: boardRects.sideboard.y + 6,
        },
        {
          text: "Maybeboard",
          x: boardRects.maybeboard.x + 8,
          y: boardRects.maybeboard.y + 6,
        },
      ];

      for (const labelInfo of labels) {
        const label = new Text({
          text: labelInfo.text,
          style: {
            fontFamily: "Arial",
            fontSize: 13,
            fill: 0x98a3de,
            fontWeight: "bold",
          },
        });
        label.x = labelInfo.x;
        label.y = labelInfo.y;
        label.zIndex = frame.zIndex + 2;
        this.zoneContainer.addChild(label);
        subzoneLabels.push(label);
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
      avatarSprite.loadInitialTexture();
      avatarSprite.updateLOD(this.camera?.zoom ?? 0.1);
      this.zoneContainer.addChild(avatarSprite);
      titleX = avatarLeft + avatarWidth + ZONE_DECK_AVATAR_TITLE_GAP;
      deckHeaderTopY = avatarTop;
    }

    const titleText = this.getZoneDisplayName(zone);
    const title = new Text({
      text: titleText,
      style: {
        fontFamily: "Arial",
        fontSize: HEADER_HEIGHT * 0.3,
        fill: zone.type === "deck" ? 0xa8b5ff : zone.type === "stack" ? 0x9de5ff : 0xf1d6a0,
        fontWeight: "bold",
      },
    });
    title.x = titleX;
    if (zone.type === "deck" && zone.deckAuthor) {
      title.y = deckHeaderTopY ?? zone.bounds.y + 8;
      const author = new Text({
        text: zone.deckAuthor,
        style: {
          fontFamily: "Arial",
          fontSize: 12,
          fill: 0x9aa6de,
          fontWeight: "normal",
        },
      });
      author.x = titleX;
      author.y = title.y + title.height + 2;
      author.zIndex = frame.zIndex + 2;
      this.zoneContainer.addChild(author);
      subzoneLabels.push(author);
    } else if (zone.type === "deck" && deckHeaderTopY !== null) {
      title.y = deckHeaderTopY;
    } else {
      title.y = zone.bounds.y + Math.max(4, (headerHeight - title.height) / 2);
    }
    title.zIndex = frame.zIndex + 2;

    this.zoneContainer.addChild(frame);
    this.zoneContainer.addChild(sortGlyph);
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
    });

    return { frame, title, subzoneLabels, avatarSprite };
  }

  private rebuildZoneVisuals(): void {
    this.clearZoneVisuals();
    if (!this.camera) return;

    const pinnedZones = this.zones.filter((zone) => zone.pinned);
    pinnedZones.forEach((zone, zoneIndex) => {
      const frameData = this.drawZoneFrame(zone, zoneIndex);
      this.zoneFrames.set(zone.id, frameData);

      const stacks = new Map<string, ZoneCardInstance[]>();
      for (const instance of zone.cards) {
        const isLandscape = this.isLandscapeCard(instance.cardName);
        const size = isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
        const centerX = instance.x + size.width / 2;
        const centerY = instance.y + size.height / 2;
        const grid = pixelsToSnapGrid(centerX, centerY, isLandscape);
        const stackKey = `${instance.board ?? "zone"}:${
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
    if (!this.camera) return false;
    if (this.isRevealInProgress || !this.initialRevealCompleted) return false;
    return this.camera.zoom >= LOD_ZOOM_THRESHOLDS.MEDIUM_MAX;
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

  private async runVisibleHighDetailPreload(): Promise<void> {
    if (!this.shouldLoadHighDetail()) {
      this.onBackgroundTextureProgress?.(0, 0);
      return;
    }

    const names = this.getVisibleCardNamesForHighDetail();
    this.highDetailPreloadRunning = true;

    try {
      await lodManager.preloadTextures(names, {
        lod: LOD_LEVELS.FULL,
        concurrentLoads: ON_DEMAND_HIGH_DETAIL_CONCURRENT_LOADS,
        batchSize: ON_DEMAND_HIGH_DETAIL_BATCH_SIZE,
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
    // Reveal animation: smooth fade from 0.5 → 1.0 over 500ms
    if (this.revealFading) {
      const elapsed = performance.now() - this.revealFadeStart;
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
