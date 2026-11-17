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

import { Container, Sprite, Graphics, Text, Texture, Rectangle } from "pixi.js";
import { CARD_SIZE } from "./Grid";
import {
  lodManager,
  LOD_LEVELS,
  type LODLevel,
  cardNameToSlug,
} from "./LODManager";
import { shouldRotateCardImage } from "./cardOrientation";
import { drawMangaOutline, MANGA_PALETTE, type EffectBounds } from './mangaStyle';
import type { CardStatisticsPresentation } from '@/data/cardStatisticHighlights';
import { CardStatisticsOverlay } from './CardStatisticsOverlay';
import { createPreviewWatermark } from './PreviewWatermark';

// ============================================================================
// Types
// ============================================================================

export interface CardSpriteConfig {
  name: string;
  isLandscape: boolean;
  x: number;
  y: number;
  displaySize?: { width: number; height: number };
  isPreview?: boolean;
}

export interface CardSpriteState {
  quantity: number;
  quantityColor: "white" | "black" | "red";
  isHighlighted: boolean;
}

const LOD_RANK: Record<LODLevel, number> = {
  [LOD_LEVELS.THUMBNAIL]: 0,
  [LOD_LEVELS.MEDIUM]: 1,
  [LOD_LEVELS.FULL]: 2,
};

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
  private newCardBorder: Graphics;
  private outlineZoom = 1;
  private statisticsOverlay: CardStatisticsOverlay | null = null;
  private selectionEnvelope: EffectBounds | null | undefined;
  private isNewlyAdded = false;
  private metricOutline: Graphics;
  private scoreText: Text;
  private missingArtworkLabel: Text | null = null;
  private arrivalVisual: Container | null = null;
  private readonly isPreview: boolean;
  private displayWidth: number;
  private displayHeight: number;
  private currentLOD: LODLevel = lodManager.getStartupLOD();
  private requestedLOD: LODLevel = this.currentLOD;
  private textureRequestId = 0;
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
    this.isPreview = config.isPreview === true;

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
    if (this.isPreview) this.addChild(createPreviewWatermark(width, height));

    // Metric score outline (drawn beneath selection border)
    this.metricOutline = new Graphics();
    this.metricOutline.visible = false;
    this.addChild(this.metricOutline);

    // Selection border
    this.newCardBorder = new Graphics();
    this.newCardBorder.label = 'new-card-outline';
    this.newCardBorder.visible = false;
    this.addChild(this.newCardBorder);
    this.selectionBorder = new Graphics();
    this.selectionBorder.label = 'selection-outline';
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
    if (!selected) this.selectionEnvelope = undefined;
    this.selectionBorder.visible = selected && this.selectionEnvelope !== null;
    if (selected) this.redrawOutlines();
  }

  /** A selected stack has one outer rim; an individual selection keeps its own. */
  setSelectionOutline(bounds?: EffectBounds | null): void {
    this.selectionEnvelope = bounds;
    this.selectionBorder.visible = this._isSelected && bounds !== null;
    if (this.selectionBorder.visible) this.redrawOutlines();
  }

  setNewlyAdded(added: boolean): void {
    this.isNewlyAdded = added;
    this.newCardBorder.visible = added;
    if (added) this.redrawOutlines();
  }

  /** Animate artwork around its centre without moving the stack or its hit area. */
  setArrivalPose(pose: { scale: number; rotation: number; offsetY: number } | null): void {
    if (this.destroyed || (!pose && !this.arrivalVisual)) return;
    if (!this.arrivalVisual) {
      // Only arriving cards need this extra container. Keep the stack's shared
      // selection envelope and overlays outside the transient artwork transform.
      this.arrivalVisual = new Container();
      this.arrivalVisual.label = 'arrival-artwork';
      this.arrivalVisual.eventMode = 'none';
      this.arrivalVisual.interactiveChildren = false;
      this.addChildAt(this.arrivalVisual, 0);
      this.arrivalVisual.addChild(this.sprite);
      if (this.missingArtworkLabel) this.arrivalVisual.addChild(this.missingArtworkLabel);
      this.arrivalVisual.addChild(this.newCardBorder);
      this.arrivalVisual.pivot.set(this.displayWidth / 2, this.displayHeight / 2);
      this.hitArea = new Rectangle(0, 0, this.displayWidth, this.displayHeight);
    }
    this.arrivalVisual.position.set(this.displayWidth / 2,
      this.displayHeight / 2 + (pose?.offsetY ?? 0) * this.displayHeight);
    this.arrivalVisual.scale.set(pose?.scale ?? 1);
    this.arrivalVisual.rotation = pose?.rotation ?? 0;
  }

  private redrawOutlines(): void {
    const bounds = { left: 0, top: 0, right: this.displayWidth, bottom: this.displayHeight };
    if (this._isSelected && this.selectionEnvelope !== null) drawMangaOutline(this.selectionBorder, this.selectionEnvelope ?? bounds, this.outlineZoom);
    if (this.isNewlyAdded) drawMangaOutline(this.newCardBorder, bounds, this.outlineZoom, true);
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
    const color = options.color ?? MANGA_PALETTE.gold;
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

  setCardStatistics(presentation: CardStatisticsPresentation | null): void {
    if (!presentation) {
      this.statisticsOverlay?.destroy({ children: true });
      this.statisticsOverlay = null;
      return;
    }
    if (!this.statisticsOverlay) {
      this.statisticsOverlay = new CardStatisticsOverlay(this.displayWidth, this.displayHeight);
      this.addChildAt(this.statisticsOverlay, this.getChildIndex(this.metricOutline));
    }
    this.statisticsOverlay.setPresentation(presentation, this.outlineZoom);
  }

  updateLOD(zoom: number): void {
    if (this.outlineZoom !== zoom) {
      this.outlineZoom = Math.max(0.01, zoom);
      if (this._isSelected || this.isNewlyAdded) this.redrawOutlines();
    }
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

  /** Share the displayed texture and provenance for a drag ghost; no image requests. */
  createDragPreview(): Container {
    const preview = new Container();
    preview.eventMode = 'none';
    const image = new Sprite(this.sprite.texture);
    image.position.copyFrom(this.sprite.position);
    image.scale.copyFrom(this.sprite.scale);
    image.rotation = this.sprite.rotation;
    image.tint = this.sprite.tint;
    image.visible = true;
    if (!this.sprite.visible) {
      // A cold/offscreen card still needs a visible destination, without starting a download.
      image.rotation = 0;
      image.position.set(0, 0);
      image.texture = Texture.WHITE;
      image.width = this.displayWidth;
      image.height = this.displayHeight;
      image.tint = MANGA_PALETTE.raised;
    }
    preview.addChild(image);
    if (this.isPreview) preview.addChild(createPreviewWatermark(this.displayWidth, this.displayHeight));
    preview.position.set(this.x, this.y);
    preview.alpha = 0.6;
    return preview;
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
    if (this.destroyed) return;
    const effectiveLOD = lodManager.resolveLOD(lod);
    const requestId = ++this.textureRequestId;
    this.requestedLOD = effectiveLOD;
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
      if (this.destroyed) {
        this.markTextureLoaded();
        return;
      }
      if (texture && texture !== Texture.WHITE) {
        if (!this.canApplyLoadedTexture(effectiveLOD, requestId) || texture.destroyed) return;
        this.applyTexture(texture, effectiveLOD);
      } else {
        this.showMissingArtwork();
      }
      this.markTextureLoaded();
    } catch {
      this.showMissingArtwork();
      // A preview without local artwork must not hold up startup.
      this.markTextureLoaded();
    }
  }

  private canApplyLoadedTexture(lod: LODLevel, requestId: number): boolean {
    if (this.destroyed || this.shouldKeepDisplayedFullTexture(lod)) return false;
    if (requestId === this.textureRequestId) return true;

    // Requests can finish out of order while zooming or hovering. An older
    // result may fill in a missing image or improve a fallback while the wanted
    // detail is loading, but must never blur a sharper image or undo zoom-out.
    return (
      LOD_RANK[lod] <= LOD_RANK[this.requestedLOD] &&
      (this.displayedLOD === null || LOD_RANK[lod] > LOD_RANK[this.displayedLOD])
    );
  }

  private showMissingArtwork(): void {
    // Keep any successfully loaded LOD when a sharper image is unavailable.
    if (this.destroyed || this.displayedLOD !== null) return;
    this.sprite.rotation = 0;
    this.sprite.position.set(0, 0);
    this.sprite.width = this.displayWidth;
    this.sprite.height = this.displayHeight;
    this.sprite.visible = true;

    if (!this.missingArtworkLabel) {
      this.missingArtworkLabel = new Text({
        text: `${this.cardName}\n\nArtwork unavailable`,
        style: {
          fontFamily: 'Arial',
          fontSize: Math.round(Math.min(this.displayWidth, this.displayHeight) * 0.09),
          fill: 0xdddded,
          align: 'center',
          wordWrap: true,
          breakWords: true,
          wordWrapWidth: this.displayWidth * 0.85,
        },
      });
      this.missingArtworkLabel.anchor.set(0.5);
      this.missingArtworkLabel.position.set(this.displayWidth / 2, this.displayHeight / 2);
      (this.arrivalVisual ?? this).addChildAt(this.missingArtworkLabel, 1);
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
    this.missingArtworkLabel?.destroy();
    this.missingArtworkLabel = null;
    const targetWidth = this.displayWidth;
    const targetHeight = this.displayHeight;
    const rotateTexture = shouldRotateCardImage(
      this.isLandscape,
      texture.frame.width,
      texture.frame.height,
    );

    this.sprite.texture = texture;
    this.displayedLOD = lod;

    if (rotateTexture) {
      this.sprite.rotation = Math.PI / 2;
      this.sprite.x = targetWidth;
      this.sprite.y = 0;
      this.sprite.width = targetHeight;
      this.sprite.height = targetWidth;
    } else {
      this.sprite.rotation = 0;
      this.sprite.x = 0;
      this.sprite.y = 0;
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
