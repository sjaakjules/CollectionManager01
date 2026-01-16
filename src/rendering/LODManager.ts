/**
 * Level of Detail (LOD) management for card textures
 *
 * Manages multiple resolution textures for each card:
 * - Thumbnail: Used when zoomed out (fast loading, low memory)
 * - Medium: Used at normal zoom levels
 * - Full: Used when hovering or zoomed in (highest quality)
 *
 * Performance optimizations:
 * - Concurrent loading with configurable batch size
 * - Priority queue for visible cards
 * - Failed load tracking to avoid retries
 * - Texture caching with sync access
 *
 * Currently uses local images from /assets/Cards/ directory.
 * All LOD levels use the same image (webp format already optimized).
 */

import { Assets, Texture } from 'pixi.js';

// ============================================================================
// Constants
// ============================================================================

export const LOD_LEVELS = {
  THUMBNAIL: 'thumbnail',
  MEDIUM: 'medium',
  FULL: 'full',
} as const;

export type LODLevel = (typeof LOD_LEVELS)[keyof typeof LOD_LEVELS];

// Zoom thresholds for LOD switching
export const LOD_ZOOM_THRESHOLDS = {
  THUMBNAIL_MAX: 0.1,
  MEDIUM_MAX: 0.4,
} as const;

// Local image path
const LOCAL_IMAGE_PATH = '/assets/Cards';

// Concurrent texture loads (higher = more parallelism but more memory pressure)
const CONCURRENT_LOADS = 8;

// Batch size for preloading
const PRELOAD_BATCH_SIZE = 20;

// ============================================================================
// Types
// ============================================================================

interface TextureCache {
  texture?: Texture;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize special characters to ASCII equivalents
 * e.g., "ö" -> "o", "é" -> "e", "Ä" -> "a"
 */
function normalizeToAscii(str: string): string {
  // Use Unicode normalization to decompose characters
  // NFD splits "ö" into "o" + combining diaeresis
  // Then we remove the combining marks
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // Remove combining diacritical marks
}

/**
 * Convert a card name to a local image filename slug
 * e.g., "Cave Trolls" -> "cave_trolls"
 * e.g., "Sjaelström" -> "sjaelstrom"
 * e.g., "East-West Dragon" -> "east_west_dragon"
 */
export function cardNameToSlug(cardName: string): string {
  return normalizeToAscii(cardName)
    .toLowerCase()
    .replace(/['']/g, '')           // Remove apostrophes
    .replace(/[-\s]+/g, '_')        // Replace hyphens and spaces with underscores
    .replace(/[^a-z0-9_]/g, '')     // Remove remaining special chars (keep underscores)
    .replace(/_+/g, '_')            // Collapse multiple underscores
    .replace(/^_|_$/g, '')          // Trim leading/trailing underscores
    .trim();
}

// ============================================================================
// LOD Manager
// ============================================================================

export class LODManager {
  private cache: Map<string, TextureCache> = new Map();
  private loadingPromises: Map<string, Promise<Texture>> = new Map();
  private failedLoads: Set<string> = new Set();

  /**
   * Get the appropriate LOD level for a given zoom
   */
  getLODForZoom(zoom: number): LODLevel {
    if (zoom < LOD_ZOOM_THRESHOLDS.THUMBNAIL_MAX) {
      return LOD_LEVELS.THUMBNAIL;
    }
    if (zoom < LOD_ZOOM_THRESHOLDS.MEDIUM_MAX) {
      return LOD_LEVELS.MEDIUM;
    }
    return LOD_LEVELS.FULL;
  }

  /**
   * Get texture for a card at specified LOD level
   * Returns cached texture or loads it if not available
   */
  async getTexture(cardNameOrSlug: string, _lod: LODLevel): Promise<Texture> {
    const slug = cardNameOrSlug.includes('_') ? cardNameOrSlug : cardNameToSlug(cardNameOrSlug);

    // Skip if we already know this image failed
    if (this.failedLoads.has(slug)) {
      return Texture.WHITE;
    }

    // Check cache first
    const cached = this.cache.get(slug);
    if (cached?.texture) {
      return cached.texture;
    }

    // Check if already loading
    const loadingPromise = this.loadingPromises.get(slug);
    if (loadingPromise) {
      return loadingPromise;
    }

    // Start loading
    const url = this.getImageUrl(slug);
    const promise = this.loadTexture(url, slug);
    this.loadingPromises.set(slug, promise);

    try {
      const texture = await promise;
      this.cacheTexture(slug, texture);
      return texture;
    } catch {
      this.failedLoads.add(slug);
      return Texture.WHITE;
    } finally {
      this.loadingPromises.delete(slug);
    }
  }

  /**
   * Get texture synchronously if cached, otherwise return null
   */
  getTextureSync(cardNameOrSlug: string, _lod: LODLevel): Texture | null {
    const slug = cardNameOrSlug.includes('_') ? cardNameOrSlug : cardNameToSlug(cardNameOrSlug);
    const cached = this.cache.get(slug);
    return cached?.texture ?? null;
  }

  /**
   * Preload textures for visible cards
   * Uses concurrent loading with controlled parallelism for better performance
   */
  async preloadTextures(cardNames: string[]): Promise<void> {
    // Filter out already loaded/loading/failed
    const toLoad = cardNames.filter((name) => {
      const slug = cardNameToSlug(name);
      return (
        !this.cache.has(slug) &&
        !this.failedLoads.has(slug) &&
        !this.loadingPromises.has(slug)
      );
    });

    if (toLoad.length === 0) return;

    // Process in batches with controlled concurrency
    for (let i = 0; i < toLoad.length; i += PRELOAD_BATCH_SIZE) {
      const batch = toLoad.slice(i, i + PRELOAD_BATCH_SIZE);

      // Use a semaphore-like approach for concurrent loading
      const loadPromises: Promise<void>[] = [];
      let activeLoads = 0;
      let batchIndex = 0;

      const loadNext = async (): Promise<void> => {
        while (batchIndex < batch.length) {
          if (activeLoads >= CONCURRENT_LOADS) {
            // Wait for slot to free up
            await new Promise((resolve) => setTimeout(resolve, 10));
            continue;
          }

          const name = batch[batchIndex++];
          if (!name) break;

          activeLoads++;
          this.getTexture(name, LOD_LEVELS.THUMBNAIL)
            .catch(() => null)
            .finally(() => {
              activeLoads--;
            });
        }
      };

      // Start concurrent loaders
      for (let j = 0; j < Math.min(CONCURRENT_LOADS, batch.length); j++) {
        loadPromises.push(loadNext());
      }

      await Promise.all(loadPromises);
    }
  }

  /**
   * Clear cached textures to free memory
   */
  clearCache(): void {
    for (const cached of this.cache.values()) {
      cached.texture?.destroy();
    }
    this.cache.clear();
    this.failedLoads.clear();
  }

  /**
   * Get number of cached textures
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  private getImageUrl(slug: string): string {
    return `${LOCAL_IMAGE_PATH}/${slug}.webp`;
  }

  private async loadTexture(url: string, slug: string): Promise<Texture> {
    try {
      // Use Assets.load for proper caching and management
      const texture = await Assets.load<Texture>(url);
      return texture;
    } catch (error) {
      // Only log once per card to avoid spam
      if (!this.failedLoads.has(slug)) {
        console.warn(`Image not found: ${slug}.webp`);
      }
      throw error;
    }
  }

  private cacheTexture(slug: string, texture: Texture): void {
    this.cache.set(slug, { texture });
  }
}

// Singleton instance
export const lodManager = new LODManager();
