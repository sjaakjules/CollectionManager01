/**
 * Card animation system
 *
 * Provides throw animation for cards appearing on screen.
 * Cards start from a spawn point and animate to their final position
 * with rotation to simulate a throwing effect.
 */

import type { Container } from 'pixi.js';

// ============================================================================
// Types
// ============================================================================

export interface ThrowAnimationConfig {
  /** Starting X position (world coordinates) */
  startX: number;
  /** Starting Y position (world coordinates) */
  startY: number;
  /** Target X position (top-left of card) */
  targetX: number;
  /** Target Y position (top-left of card) */
  targetY: number;
  /** Animation duration in milliseconds */
  duration: number;
  /** Stagger delay between cards in milliseconds */
  delay: number;
  /** Delay after texture loads before animation starts in milliseconds */
  holdTime: number;
  /** Number of rotations during flight (can be fractional, negative for CCW) */
  rotations: number;
  /** Starting scale (> 1 for larger start, < 1 for smaller start) */
  startScale: number;
  /** Promise that must resolve before animation starts (e.g., texture loading) */
  waitFor?: Promise<void>;
  /** Callback when animation completes */
  onComplete?: () => void;
}

interface ActiveAnimation {
  sprite: Container;
  config: ThrowAnimationConfig;
  startTime: number;
  initialRotation: number;
  originalZIndex: number;
  /** Actual start position calculated when animation begins */
  startX: number;
  startY: number;
}

// ============================================================================
// Easing Functions
// ============================================================================

/** Ease out cubic - decelerating to zero velocity */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Ease out quint - strong deceleration at the end */
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

// ============================================================================
// Card Animation Manager
// ============================================================================

class CardAnimationManager {
  private activeAnimations: ActiveAnimation[] = [];
  private animationFrameId: number | null = null;
  private isRunning = false;
  private _totalAnimations = 0;
  private _completedAnimations = 0;
  private _onProgress?: (completed: number, total: number) => void;

  /**
   * Start a throw animation for a sprite
   * If config.waitFor is provided, waits for that promise, shows sprite at spawn point,
   * then delays by holdTime before starting the flight animation.
   */
  animate(sprite: Container, config: ThrowAnimationConfig): void {
    // Position sprite at spawn point immediately (hidden until texture loads)
    sprite.x = config.startX;
    sprite.y = config.startY;
    sprite.scale.set(config.startScale);
    sprite.alpha = 0;
    sprite.visible = false;

    const onReady = () => {
      // Only proceed if we haven't been cancelled
      if (this._totalAnimations === 0) return;

      // Ensure sprite is at spawn point (in case anything moved it)
      sprite.x = config.startX;
      sprite.y = config.startY;
      sprite.scale.set(config.startScale);

      // Show sprite at spawn point
      sprite.visible = true;
      sprite.alpha = 1;
      sprite.zIndex = 10000; // Draw on top of stationary cards

      // Schedule animation to start after holdTime delay
      const animationStartTime = performance.now() + config.delay + config.holdTime;
      this.startAnimation(sprite, config, animationStartTime);
    };

    if (config.waitFor) {
      config.waitFor.then(onReady);
    } else {
      onReady();
    }
  }

  private startAnimation(sprite: Container, config: ThrowAnimationConfig, scheduledStartTime: number): void {
    // Store initial rotation (for landscape cards that are already rotated)
    const initialRotation = sprite.rotation;
    const originalZIndex = sprite.zIndex;

    // Sprite is already visible at spawn point from animate() - just register for animation
    const animation: ActiveAnimation = {
      sprite,
      config,
      startTime: scheduledStartTime,
      initialRotation,
      originalZIndex,
      startX: config.startX,
      startY: config.startY,
    };

    this.activeAnimations.push(animation);

    if (!this.isRunning) {
      this.start();
    }
  }

  /**
   * Cancel all active animations
   */
  cancelAll(): void {
    this.activeAnimations = [];
    this._totalAnimations = 0;
    this._completedAnimations = 0;
    this.stop();
  }

  /**
   * Check if any animations are currently running
   */
  get isAnimating(): boolean {
    return this.activeAnimations.length > 0 || this._totalAnimations > this._completedAnimations;
  }

  /**
   * Get animation progress (0 to 1)
   */
  get progress(): number {
    if (this._totalAnimations === 0) return 1;
    return this._completedAnimations / this._totalAnimations;
  }

