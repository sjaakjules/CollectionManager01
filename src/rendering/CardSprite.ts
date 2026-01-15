/**
 * Card sprite rendering and interaction
 *
 * Each CardSprite represents a single card on the canvas.
 * Handles:
 * - Texture display with LOD switching
 * - Click, double-click, and drag interactions
 * - Quantity overlays
 * - Hover state for high-res preview
 */

import { Container, Sprite, Graphics, Text, Texture } from 'pixi.js';
import { GRID_UNIT, CARD_GRID_SIZE, snapToGrid } from './Grid';
import { lodManager, LOD_LEVELS, type LODLevel } from './LODManager';

// ============================================================================
// Types
// ============================================================================

export interface CardSpriteConfig {
  name: string;
  variantSlug: string;
  isLandscape: boolean;
  x: number;
  y: number;
  onAddToDeck: (cardName: string) => void;
  onRemoveFromDeck: (cardName: string) => void;
}

export interface CardSpriteState {
  quantity: number;
  quantityColor: 'white' | 'black' | 'red';
  isSelected: boolean;
  isHighlighted: boolean;
}

// ============================================================================
// CardSprite Class
// ============================================================================

export class CardSprite extends Container {
  public readonly cardName: string;
  public readonly variantSlug: string;
  public readonly isLandscape: boolean;

  private sprite: Sprite;
  private overlay: Container;
  private quantityText: Text;
  private selectionBorder: Graphics;
  private currentLOD: LODLevel = LOD_LEVELS.THUMBNAIL;

  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastClickTime = 0;

  private onAddToDeck: (cardName: string) => void;
  private onRemoveFromDeck: (cardName: string) => void;

  constructor(config: CardSpriteConfig) {
    super();

    this.cardName = config.name;
    this.variantSlug = config.variantSlug;
    this.isLandscape = config.isLandscape;
    this.onAddToDeck = config.onAddToDeck;
    this.onRemoveFromDeck = config.onRemoveFromDeck;

    // Set position
    this.x = config.x;
    this.y = config.y;

    // Calculate size
    const gridSize = this.isLandscape
      ? CARD_GRID_SIZE.LANDSCAPE
      : CARD_GRID_SIZE.PORTRAIT;
    const width = gridSize.widthUnits * GRID_UNIT;
    const height = gridSize.heightUnits * GRID_UNIT;

    // Create sprite with placeholder
    this.sprite = new Sprite(Texture.WHITE);
    this.sprite.width = width;
    this.sprite.height = height;
    this.sprite.tint = 0x333333;

    // Apply rotation for landscape cards
    if (this.isLandscape) {
      this.sprite.rotation = -Math.PI / 2;
      this.sprite.x = 0;
      this.sprite.y = height;
    }

    this.addChild(this.sprite);

    // Selection border
    this.selectionBorder = new Graphics();
    this.selectionBorder.rect(0, 0, width, height);
    this.selectionBorder.stroke({ width: 4, color: 0xffcc00 });
    this.selectionBorder.visible = false;
    this.addChild(this.selectionBorder);

    // Quantity overlay
    this.overlay = new Container();
    this.quantityText = new Text({
      text: '',
      style: {
        fontFamily: 'Arial',
        fontSize: 48,
        fontWeight: 'bold',
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 4 },
      },
    });
    this.quantityText.anchor.set(0.5);
    this.quantityText.x = width / 2;
    this.quantityText.y = height / 2;
    this.overlay.addChild(this.quantityText);
    this.overlay.visible = false;
    this.addChild(this.overlay);

    // Enable interactivity
    this.eventMode = 'static';
    this.cursor = 'pointer';

    // Set up event handlers
    this.setupInteraction();

