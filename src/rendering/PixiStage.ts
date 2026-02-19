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

import { Application, Container, Graphics, Text, FederatedPointerEvent } from 'pixi.js';
import { Camera, type CameraBounds } from './Camera';
import { CardSprite, type CardSpriteState } from './CardSprite';
import {
  calculateCardLayout,
  calculateDeckLayout,
  DRAWN_GRID,
  CARD_SIZE,
  GRID_LINE,
  HEADER_HEIGHT,
  STACK_OFFSET,
  snapCardCenter,
  pixelsToSnapGrid,
  type CardLayoutInfo,
  type ContentBounds,
} from './Grid';
import { lodManager } from './LODManager';
import type {
  Card,
  Deck,
  ActiveBoard,
  CollectionItem,
} from '@/data/dataModels';
import { updateArchetypeScore, saveArchetypeScores, type ArchetypeScores } from '@/data/archetypeScores';
import { getThresholdGroup } from '@/data/dataModels';

// ============================================================================
// Types
// ============================================================================

export interface PixiStageConfig {
  container: HTMLElement;
  onAddToDeck: (cardName: string) => void;
  onRemoveFromDeck: (cardName: string) => void;
}

interface CardSpriteData {
  sprite: CardSprite;
  bounds: { left: number; top: number; right: number; bottom: number };
  layout: CardLayoutInfo;
  gridKey: string;
  basePosition: { x: number; y: number }; // Position without stack offset
}

interface DragState {
  isDragging: boolean;
  draggedCards: Set<string>;
  startWorldPos: { x: number; y: number };
  cardStartPositions: Map<string, { x: number; y: number }>;
  cardOriginalZIndices: Map<string, number>;
}

interface SelectionBoxState {
  isActive: boolean;
  startWorldPos: { x: number; y: number } | null;
  graphics: Graphics | null;
}

// ============================================================================
// Constants
// ============================================================================

const CULLING_MARGIN = 300;
const CULLING_THROTTLE_MS = 50;
const DOUBLE_CLICK_TIME_MS = 300;

// ============================================================================
// PixiStage Class
// ============================================================================

export class PixiStage {
  private app: Application;
  private camera: Camera | null = null;
  private cardContainer: Container;
  private gridGraphics: Graphics | null = null;
  private cardSprites: Map<string, CardSpriteData> = new Map();
  private cards: Card[] = [];
  private isInitialized = false;
  private isDestroyed = false;
  private pendingCards: Card[] | null = null;

  // Culling state
  private lastCullingUpdate = 0;
  private visibleCardNames: Set<string> = new Set();
  private cullingScheduled = false;

  // Selection state
  private selectedCards: Set<string> = new Set();

  // Drag state
  private dragState: DragState = {
    isDragging: false,
    draggedCards: new Set(),
    startWorldPos: { x: 0, y: 0 },
    cardStartPositions: new Map(),
    cardOriginalZIndices: new Map(),
  };
  private pointerDownOnSelectedCard = false;

  // Selection box state
  private selectionBox: SelectionBoxState = {
    isActive: false,
    startWorldPos: null,
    graphics: null,
  };

  // Double-click detection
  private lastClickTime = 0;
  private lastClickedCard: string | null = null;

  // Card stacking - track cards at each grid position
  private cardStacks: Map<string, string[]> = new Map();

  // Group header labels
  private headerLabels: Text[] = [];

  // Deck display state
  private deckSprites: Map<string, CardSpriteData> = new Map();
  private deckHeaderLabels: Text[] = [];
  private collectionBounds: ContentBounds = { left: 0, top: 0, right: 0, bottom: 0 };
  private activeDeck: Deck | null = null;

  // Archetype highlighting state
  private archetypeScores: ArchetypeScores | null = null;
  private selectedArchetype: string | null = null;

  // Callbacks
  private onAddToDeck: (cardName: string) => void;
  private onRemoveFromDeck: (cardName: string) => void;

  constructor(config: PixiStageConfig) {
    this.onAddToDeck = config.onAddToDeck;
    this.onRemoveFromDeck = config.onRemoveFromDeck;

    this.app = new Application();
    this.cardContainer = new Container();
    this.cardContainer.sortableChildren = true;

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
      powerPreference: 'high-performance',
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

    // Add card container
    this.camera.container.addChild(this.cardContainer);

    // Create selection box graphics (on top)
    this.selectionBox.graphics = new Graphics();
    this.camera.container.addChild(this.selectionBox.graphics);

    this.setupPointerEvents();

    this.app.ticker.add(this.update.bind(this));

    this.isInitialized = true;

    if (this.pendingCards) {
      this.cards = this.pendingCards;
      this.pendingCards = null;
      this.rebuildCardSprites();
    }
  }