  /**
   * Set callback for progress updates
   */
  setProgressCallback(callback: ((completed: number, total: number) => void) | undefined): void {
    this._onProgress = callback;
  }

  /**
   * Start a new animation batch (resets counters)
   */
  startBatch(totalCount: number): void {
    this._totalAnimations = totalCount;
    this._completedAnimations = 0;
    this._onProgress?.(0, totalCount);
  }

  private start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.tick();
  }

  private stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.isRunning = false;
  }

  private tick = (): void => {
    if (!this.isRunning) return;

    const now = performance.now();
    const completed: ActiveAnimation[] = [];

    for (const anim of this.activeAnimations) {
      const elapsed = now - anim.startTime;

      // Still waiting for animation to start (in holdTime delay)
      if (elapsed < 0) {
        continue;
      }

      const { config, sprite, initialRotation, startX, startY } = anim;

      // Calculate progress through the flight animation
      const progress = Math.min(elapsed / config.duration, 1);

      // Use easing for smooth animation
      const easedProgress = easeOutCubic(progress);
      const scaleProgress = easeOutQuint(progress);

      // Interpolate position (from stored start position to target)
      sprite.x = startX + (config.targetX - startX) * easedProgress;
      sprite.y = startY + (config.targetY - startY) * easedProgress;

      // Interpolate scale (works for both shrinking and growing)
      const currentScale = config.startScale + (1 - config.startScale) * scaleProgress;
      sprite.scale.set(currentScale);

      // Interpolate rotation (add to initial rotation for landscape cards)
      const rotationAmount = config.rotations * (1 - easedProgress);
      sprite.rotation = initialRotation + rotationAmount;

      if (progress >= 1) {
        // Animation complete - ensure final values are exact
        sprite.x = config.targetX;
        sprite.y = config.targetY;
        sprite.scale.set(1);
        sprite.rotation = initialRotation;
        sprite.alpha = 1;
        sprite.zIndex = anim.originalZIndex;
        completed.push(anim);
      }
    }

    // Remove completed animations and call callbacks
    for (const anim of completed) {
      const index = this.activeAnimations.indexOf(anim);
      if (index >= 0) {
        this.activeAnimations.splice(index, 1);
      }
      this._completedAnimations++;
      anim.config.onComplete?.();
    }

    // Notify progress if any completed
    if (completed.length > 0) {
      this._onProgress?.(this._completedAnimations, this._totalAnimations);
    }

    // Continue animation loop if there are more animations
    if (this.activeAnimations.length > 0) {
      this.animationFrameId = requestAnimationFrame(this.tick);
    } else {
      this.stop();
    }
  };
}

// Export singleton instance
export const cardAnimationManager = new CardAnimationManager();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a shuffled array of indices from 0 to count-1
 * Used to randomize animation order without modifying the original data
 */
export function generateRandomIndices(count: number): number[] {
  // Create array [0, 1, 2, ..., count-1]
  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    indices.push(i);
  }

  // Fisher-Yates shuffle
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = indices[i] as number;
    indices[i] = indices[j] as number;
    indices[j] = temp;
  }

  return indices;
}

/**
 * Generate random throw animation config
 * @param startX - Starting X position (world coordinates)
 * @param startY - Starting Y position (world coordinates)
 * @param targetX - Target X position (top-left of card)
 * @param targetY - Target Y position (top-left of card)
 * @param index - Card index for staggering delays
 */
export function generateThrowConfig(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  index: number
): ThrowAnimationConfig {
  // Stagger delays so cards don't all spawn at once
  // Each card waits a bit longer than the previous
  const baseDelay = 3; // ms between cards (fast paced)
  const delay = index * baseDelay;

  // Random rotation ±45 degrees (π/4 radians)
  const rotationDirection = Math.random() > 0.5 ? 1 : -1;
  const rotations = rotationDirection * (Math.PI / 4);

  // Animation duration varies slightly for organic feel
  const baseDuration = 600;
  const durationVariance = 200;
  const duration = baseDuration + Math.random() * durationVariance;

  return {
    startX,
    startY,
    targetX,
    targetY,
    duration,
    delay,
    holdTime: 500, // Delay after texture loads before animation starts
    rotations,
    startScale: 20.0, // Start large and shrink down
  };
}