    // Load initial texture
    this.loadTexture(LOD_LEVELS.THUMBNAIL);
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  updateState(state: CardSpriteState): void {
    // Update quantity overlay
    if (state.quantity > 0) {
      this.quantityText.text = state.quantity.toString();
      this.quantityText.style.fill = this.getQuantityColor(state.quantityColor);
      this.overlay.visible = true;
    } else {
      this.overlay.visible = false;
    }

    // Update selection
    this.selectionBorder.visible = state.isSelected;

    // Update highlight (dim non-matching cards)
    this.alpha = state.isHighlighted ? 1 : 0.3;
  }

  updateLOD(zoom: number): void {
    const newLOD = lodManager.getLODForZoom(zoom);
    if (newLOD !== this.currentLOD) {
      this.currentLOD = newLOD;
      this.loadTexture(newLOD);
    }
  }

  showHighResPreview(): void {
    this.loadTexture(LOD_LEVELS.FULL);
  }

  hideHighResPreview(): void {
    // Revert to appropriate LOD for current zoom
    this.loadTexture(this.currentLOD);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupInteraction(): void {
    this.on('pointerdown', this.onPointerDown, this);
    this.on('pointerup', this.onPointerUp, this);
    this.on('pointerupoutside', this.onPointerUp, this);
    this.on('pointermove', this.onPointerMove, this);
    this.on('pointerover', this.onPointerOver, this);
    this.on('pointerout', this.onPointerOut, this);
  }

  private onPointerDown(event: PointerEvent): void {
    this.isDragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
  }

  private onPointerUp(event: PointerEvent): void {
    const now = Date.now();
    const wasClick = !this.isDragging || (
      Math.abs(event.clientX - this.dragStartX) < 5 &&
      Math.abs(event.clientY - this.dragStartY) < 5
    );

    if (wasClick) {
      const isDoubleClick = now - this.lastClickTime < 300;

      if (isDoubleClick) {
        // Double-click: add or remove from deck
        if (event.button === 0) {
          // Left double-click: add to deck
          this.onAddToDeck(this.cardName);
        } else if (event.button === 2) {
          // Right double-click: remove from deck
          this.onRemoveFromDeck(this.cardName);
        }
      }

      this.lastClickTime = now;
    } else if (this.isDragging) {
      // Snap to grid on drag release
      const snapped = snapToGrid(this.x, this.y);
      this.x = snapped.x;
      this.y = snapped.y;
    }

    this.isDragging = false;
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.isDragging) {
      const dx = event.clientX - this.dragStartX;
      const dy = event.clientY - this.dragStartY;
      // Note: In actual implementation, need to account for camera transform
      this.x += dx;
      this.y += dy;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
    }
  }

  private onPointerOver(): void {
    this.showHighResPreview();
  }

  private onPointerOut(): void {
    this.hideHighResPreview();
  }

  private async loadTexture(lod: LODLevel): Promise<void> {
    try {
      // Try sync first for instant display
      const syncTexture = lodManager.getTextureSync(this.variantSlug, lod);
      if (syncTexture) {
        this.applyTexture(syncTexture);
        return;
      }

      // Load async
      const texture = await lodManager.getTexture(this.variantSlug, lod);
      this.applyTexture(texture);
    } catch (error) {
      console.warn(`Failed to load texture for ${this.cardName}:`, error);
    }
  }

  private applyTexture(texture: Texture): void {
    const gridSize = this.isLandscape
      ? CARD_GRID_SIZE.LANDSCAPE
      : CARD_GRID_SIZE.PORTRAIT;
    const targetWidth = gridSize.widthUnits * GRID_UNIT;
    const targetHeight = gridSize.heightUnits * GRID_UNIT;

    this.sprite.texture = texture;

    if (this.isLandscape) {
      // For landscape, swap dimensions due to rotation
      this.sprite.width = targetHeight;
      this.sprite.height = targetWidth;
    } else {
      this.sprite.width = targetWidth;
      this.sprite.height = targetHeight;
    }

    this.sprite.tint = 0xffffff;
  }

  private getQuantityColor(color: 'white' | 'black' | 'red'): number {
    switch (color) {
      case 'white':
        return 0xffffff;
      case 'black':
        return 0x000000;
      case 'red':
        return 0xff0000;
    }
  }
}
