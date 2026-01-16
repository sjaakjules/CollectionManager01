/**
 * Card sprite rendering and interaction
 *
 * Each CardSprite represents a single card on the canvas.
 * Handles:
 * - Texture display with LOD switching
 * - Visual state (selection, quantity overlay)
 * - Hover state for high-res preview
 *
 * Card sizes:
 * - Portrait: 110×165px (2×3 grid cells at 55px)
 * - Landscape: 165×110px (3×2 grid cells at 55px)
 *
 * NOTE: Selection and dragging logic is managed by PixiStage.
 * This class only reports pointer events and updates visuals.
 */

import { Container, Sprite, Graphics, Text, Texture } from 'pixi.js';
import { CARD_SIZE } from './Grid';
import { lodManager, LOD_LEVELS, type LODLevel, cardNameToSlug } from './LODManager';

// ============================================================================
// Types
// ============================================================================

export interface CardSpriteConfig {
  name: string;
  isLandscape: boolean;
  x: number;
  y: number;
}

export interface CardSpriteState {
  quantity: number;
  quantityColor: 'white' | 'black' | 'red';
  isHighlighted: boolean;
}

// ============================================================================
// CardSprite Class
// ============================================================================

export class CardSprite extends Container {
  public readonly cardName: string;
  public readonly imageSlug: string;
  public readonly isLandscape: boolean;

  private sprite: Sprite;
  private overlay: Container;
  private quantityText: Text;
  private selectionBorder: Graphics;
  private currentLOD: LODLevel = LOD_LEVELS.THUMBNAIL;
  private _isSelected = false;

  constructor(config: CardSpriteConfig) {
    super();

    this.cardName = config.name;
    this.imageSlug = cardNameToSlug(config.name);
    this.isLandscape = config.isLandscape;

    // Set position
    this.x = config.x;
    this.y = config.y;

    // Get card dimensions from Grid constants
    const cardSize = this.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const width = cardSize.width;
    const height = cardSize.height;

    // Create sprite with placeholder (dark gray)
    this.sprite = new Sprite(Texture.WHITE);
    this.sprite.width = width;
    this.sprite.height = height;
    this.sprite.tint = 0x2a2a3e;

    // Apply rotation for landscape cards (Sites)
    // Rotate 90 degrees clockwise so the card reads correctly left-to-right
    if (this.isLandscape) {
      this.sprite.rotation = Math.PI / 2;
      this.sprite.x = width;
      this.sprite.y = 0;
    }

    this.addChild(this.sprite);

    // Selection border
    this.selectionBorder = new Graphics();
    this.selectionBorder.rect(0, 0, width, height);
    this.selectionBorder.stroke({ width: 2, color: 0xffcc00 });
    this.selectionBorder.visible = false;
    this.addChild(this.selectionBorder);

    // Quantity overlay - font size proportional to card size
    this.overlay = new Container();
    const fontSize = Math.round(Math.min(width, height) * 0.25); // 25% of smaller dimension
    this.quantityText = new Text({
      text: '',
      style: {
        fontFamily: 'Arial',
        fontSize,
        fontWeight: 'bold',
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 2 },
      },
    });
    this.quantityText.anchor.set(0.5);
    this.quantityText.x = width / 2;
    this.quantityText.y = height / 2;
    this.overlay.addChild(this.quantityText);
    this.overlay.visible = false;
    this.addChild(this.overlay);

    // Enable interactivity - events are handled by PixiStage
    this.eventMode = 'static';
    this.cursor = 'pointer';

    // Hover handlers for high-res preview
    this.on('pointerover', this.onPointerOver, this);
    this.on('pointerout', this.onPointerOut, this);

    // Load initial texture (defer to avoid blocking)
    this.loadTexture(LOD_LEVELS.THUMBNAIL);
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  get isSelected(): boolean {
    return this._isSelected;
  }

  setSelected(selected: boolean): void {
    this._isSelected = selected;
    this.selectionBorder.visible = selected;
  }

  updateState(state: CardSpriteState): void {
    // Update quantity overlay
    if (state.quantity > 0) {
      this.quantityText.text = state.quantity.toString();
      this.quantityText.style.fill = this.getQuantityColor(state.quantityColor);
      this.overlay.visible = true;
    } else {
      this.overlay.visible = false;
    }

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

  /**
   * Get the card's bounding box in world coordinates
   */
  getWorldBounds(): { left: number; top: number; right: number; bottom: number } {
    const cardSize = this.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const width = cardSize.width;
    const height = cardSize.height;

    return {
      left: this.x,
      top: this.y,
      right: this.x + width,
      bottom: this.y + height,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private onPointerOver(): void {
    this.loadTexture(LOD_LEVELS.FULL);
  }

  private onPointerOut(): void {
    this.loadTexture(this.currentLOD);
  }

  private async loadTexture(lod: LODLevel): Promise<void> {
    try {
      // Try sync first for instant display
      const syncTexture = lodManager.getTextureSync(this.imageSlug, lod);
      if (syncTexture) {
        this.applyTexture(syncTexture);
        return;
      }

      // Load async
      const texture = await lodManager.getTexture(this.imageSlug, lod);
      if (texture && texture !== Texture.WHITE) {
        this.applyTexture(texture);
      }
    } catch {
      // Texture load failed - keep placeholder
    }
  }

  private applyTexture(texture: Texture): void {
    const cardSize = this.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const targetWidth = cardSize.width;
    const targetHeight = cardSize.height;

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
