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
 * - Portrait: 100×140px
 * - Landscape: 140×100px
 *
 * Cards are positioned by their CENTER point (config.x, config.y is the center).
 * The container is offset so the sprite draws correctly around that center.
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

  /** Promise that resolves when the initial texture is loaded */
  public readonly textureReady: Promise<void>;

  private sprite: Sprite;
  private overlay: Container;
  private quantityText: Text;
  private selectionBorder: Graphics;
  private archetypeOutline: Graphics;
  private scoreText: Text;
  private currentLOD: LODLevel = LOD_LEVELS.THUMBNAIL;
  private _isSelected = false;
  private _textureLoaded = false;
  private resolveTextureReady!: () => void;

  constructor(config: CardSpriteConfig) {
    super();

    this.cardName = config.name;
    this.imageSlug = cardNameToSlug(config.name);
    this.isLandscape = config.isLandscape;

    // Create promise for texture loading
    this.textureReady = new Promise((resolve) => {
      this.resolveTextureReady = resolve;
    });

    // Get card dimensions from Grid constants
    const cardSize = this.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const width = cardSize.width;
    const height = cardSize.height;

    // Position is the CENTER of the card - offset to get top-left for container
    this.x = config.x - width / 2;
    this.y = config.y - height / 2;

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

    // Archetype score outline (drawn beneath selection border)
    this.archetypeOutline = new Graphics();
    this.archetypeOutline.visible = false;
    this.addChild(this.archetypeOutline);

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

    // Archetype score text (centered on card)
    const scoreFontSize = Math.round(Math.min(width, height) * 0.35);
    this.scoreText = new Text({
      text: '',
      style: {
        fontFamily: 'Arial',
        fontSize: scoreFontSize,
        fontWeight: 'bold',
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
      },
    });
    this.scoreText.anchor.set(0.5);
    this.scoreText.x = width / 2;
    this.scoreText.y = height / 2;
    this.scoreText.visible = false;
    this.addChild(this.scoreText);

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

  /**
   * Show a colored outline based on the card's archetype score.
   * - Negative (-1 to -3): red with increasing opacity
   * - Positive (+1 to +3): cyan with increasing opacity
   * - +4 and above: green
   * - 0 or null: no outline, card dimmed
   */
  setArchetypeScore(score: number | null): void {
    if (score === null) {
      this.archetypeOutline.visible = false;
      this.scoreText.visible = false;
      this.alpha = 1;
      return;
    }

    if (score === 0) {
      this.archetypeOutline.visible = false;
      this.scoreText.visible = false;
      this.alpha = 0.3;
      return;
    }

    const cardSize = this.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const w = cardSize.width;
    const h = cardSize.height;

    let color: number;
    let outlineAlpha: number;
    const borderWidth = 3;

    if (score >= 4) {
      color = 0x00ff66;
      outlineAlpha = score >= 5 ? 1.0 : 0.8;
    } else if (score > 0) {
      color = 0x00ddff;
      // score 1 -> 0.4, 2 -> 0.65, 3 -> 0.9
      outlineAlpha = 0.15 + score * 0.25;
    } else {
      // negative
      color = 0xff3333;
      const absScore = Math.min(Math.abs(score), 3);
      // -1 -> 0.4, -2 -> 0.65, -3 -> 0.9
      outlineAlpha = 0.15 + absScore * 0.25;
    }

    // Draw outline
    this.archetypeOutline.clear();
    this.archetypeOutline.rect(0, 0, w, h);
    this.archetypeOutline.stroke({ width: borderWidth, color, alpha: outlineAlpha });
    this.archetypeOutline.visible = true;

    // Draw score value
    const sign = score > 0 ? '+' : '';
    this.scoreText.text = `${sign}${score}`;
    this.scoreText.style.fill = color;
    this.scoreText.visible = true;

    this.alpha = 1;
  }

  updateLOD(zoom: number): void {
    const newLOD = lodManager.getLODForZoom(zoom);
    if (newLOD !== this.currentLOD) {
      this.currentLOD = newLOD;
      this.loadTexture(newLOD);
    }
  }

  /**
   * Get the card's CENTER position in world coordinates
   */
  getCenter(): { x: number; y: number } {
    const cardSize = this.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    return {
      x: this.x + cardSize.width / 2,
      y: this.y + cardSize.height / 2,
    };
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
        this.markTextureLoaded();
        return;
      }

      // Load async
      const texture = await lodManager.getTexture(this.imageSlug, lod);
      if (texture && texture !== Texture.WHITE) {
        this.applyTexture(texture);
      }
      this.markTextureLoaded();
    } catch {
      // Texture load failed - still mark as "loaded" so animation can proceed with placeholder
      this.markTextureLoaded();
    }
  }

  private markTextureLoaded(): void {
    if (!this._textureLoaded) {
      this._textureLoaded = true;
      this.resolveTextureReady();
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
