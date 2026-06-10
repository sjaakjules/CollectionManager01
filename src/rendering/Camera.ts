/**
 * Camera system for pan/zoom navigation
 *
 * Uses pixi-viewport for smooth camera-style navigation.
 * Provides:
 * - Empty-space mouse drag to pan
 * - Mouse wheel to zoom
 * - Trackpad two-finger vertical scroll to zoom
 * - Trackpad two-finger horizontal scroll to pan sideways
 * - Trackpad/touch pinch to zoom
 * - Programmatic camera control
 */

import { Viewport } from 'pixi-viewport';
import type { Application, Container } from 'pixi.js';

// ============================================================================
// Constants
// ============================================================================

export const CAMERA_DEFAULTS = {
  MIN_ZOOM: 0.02,
  MAX_ZOOM: 5.0,
  INITIAL_ZOOM: 0.1,
  DECELERATION: 0.92,
} as const;

const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_PAGE_HEIGHT_PX = 800;
const TRACKPAD_WHEEL_MIN_PX = 0.5;
const COARSE_MOUSE_WHEEL_PX = 80;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

interface WheelDeltaLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey?: boolean;
}

export function normalizeWheelDeltaPixels(event: WheelDeltaLike): {
  deltaX: number;
  deltaY: number;
} {
  const multiplier =
    event.deltaMode === DOM_DELTA_LINE
      ? WHEEL_LINE_HEIGHT_PX
      : event.deltaMode === DOM_DELTA_PAGE
        ? WHEEL_PAGE_HEIGHT_PX
        : 1;

  return {
    deltaX: event.deltaX * multiplier,
    deltaY: event.deltaY * multiplier,
  };
}

export function isTrackpadLikeWheel(event: WheelDeltaLike): boolean {
  if (event.deltaMode !== 0) return false;

  const { deltaX, deltaY } = normalizeWheelDeltaPixels(event);
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (absX >= TRACKPAD_WHEEL_MIN_PX) return true;
  if (absY <= 0) return false;
  if (!Number.isInteger(deltaY)) return true;

  return absY < COARSE_MOUSE_WHEEL_PX;
}

export function shouldPanSidewaysFromWheel(event: WheelDeltaLike): boolean {
  if (event.ctrlKey) return false;

  const { deltaX } = normalizeWheelDeltaPixels(event);
  const absX = Math.abs(deltaX);

  return absX >= TRACKPAD_WHEEL_MIN_PX && isTrackpadLikeWheel(event);
}

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
  private readonly wheelTarget?: HTMLCanvasElement;
  private readonly handleResizeBound = this.handleResize.bind(this);
  private readonly handleWheelBound = this.handleWheel.bind(this);

  constructor(config: CameraConfig) {
    this.onZoomChange = config.onZoomChange;
    this.onViewportChange = config.onViewportChange;
    this.wheelTarget = config.app.canvas;

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
    window.addEventListener('resize', this.handleResizeBound);
    this.wheelTarget.addEventListener('wheel', this.handleWheelBound, {
      capture: true,
      passive: false,
    });
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

  panByScreenDelta(deltaX: number, deltaY: number): void {
    const corner = this.viewport.corner;
    this.viewport.moveCorner(
      corner.x + deltaX / this.viewport.scale.x,
      corner.y + deltaY / this.viewport.scale.y,
    );
    this.viewport.emit('moved', { viewport: this.viewport, type: 'wheel' });
  }

  fitToContent(bounds: CameraBounds, padding = 100, time = 800): void {
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
      time,
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

  /**
   * Get the center of the screen in world coordinates
   */
  getScreenCenter(): { x: number; y: number } {
    const bounds = this.getVisibleBounds();
    return {
      x: (bounds.left + bounds.right) / 2,
      y: (bounds.top + bounds.bottom) / 2,
    };
  }

  resize(width: number, height: number): void {
    this.viewport.resize(width, height);
  }

  destroy(): void {
    window.removeEventListener('resize', this.handleResizeBound);
    this.wheelTarget?.removeEventListener('wheel', this.handleWheelBound, {
      capture: true,
    });
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

  private handleWheel(event: WheelEvent): void {
    if (!shouldPanSidewaysFromWheel(event)) return;

    const { deltaX } = normalizeWheelDeltaPixels(event);
    this.panByScreenDelta(deltaX, 0);
  }
}
