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

import { Application, Container, Graphics, FederatedPointerEvent } from 'pixi.js';
import { Camera, type CameraBounds } from './Camera';
import { CardSprite, type CardSpriteState } from './CardSprite';
import {
  calculateCardLayout,
  GRID_UNIT,
  CARD_SIZE,
  GRID_LINE,
  STACK_OFFSET,
  snapToGrid,
  pixelsToGrid,
  type CardLayoutInfo,
} from './Grid';
import { lodManager } from './LODManager';
import type {
  Card,
  Deck,
  ActiveBoard,
  CollectionItem,
} from '@/data/dataModels';
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

    const startX = Math.floor(bounds.left / GRID_UNIT) * GRID_UNIT;
    const startY = Math.floor(bounds.top / GRID_UNIT) * GRID_UNIT;
    const endX = Math.ceil(bounds.right / GRID_UNIT) * GRID_UNIT;
    const endY = Math.ceil(bounds.bottom / GRID_UNIT) * GRID_UNIT;

    for (let x = startX; x <= endX; x += GRID_UNIT) {
      this.gridGraphics.moveTo(x, startY);
      this.gridGraphics.lineTo(x, endY);
    }

    for (let y = startY; y <= endY; y += GRID_UNIT) {
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
        this.onAddToDeck(clickedCard);
        return;
      }

      // Bring clicked card to front of its stack
      this.bringCardToFront(clickedCard);

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
        // Clicked on unselected card - start selection box (allows selecting multiple)
        this.clearSelection();
        this.selectCard(clickedCard);
        // Start selection box in case they drag
        this.startSelectionBox(worldPos);
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
        this.onRemoveFromDeck(clickedCard);
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

    for (const cardName of this.dragState.draggedCards) {
      const data = this.cardSprites.get(cardName);
      if (data) {
        this.dragState.cardStartPositions.set(cardName, {
          x: data.sprite.x,
          y: data.sprite.y,
        });
      }
    }
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

        // Snap to grid
        const snapped = snapToGrid(data.sprite.x, data.sprite.y);

        data.sprite.x = snapped.x;
        data.sprite.y = snapped.y;
        data.basePosition = { x: snapped.x, y: snapped.y };

        // Update cached bounds
        data.bounds = {
          left: snapped.x,
          top: snapped.y,
          right: snapped.x + cardSize.width,
          bottom: snapped.y + cardSize.height,
        };

        // Update grid key for stacking
        const gridPos = pixelsToGrid(snapped.x, snapped.y);
        data.gridKey = `${gridPos.x},${gridPos.y}`;
      }
    }

    this.rebuildCardStacks();

    this.dragState.isDragging = false;
    this.dragState.draggedCards.clear();
    this.dragState.cardStartPositions.clear();
  }

  // ============================================================================
  // Card Stacking
  // ============================================================================

  private rebuildCardStacks(): void {
    this.cardStacks.clear();

    // Group cards by grid position
    for (const [cardName, data] of this.cardSprites) {
      const gridKey = data.gridKey;
      if (!this.cardStacks.has(gridKey)) {
        this.cardStacks.set(gridKey, []);
      }
      this.cardStacks.get(gridKey)!.push(cardName);
    }

    // Apply stacking offsets and z-indices
    for (const [_gridKey, cardNames] of this.cardStacks) {
      this.applyStackOffsets(cardNames);
    }

    this.cardContainer.sortChildren();
  }

  /**
   * Apply visual offsets to cards in a stack
   * - Spells (portrait): offset downward (names on top visible)
   * - Sites (landscape): offset upward (names on bottom visible)
   */
  private applyStackOffsets(cardNames: string[]): void {
    const stackSize = cardNames.length;

    if (stackSize <= 1) {
      // Single card, reset to base position
      const data = this.cardSprites.get(cardNames[0]!);
      if (data) {
        data.sprite.x = data.basePosition.x;
        data.sprite.y = data.basePosition.y;
        data.sprite.zIndex = 0;
        this.updateCardBounds(data);
      }
      return;
    }

    // Calculate total stack offset for centering
    const totalOffset = (stackSize - 1) * STACK_OFFSET;

    for (let i = 0; i < stackSize; i++) {
      const cardName = cardNames[i]!;
      const data = this.cardSprites.get(cardName);
      if (!data) continue;

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

      // Higher index = higher z-index (on top)
      data.sprite.zIndex = i;
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

  /**
   * Bring a card to the front of its stack
   */
  private bringCardToFront(cardName: string): void {
    const data = this.cardSprites.get(cardName);
    if (!data) return;

    const stack = this.cardStacks.get(data.gridKey);
    if (!stack || stack.length <= 1) return;

    // Remove card from current position and add to end (top of stack)
    const index = stack.indexOf(cardName);
    if (index >= 0 && index < stack.length - 1) {
      stack.splice(index, 1);
      stack.push(cardName);
      this.applyStackOffsets(stack);
      this.cardContainer.sortChildren();
    }
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

  private rebuildCardSprites(): void {
    for (const data of this.cardSprites.values()) {
      data.sprite.destroy();
    }
    this.cardSprites.clear();
    this.cardContainer.removeChildren();
    this.visibleCardNames.clear();
    this.clearSelection();
    this.cardStacks.clear();

    if (this.cards.length === 0) return;

    console.log(`Building layout for ${this.cards.length} cards...`);

    const layoutCards = this.cards.map((card) => ({
      name: card.name,
      type: card.guardian.type,
      thresholdGroup: getThresholdGroup(card.guardian.thresholds),
      cost: card.guardian.cost,
      isLandscape: card.guardian.type === 'Site',
      primarySet: card.sets[0]?.name,
      rarity: card.guardian.rarity as 'Ordinary' | 'Exceptional' | 'Elite' | 'Unique' | null,
    }));

    const layout = calculateCardLayout({ cards: layoutCards });

    console.log(`Layout calculated: ${layout.length} cards positioned`);

    for (const cardLayout of layout) {
      const cardSize = cardLayout.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;

      const sprite = new CardSprite({
        name: cardLayout.name,
        isLandscape: cardLayout.isLandscape,
        x: cardLayout.position.x,
        y: cardLayout.position.y,
      });

      const gridPos = pixelsToGrid(cardLayout.position.x, cardLayout.position.y);
      const gridKey = `${gridPos.x},${gridPos.y}`;

      const spriteData: CardSpriteData = {
        sprite,
        bounds: {
          left: cardLayout.position.x,
          top: cardLayout.position.y,
          right: cardLayout.position.x + cardSize.width,
          bottom: cardLayout.position.y + cardSize.height,
        },
        layout: cardLayout,
        gridKey,
        basePosition: { x: cardLayout.position.x, y: cardLayout.position.y },
      };

      this.cardSprites.set(cardLayout.name, spriteData);
      this.cardContainer.addChild(sprite);
      sprite.visible = false;
    }

    this.rebuildCardStacks();

    if (layout.length > 0 && this.camera) {
      const bounds = this.calculateContentBounds();
      console.log(`Content bounds: ${bounds.right - bounds.left}x${bounds.bottom - bounds.top}`);
      this.camera.fitToContent(bounds, 100);
    }

    this.performCulling();
    this.drawGrid();
  }

  private calculateContentBounds(): { left: number; top: number; right: number; bottom: number } {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    for (const data of this.cardSprites.values()) {
      left = Math.min(left, data.bounds.left);
      top = Math.min(top, data.bounds.top);
      right = Math.max(right, data.bounds.right);
      bottom = Math.max(bottom, data.bounds.bottom);
    }

    return { left, top, right, bottom };
  }

  private handleZoomChange(zoom: number): void {
    for (const name of this.visibleCardNames) {
      const data = this.cardSprites.get(name);
      if (data) {
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