  // ============================================================================
  // Grid Drawing
  // ============================================================================

  private drawGrid(): void {
    if (!this.gridGraphics || !this.camera) return;

    this.gridGraphics.clear();

    const bounds = this.camera.getVisibleBounds();

    const startX = Math.floor(bounds.left / DRAWN_GRID.width) * DRAWN_GRID.width;
    const startY = Math.floor(bounds.top / DRAWN_GRID.height) * DRAWN_GRID.height;
    const endX = Math.ceil(bounds.right / DRAWN_GRID.width) * DRAWN_GRID.width;
    const endY = Math.ceil(bounds.bottom / DRAWN_GRID.height) * DRAWN_GRID.height;

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
  }

  // ============================================================================
  // Pointer Event Setup
  // ============================================================================

  private setupPointerEvents(): void {
    if (!this.camera) return;

    const viewport = this.camera.viewport;
    viewport.eventMode = 'static';

    viewport.on('pointerdown', this.onPointerDown.bind(this));
    viewport.on('pointermove', this.onPointerMove.bind(this));
    viewport.on('pointerup', this.onPointerUp.bind(this));
    viewport.on('pointerupoutside', this.onPointerUp.bind(this));

    this.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onPointerDown(event: FederatedPointerEvent): void {
    if (!this.camera) return;

    const isRightClick = event.button === 2;
    const isCtrlHeld = event.ctrlKey || event.metaKey;
    const isShiftHeld = event.shiftKey;

    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);

    this.pointerDownOnSelectedCard = false;

    // Right-click always pans (do nothing special, let viewport handle it)
    if (isRightClick) {
      return;
    }

    const clickedCard = this.getCardAtPosition(worldPos);

    if (clickedCard) {
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
        this.clearSelection();
        this.selectCard(clickedCard);
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
  }

  private onPointerMove(event: FederatedPointerEvent): void {
    if (!this.camera) return;

    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);

    // Update selection box
    if (this.selectionBox.isActive) {
      this.updateSelectionBox(worldPos);
      return;
    }

    // Update card drag
    if (this.dragState.isDragging && this.pointerDownOnSelectedCard) {
      this.updateCardDrag(worldPos);
    }
  }

