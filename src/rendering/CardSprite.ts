/**
 * Card sprite rendering and interaction
 *
 * Each CardSprite represents a single card on the canvas.
 * Handles:
 * - Texture display with LOD switching
 * - Visual state (selection, quantity overlay)
 * - Hover state for optional high-res preview (when full LOD is active)
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

import { Container, Sprite, Graphics, Text, Texture } from "pixi.js";
import { CARD_SIZE } from "./Grid";
import {
  lodManager,
  LOD_LEVELS,
  type LODLevel,
  cardNameToSlug,
} from "./LODManager";

// ============================================================================
// Types
// ============================================================================

export interface CardSpriteConfig {
  name: string;
  isLandscape: boolean;
  x: number;
  y: number;
  displaySize?: { width: number; height: number };
}

export interface CardSpriteState {
  quantity: number;
  quantityColor: "white" | "black" | "red";
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
  private metricOutline: Graphics;
  private scoreText: Text;
  private displayWidth: number;
  private displayHeight: number;
  private currentLOD: LODLevel = lodManager.getStartupLOD();
  private displayedLOD: LODLevel | null = null;
  private _isSelected = false;
  private _textureLoaded = false;
  private _initialLoadStarted = false;
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
    const defaultCardSize = this.isLandscape
      ? CARD_SIZE.LANDSCAPE
      : CARD_SIZE.PORTRAIT;
    const width = config.displaySize?.width ?? defaultCardSize.width;
    const height = config.displaySize?.height ?? defaultCardSize.height;
    this.displayWidth = width;
    this.displayHeight = height;

    // Position is the CENTER of the card - offset to get top-left for container
    this.x = config.x - width / 2;
    this.y = config.y - height / 2;

    // Create sprite with placeholder (hidden until real texture loads)
    this.sprite = new Sprite(Texture.WHITE);
    this.sprite.width = width;
    this.sprite.height = height;
    this.sprite.tint = 0x2a2a3e;
    this.sprite.visible = false;

    // Apply rotation for landscape cards (Sites)
    // Rotate 90 degrees clockwise so the card reads correctly left-to-right
    if (this.isLandscape) {
      this.sprite.rotation = Math.PI / 2;
      this.sprite.x = width;
      this.sprite.y = 0;
    }

    this.addChild(this.sprite);

    // Metric score outline (drawn beneath selection border)
    this.metricOutline = new Graphics();
    this.metricOutline.visible = false;
    this.addChild(this.metricOutline);

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
      text: "",
      style: {
        fontFamily: "Arial",
        fontSize,
        fontWeight: "bold",
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

    // Metric score text (centered on card)
    const scoreFontSize = Math.round(Math.min(width, height) * 0.35);
    this.scoreText = new Text({
      text: "",
      style: {
        fontFamily: "Arial",
        fontSize: scoreFontSize,
        fontWeight: "bold",
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
    this.eventMode = "static";
    this.cursor = "pointer";

    // Hover handlers for high-res preview
    this.on("pointerover", this.onPointerOver, this);
    this.on("pointerout", this.onPointerOut, this);
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /** Trigger the initial texture load. Called externally so load order can be controlled. */
  loadInitialTexture(): void {
    // Avoid re-scheduling initial loads (important for refresh/resume and for
    // multiple code-paths trying to start loads).
    if (this._textureLoaded || this._initialLoadStarted) return;
    this._initialLoadStarted = true;
    void this.loadTexture(this.currentLOD);
  }

  public get isTextureReady(): boolean {
    return this._textureLoaded;
  }

  public get currentTextureLOD(): LODLevel | null {
    return this.displayedLOD;
  }

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
   * Show a metric outline, optional decimal value, and optional inactive dimming.
   */
  setMetricScore(
    score: number | null,
    options: { color?: number; dimInactive?: boolean; showValue?: boolean } = {},
  ): void {
    const color = options.color ?? 0x00ddff;
    const dimInactive = options.dimInactive ?? true;
    const showValue = options.showValue ?? true;
    if (score === null) {
      this.metricOutline.visible = false;
      this.scoreText.visible = false;
      this.alpha = 1;
      return;
    }

    if (score <= 0) {
      this.metricOutline.visible = false;
      this.scoreText.visible = false;
      this.alpha = dimInactive ? 0.3 : 1;
      return;
    }

    const w = this.displayWidth;
    const h = this.displayHeight;

    const borderWidth = 3;
    const outlineAlpha = Math.min(1, 0.35 + score * 0.6);

    // Draw outline
    this.metricOutline.clear();
    this.metricOutline.rect(0, 0, w, h);
    this.metricOutline.stroke({
      width: borderWidth,
      color,
      alpha: outlineAlpha,
    });
    this.metricOutline.visible = true;

    // Draw score value
    this.scoreText.text = score.toFixed(2);
    this.scoreText.style.fill = color;
    this.scoreText.visible = showValue;

    this.alpha = 1;
  }

  updateLOD(zoom: number): void {
    const newLOD = lodManager.getLODForCardDisplay(zoom, this.displayHeight);
    if (newLOD !== this.currentLOD) {
      this.currentLOD = newLOD;
      this.loadTexture(newLOD);
    }
  }

  refreshCurrentLOD(): void {
    void this.loadTexture(this.currentLOD);
  }

  reloadCurrentTexture(): void {
    this.displayedLOD = null;
    this._textureLoaded = false;
    this.sprite.texture = Texture.WHITE;
    this.sprite.tint = 0x2a2a3e;
    this.sprite.visible = false;
    const fallbackLOD = lodManager.getStartupLOD();
    void this.loadTexture(fallbackLOD).then(() => {
      if (this.currentLOD !== fallbackLOD) {
        this.refreshCurrentLOD();
      }
    });
  }

  releaseTextureForLOD(lod: LODLevel): void {
    if (this.displayedLOD !== lod) return;

    const fallbackTexture = lod === LOD_LEVELS.THUMBNAIL
      ? null
      : lodManager.getExactTextureSync(this.imageSlug, LOD_LEVELS.THUMBNAIL);
    if (fallbackTexture) {
      this.applyTexture(fallbackTexture, LOD_LEVELS.THUMBNAIL);
      return;
    }

    const wasVisible = this.sprite.visible;
    this.displayedLOD = null;
    this.sprite.texture = Texture.WHITE;
    this.sprite.tint = 0x2a2a3e;
    this.sprite.visible = wasVisible;

    if (lod !== LOD_LEVELS.THUMBNAIL) {
      setTimeout(() => {
        void this.loadTexture(LOD_LEVELS.THUMBNAIL);
      }, 0);
    }
  }

  /**
   * Get the card's CENTER position in world coordinates
   */
  getCenter(): { x: number; y: number } {
    return {
      x: this.x + this.displayWidth / 2,
      y: this.y + this.displayHeight / 2,
    };
  }

  /**
   * Get the card's bounding box in world coordinates
   */
  getWorldBounds(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    return {
      left: this.x,
      top: this.y,
      right: this.x + this.displayWidth,
      bottom: this.y + this.displayHeight,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private onPointerOver(): void {
    // Hovered cards are prioritized up to the highest tier this device allows.
    this.loadTexture(lodManager.getInteractiveDetailLOD());
  }

  private onPointerOut(): void {
    this.loadTexture(this.currentLOD);
  }

  private async loadTexture(lod: LODLevel): Promise<void> {
    const effectiveLOD = lodManager.resolveLOD(lod);
    if (this.shouldKeepDisplayedFullTexture(effectiveLOD)) {
      return;
    }

    try {
      // Try sync first for instant display
      const hasExactTexture = lodManager.hasExactTexture(this.imageSlug, lod);
      const syncTexture = lodManager.getTextureMatchSync(this.imageSlug, lod);
      if (syncTexture) {
        this.applyTexture(syncTexture.texture, syncTexture.lod);
        this.markTextureLoaded();
        // For higher LOD requests, keep downloading the exact texture if we only
        // had a fallback (e.g., thumbnail) in cache.
        if (hasExactTexture || effectiveLOD === LOD_LEVELS.THUMBNAIL) {
          return;
        }
      }

      if (lodManager.shouldDeferAsyncTextureLoad(effectiveLOD)) {
        this.markTextureLoaded();
        return;
      }

      // Load async
      const texture = await lodManager.getTexture(this.imageSlug, lod);
      if (texture && texture !== Texture.WHITE) {
        this.applyTexture(texture, effectiveLOD);
      }
      this.markTextureLoaded();
    } catch {
      // Texture load failed - still mark as "loaded" so animation can proceed with placeholder
      this.markTextureLoaded();
    }
  }

  private shouldKeepDisplayedFullTexture(nextLOD: LODLevel): boolean {
    return (
      this.displayedLOD === LOD_LEVELS.FULL &&
      nextLOD !== LOD_LEVELS.THUMBNAIL &&
      lodManager.hasExactTexture(this.imageSlug, LOD_LEVELS.FULL)
    );
  }

  private markTextureLoaded(): void {
    // Once any texture has been successfully applied (or we've decided to proceed
    // with a placeholder), we consider the "initial" texture ready.
    if (!this._textureLoaded) {
      this._textureLoaded = true;
      this.resolveTextureReady();
    }
  }

  private applyTexture(texture: Texture, lod: LODLevel): void {
    const targetWidth = this.displayWidth;
    const targetHeight = this.displayHeight;

    this.sprite.texture = texture;
    this.displayedLOD = lod;

    if (this.isLandscape) {
      // For landscape, swap dimensions due to rotation
      this.sprite.width = targetHeight;
      this.sprite.height = targetWidth;
    } else {
      this.sprite.width = targetWidth;
      this.sprite.height = targetHeight;
    }

    this.sprite.tint = 0xffffff;
    this.sprite.visible = true;
  }

  private getQuantityColor(color: "white" | "black" | "red"): number {
    switch (color) {
      case "white":
        return 0xffffff;
      case "black":
        return 0x000000;
      case "red":
        return 0xff0000;
    }
  }
}
