/**
 * Camera system for pan/zoom navigation
 *
 * Uses pixi-viewport for smooth camera-style navigation.
 * Provides:
 * - Mouse drag to pan
 * - Scroll wheel to zoom
 * - Pinch-to-zoom on trackpad
 * - Programmatic camera control
 */

import { Viewport } from 'pixi-viewport';
import type { Application, Container } from 'pixi.js';

// ============================================================================
// Constants
// ============================================================================

export const CAMERA_DEFAULTS = {
  MIN_ZOOM: 0.02,
  MAX_ZOOM: 1.5,
  INITIAL_ZOOM: 0.1,
  DECELERATION: 0.92,
} as const;

// ============================================================================
// Types
// ============================================================================

export interface CameraConfig {
  app: Application;
  worldWidth: number;
  worldHeight: number;
  onZoomChange?: (zoom: number) => void;
  onViewportChange?: () => void;
}

export interface CameraBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// ============================================================================
// Camera Class
// ============================================================================

export class Camera {
  public readonly viewport: Viewport;
  private onZoomChange?: (zoom: number) => void;
  private onViewportChange?: () => void;
  private currentZoom: number = CAMERA_DEFAULTS.INITIAL_ZOOM;

  constructor(config: CameraConfig) {
    this.onZoomChange = config.onZoomChange;
    this.onViewportChange = config.onViewportChange;

    // Create viewport
    this.viewport = new Viewport({
      screenWidth: config.app.screen.width,
      screenHeight: config.app.screen.height,
      worldWidth: config.worldWidth,
      worldHeight: config.worldHeight,
      events: config.app.renderer.events,
    });

    // Add viewport to stage
    config.app.stage.addChild(this.viewport);

    // Enable interactions
    this.viewport
      .drag()
      .pinch()
      .wheel()
      .decelerate({ friction: CAMERA_DEFAULTS.DECELERATION })
      .clampZoom({
        minScale: CAMERA_DEFAULTS.MIN_ZOOM,
        maxScale: CAMERA_DEFAULTS.MAX_ZOOM,
      });

    // Set initial zoom
    this.viewport.setZoom(CAMERA_DEFAULTS.INITIAL_ZOOM);

    // Listen for zoom changes
    this.viewport.on('zoomed', this.handleZoomChange.bind(this));

    // Listen for viewport movements (for culling updates)
    this.viewport.on('moved', this.handleViewportMove.bind(this));

    // Handle window resize
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  get zoom(): number {
    return this.currentZoom;
  }

  get container(): Container {
    return this.viewport;
  }

  /**
   * Pause viewport dragging (e.g., when dragging cards)
   */
  pauseDrag(): void {
    this.viewport.plugins.pause('drag');
  }

  /**
   * Resume viewport dragging
   */
  resumeDrag(): void {
    this.viewport.plugins.resume('drag');
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return this.viewport.toWorld(screenX, screenY);
  }

  setZoom(scale: number, center?: { x: number; y: number }): void {
    if (center) {
      this.viewport.animate({
        scale,
        position: center,
        time: 300,
        ease: 'easeOutQuad',
      });
    } else {
      this.viewport.setZoom(scale, true);
    }
  }

  panTo(x: number, y: number, animate = true): void {
    if (animate) {
      this.viewport.animate({
        position: { x, y },
        time: 300,
        ease: 'easeOutQuad',
      });
    } else {
      this.viewport.moveCenter(x, y);
    }
  }

  fitToContent(bounds: CameraBounds, padding = 100): void {
    const width = bounds.right - bounds.left + padding * 2;
    const height = bounds.bottom - bounds.top + padding * 2;

    const scaleX = this.viewport.screenWidth / width;
    const scaleY = this.viewport.screenHeight / height;
    const scale = Math.min(scaleX, scaleY, CAMERA_DEFAULTS.MAX_ZOOM);
    const clampedScale = Math.max(scale, CAMERA_DEFAULTS.MIN_ZOOM);

    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;

    // Update current zoom tracking
    this.currentZoom = clampedScale;

    this.viewport.animate({
      scale: clampedScale,
      position: { x: centerX, y: centerY },
      time: 800,
      ease: 'easeOutQuad',
    });

    // Notify about zoom change after animation starts
    this.onZoomChange?.(clampedScale);
  }

  getVisibleBounds(): CameraBounds {
    const corner = this.viewport.corner;
    return {
      left: corner.x,
      top: corner.y,
      right: corner.x + this.viewport.worldScreenWidth,
      bottom: corner.y + this.viewport.worldScreenHeight,
    };
  }

  resize(width: number, height: number): void {
    this.viewport.resize(width, height);
  }

  destroy(): void {
    window.removeEventListener('resize', this.handleResize.bind(this));
    this.viewport.destroy();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private handleZoomChange(): void {
    const newZoom = this.viewport.scale.x;
    if (newZoom !== this.currentZoom) {
      this.currentZoom = newZoom;
      this.onZoomChange?.(newZoom);
    }
    // Zoom changes also affect visible area
    this.onViewportChange?.();
  }

  private handleViewportMove(): void {
    this.onViewportChange?.();
  }

  private handleResize(): void {
    this.resize(window.innerWidth, window.innerHeight);
    this.onViewportChange?.();
  }
}