  private onPointerUp(event: FederatedPointerEvent): void {
    if (!this.camera) return;

    const worldPos = this.camera.screenToWorld(event.globalX, event.globalY);

    // Handle double-right-click for remove from deck
    const isRightClick = event.button === 2;
    if (isRightClick) {
      const now = Date.now();
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

    // End selection box
    if (this.selectionBox.isActive) {
      this.endSelectionBox(worldPos);
      this.camera.resumeDrag();
      return;
    }

    // End card drag
    if (this.dragState.isDragging) {
      this.endCardDrag();
      this.camera.resumeDrag();
    }

    this.pointerDownOnSelectedCard = false;
  }

  // ============================================================================
  // Selection Management
  // ============================================================================

  private selectCard(cardName: string): void {
    this.selectedCards.add(cardName);
    const data = this.cardSprites.get(cardName);
    if (data) {
      data.sprite.setSelected(true);
    }
  }

  private deselectCard(cardName: string): void {
    this.selectedCards.delete(cardName);
    const data = this.cardSprites.get(cardName);
    if (data) {
      data.sprite.setSelected(false);
    }
  }

  private clearSelection(): void {
    for (const cardName of this.selectedCards) {
      const data = this.cardSprites.get(cardName);
      if (data) {
        data.sprite.setSelected(false);
      }
    }
    this.selectedCards.clear();
  }

  private getCardAtPosition(worldPos: { x: number; y: number }): string | null {
    let topCard: string | null = null;
    let topZIndex = -Infinity;

    for (const cardName of this.visibleCardNames) {
      const data = this.cardSprites.get(cardName);
      if (data && this.pointInBounds(worldPos, data.bounds)) {
        const zIndex = data.sprite.zIndex;
        if (zIndex > topZIndex) {
          topZIndex = zIndex;
          topCard = cardName;
        }
      }
    }
    return topCard;
  }

  private pointInBounds(
    point: { x: number; y: number },
    bounds: { left: number; top: number; right: number; bottom: number }
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
    this.dragState.cardOriginalZIndices.clear();

    // Use a high zIndex so dragged cards appear above all others
    const dragZIndex = 10000;

    for (const cardName of this.dragState.draggedCards) {
      const data = this.cardSprites.get(cardName);
      if (data) {
        this.dragState.cardStartPositions.set(cardName, {
          x: data.sprite.x,
          y: data.sprite.y,
        });
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
      const data = this.cardSprites.get(cardName);
      const startPos = this.dragState.cardStartPositions.get(cardName);
      if (data && startPos) {
        data.sprite.x = startPos.x + dx;
        data.sprite.y = startPos.y + dy;
      }
    }
  }

  private endCardDrag(): void {
    for (const cardName of this.dragState.draggedCards) {
      const data = this.cardSprites.get(cardName);
      if (data) {
        const cardSize = data.layout.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
        const isLandscape = data.layout.isLandscape;

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
        const gridPos = pixelsToSnapGrid(snappedCenter.x, snappedCenter.y, isLandscape);
        data.gridKey = `${isLandscape ? 'L' : 'P'}:${gridPos.x},${gridPos.y}`;

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
    this.dragState.cardOriginalZIndices.clear();
  }

  // ============================================================================
  // Card Stacking
  // ============================================================================

  private rebuildCardStacks(): void {
    this.cardStacks.clear();

    // Group cards by grid position
    for (const [cardName, data] of this.cardSprites) {
      const gridKey = data.gridKey;
      let stack = this.cardStacks.get(gridKey);
      if (!stack) {
        stack = [];
        this.cardStacks.set(gridKey, stack);
      }
      stack.push(cardName);
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
  private applyStackOffsets(cardNames: string[], skipPositionUpdates = false): void {
    const stackSize = cardNames.length;

    if (stackSize <= 1) {
      // Single card, reset to base position
      const firstCard = cardNames[0];
      if (firstCard) {
        const data = this.cardSprites.get(firstCard);
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
      const data = this.cardSprites.get(cardName);
      if (!data) continue;

      // Higher index = higher z-index (on top)
      data.sprite.zIndex = i;

      // Skip position updates during animation
      if (skipPositionUpdates) continue;

      const cardSize = data.layout.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      const isSite = data.layout.isLandscape;

      // Calculate offset from center of stack
      const indexOffset = i * STACK_OFFSET - totalOffset / 2;

      // Sites offset upward (negative Y), Spells offset downward (positive Y)
      const yOffset = isSite ? -indexOffset : indexOffset;

      data.sprite.x = data.basePosition.x;
      data.sprite.y = data.basePosition.y + yOffset;

      // Update bounds for hit testing
      data.bounds = {
        left: data.sprite.x,
        top: data.sprite.y,
        right: data.sprite.x + cardSize.width,
        bottom: data.sprite.y + cardSize.height,
      };
    }
  }

  private updateCardBounds(data: CardSpriteData): void {
    const cardSize = data.layout.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
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
      // Clear existing selection and select cards in box
      this.clearSelection();
      for (const [cardName, data] of this.cardSprites) {
        if (this.boundsIntersect(data.bounds, selectionBounds)) {
          this.selectCard(cardName);
        }
      }
    }

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

  setCards(cards: Card[]): void {
    if (!this.isInitialized) {
      this.pendingCards = cards;
      return;
    }

    this.cards = cards;
    this.rebuildCardSprites();
  }

  updateDeckOverlays(
    deck: Deck | null,
    _activeBoard: ActiveBoard,
    collection: CollectionItem[]
  ): void {
    this.activeDeck = deck;

    // Update collection card quantity badges
    const deckQuantities = new Map<string, number>();
    const collectionQuantities = new Map<string, number>();

    if (deck) {
      for (const board of ['mainboard', 'sideboard', 'avatar'] as const) {
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

      let quantityColor: CardSpriteState['quantityColor'] = 'white';
      if (hasCollection && deckQty > 0) {
        if (deckQty > collectionQty) {
          quantityColor = 'red';
        } else if (collectionQty === 0) {
          quantityColor = 'black';
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

  updateArchetypeHighlight(
    archetype: string | null,
    scores: ArchetypeScores | null
  ): void {
    this.selectedArchetype = archetype;
    this.archetypeScores = scores;
    this.applyArchetypeHighlighting();
  }

  destroy(): void {
    this.isDestroyed = true;

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
      delta
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

    // Persist to disk (debounced)
    saveArchetypeScores(this.archetypeScores);
  }

  private rebuildCardSprites(): void {
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

    if (this.cards.length === 0) return;

    const layoutCards = this.cards.map((card) => ({
      name: card.name,
      type: card.guardian.type,
      thresholdGroup: getThresholdGroup(card.guardian.thresholds),
      cost: card.guardian.cost,
      isLandscape: card.guardian.type === 'Site',
      primarySet: card.sets[0]?.name,
      rarity: card.guardian.rarity as 'Ordinary' | 'Exceptional' | 'Elite' | 'Unique' | null,
    }));

    const { cards: layout, headers, bounds: contentBounds } = calculateCardLayout({ cards: layoutCards });

    // Store collection bounds for deck layout positioning
    this.collectionBounds = contentBounds;

    // Move camera to content area before creating sprites
    if (layout.length > 0 && this.camera) {
      this.camera.fitToContent(contentBounds, 100);
    }

    // Create group header labels
    for (const header of headers) {
      const text = new Text({
        text: header.label,
        style: {
          fontFamily: 'Arial',
          fontSize: HEADER_HEIGHT,
          fill: 0x888888,
          fontWeight: 'bold',
        },
      });
      text.x = header.position.x;
      text.y = header.position.y;
      this.cardContainer.addChild(text);
      this.headerLabels.push(text);
    }

    // Create sprites at their final positions
    for (const cardLayout of layout) {
      const cardSize = cardLayout.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      const isLandscape = cardLayout.isLandscape;

      const centerX = cardLayout.position.x;
      const centerY = cardLayout.position.y;

      const sprite = new CardSprite({
        name: cardLayout.name,
        isLandscape: cardLayout.isLandscape,
        x: centerX,
        y: centerY,
      });

      const topLeftX = centerX - cardSize.width / 2;
      const topLeftY = centerY - cardSize.height / 2;

      const gridPos = pixelsToSnapGrid(centerX, centerY, isLandscape);
      const gridKey = `${isLandscape ? 'L' : 'P'}:${gridPos.x},${gridPos.y}`;

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
        basePosition: { x: topLeftX, y: topLeftY },
      };

      this.cardSprites.set(cardLayout.name, spriteData);
      this.cardContainer.addChild(sprite);
    }

    this.rebuildCardStacks();
    this.performCulling();
    this.drawGrid();

    // Rebuild deck display if a deck is active
    if (this.activeDeck) {
      this.rebuildDeckSprites();
    }
  }

  private rebuildDeckSprites(): void {
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
    const cardLookup = new Map<string, { type: import('@/data/dataModels').CardType; cost: number; isLandscape: boolean; thresholdGroup: import('@/data/dataModels').ThresholdGroup }>();
    for (const card of this.cards) {
      cardLookup.set(card.name, {
        type: card.guardian.type,
        cost: card.guardian.cost,
        isLandscape: card.guardian.type === 'Site',
        thresholdGroup: getThresholdGroup(card.guardian.thresholds),
      });
    }

    const { cards: deckLayout, headers } = calculateDeckLayout({
      deck: this.activeDeck,
      cardLookup,
      collectionBottom: this.collectionBounds.bottom,
    });

    // Create deck header labels
    for (const header of headers) {
      const text = new Text({
        text: header.label,
        style: {
          fontFamily: 'Arial',
          fontSize: HEADER_HEIGHT,
          fill: 0x888888,
          fontWeight: 'bold',
        },
      });
      text.x = header.position.x;
      text.y = header.position.y;
      this.cardContainer.addChild(text);
      this.deckHeaderLabels.push(text);
    }

    // Create deck card sprites - one per copy for stacking
    for (const cardLayout of deckLayout) {
      const cardSize = cardLayout.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      const centerX = cardLayout.position.x;
      const centerY = cardLayout.position.y;
      const topLeftX = centerX - cardSize.width / 2;
      const topLeftY = centerY - cardSize.height / 2;
      const gridPos = pixelsToSnapGrid(centerX, centerY, cardLayout.isLandscape);
      const gridKey = `deck:${cardLayout.board}:${gridPos.x},${gridPos.y}`;

      for (let copy = 0; copy < cardLayout.quantity; copy++) {
        const sprite = new CardSprite({
          name: cardLayout.name,
          isLandscape: cardLayout.isLandscape,
          x: centerX,
          y: centerY,
        });

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

        const cardSize = isSite ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
        data.bounds = {
          left: data.sprite.x,
          top: data.sprite.y,
          right: data.sprite.x + cardSize.width,
          bottom: data.sprite.y + cardSize.height,
        };
      }
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
      } else {
        if (data.sprite.visible) {
          data.sprite.visible = false;
        }
      }
    }

    this.visibleCardNames = newVisible;

    if (cardsToLoad.length > 0) {
      lodManager.preloadTextures(cardsToLoad);
    }
  }

  private boundsIntersect(
    a: { left: number; top: number; right: number; bottom: number },
    b: CameraBounds
  ): boolean {
    return !(
      a.right < b.left ||
      a.left > b.right ||
      a.bottom < b.top ||
      a.top > b.bottom
    );
  }

  private update(): void {
    // Per-frame updates if needed
  }

}
