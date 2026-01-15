/**
 * PixiJS application setup and card scene management
 *
 * Creates the WebGL renderer, manages the card container,
 * and coordinates between the camera and card sprites.
 */

import { Application, Container } from 'pixi.js';
import { Camera } from './Camera';
import { CardSprite, type CardSpriteState } from './CardSprite';
import { calculateCardLayout, GRID_UNIT } from './Grid';
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

// ============================================================================
// PixiStage Class
// ============================================================================

export class PixiStage {
  private app: Application;
  private camera: Camera | null = null;
  private cardContainer: Container;
  private cardSprites: Map<string, CardSprite> = new Map();
  private cards: Card[] = [];

  private onAddToDeck: (cardName: string) => void;
  private onRemoveFromDeck: (cardName: string) => void;

  constructor(config: PixiStageConfig) {
    this.onAddToDeck = config.onAddToDeck;
    this.onRemoveFromDeck = config.onRemoveFromDeck;

    // Create PixiJS application
    this.app = new Application();

    // Card container (added to camera viewport)
    this.cardContainer = new Container();

    // Initialize async
    this.initialize(config.container);
  }

  private async initialize(container: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x1a1a2e,
      resizeTo: container,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    container.appendChild(this.app.canvas);

    // Create camera with estimated world size (will adjust based on cards)
    this.camera = new Camera({
      app: this.app,
      worldWidth: 50000,
      worldHeight: 20000,
      onZoomChange: this.handleZoomChange.bind(this),
    });

    // Add card container to camera viewport
    this.camera.container.addChild(this.cardContainer);

    // Start render loop
    this.app.ticker.add(this.update.bind(this));
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  setCards(cards: Card[]): void {
    this.cards = cards;
    this.rebuildCardSprites();
  }

  updateDeckOverlays(
    deck: Deck | null,
    activeBoard: ActiveBoard,
    collection: CollectionItem[]
  ): void {
    // Build lookup maps for quick access
    const deckQuantities = new Map<string, number>();
    const collectionQuantities = new Map<string, number>();

    if (deck) {
      // Combine mainboard and sideboard for limit tracking (maybeboard excluded)
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

    // Update each card sprite
    for (const [name, sprite] of this.cardSprites) {
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

      sprite.updateState({
        quantity: deckQty,
        quantityColor,
        isSelected: false,
        isHighlighted: true,
      });
    }
  }

  destroy(): void {
    this.app.ticker.stop();
    this.camera?.destroy();
    lodManager.clearCache();
    this.app.destroy(true, { children: true });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private rebuildCardSprites(): void {
    // Clear existing sprites
    for (const sprite of this.cardSprites.values()) {
      sprite.destroy();
    }
    this.cardSprites.clear();
    this.cardContainer.removeChildren();

    if (this.cards.length === 0) return;

    // Prepare layout data
    const layoutCards = this.cards.map((card) => ({
      name: card.name,
      type: card.guardian.type,
      thresholdGroup: getThresholdGroup(card.guardian.thresholds),
      cost: card.guardian.cost,
      isLandscape: card.guardian.type === 'Site',
    }));

    // Calculate positions
    const layout = calculateCardLayout({ cards: layoutCards });

    // Create sprites
    for (const cardLayout of layout) {
      const card = this.cards.find((c) => c.name === cardLayout.name);
      if (!card) continue;

      // Get default variant slug (first variant of first set)
      const defaultVariant = card.sets[0]?.variants[0]?.slug ?? card.name;

      const sprite = new CardSprite({
        name: card.name,
        variantSlug: defaultVariant,
        isLandscape: cardLayout.isLandscape,
        x: cardLayout.position.x,
        y: cardLayout.position.y,
        onAddToDeck: this.onAddToDeck,
        onRemoveFromDeck: this.onRemoveFromDeck,
      });

      this.cardSprites.set(card.name, sprite);
      this.cardContainer.addChild(sprite);
    }

    // Fit camera to content
    if (layout.length > 0 && this.camera) {
      const bounds = this.calculateContentBounds(layout);
      this.camera.fitToContent(bounds);
    }
  }

  private calculateContentBounds(
    layout: Array<{ position: { x: number; y: number }; isLandscape: boolean }>
  ): { left: number; top: number; right: number; bottom: number } {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    for (const card of layout) {
      const width = card.isLandscape ? 3 * GRID_UNIT : 2 * GRID_UNIT;
      const height = card.isLandscape ? 2 * GRID_UNIT : 3 * GRID_UNIT;

      left = Math.min(left, card.position.x);
      top = Math.min(top, card.position.y);
      right = Math.max(right, card.position.x + width);
      bottom = Math.max(bottom, card.position.y + height);
    }

    return { left, top, right, bottom };
  }

  private handleZoomChange(zoom: number): void {
    // Update LOD for all visible cards
    for (const sprite of this.cardSprites.values()) {
      sprite.updateLOD(zoom);
    }
  }

  private update(): void {
    // Per-frame updates if needed
    // Currently handled by PixiJS internally
  }
}
