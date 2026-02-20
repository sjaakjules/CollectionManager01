/**
 * Level of Detail (LOD) management for card textures
 *
 * Manages multiple resolution textures for each card:
 * - Thumbnail: Used when zoomed out (fast loading, low memory)
 * - Medium: Used at normal zoom levels
 * - Full: Used when hovering or zoomed in (highest quality)
 *
 * By default, all LOD levels fall back to /assets/Cards/*.webp.
 * Optional separate LOD assets can be enabled with:
 * - VITE_CARD_LOD_ASSETS=1
 * - VITE_CARD_THUMBNAIL_PATH=/assets/CardsThumb   (optional)
 * - VITE_CARD_MEDIUM_PATH=/assets/CardsMedium     (optional)
 */

import { Assets, Texture, TextureSource } from 'pixi.js';

// Enable mipmaps globally for better quality when downscaling large card images
TextureSource.defaultOptions.autoGenerateMipmaps = true;

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

const USE_SEPARATE_LOD_ASSETS =
  import.meta.env.VITE_CARD_LOD_ASSETS === '1' ||
  import.meta.env.VITE_CARD_LOD_ASSETS === 'true';
const FULL_IMAGE_PATH = '/assets/Cards';
const THUMBNAIL_IMAGE_PATH =
  import.meta.env.VITE_CARD_THUMBNAIL_PATH ?? '/assets/CardsThumb';
const MEDIUM_IMAGE_PATH =
  import.meta.env.VITE_CARD_MEDIUM_PATH ?? '/assets/CardsMedium';

const CONCURRENT_LOADS = 8;
const PRELOAD_BATCH_SIZE = 20;
const BACKGROUND_CONCURRENT_LOADS = 2;
const BACKGROUND_BATCH_SIZE = 12;

// ============================================================================
// Types
// ============================================================================

interface TextureCache {
  [LOD_LEVELS.THUMBNAIL]?: Texture;
  [LOD_LEVELS.MEDIUM]?: Texture;
  [LOD_LEVELS.FULL]?: Texture;
}

interface PreloadOptions {
  lod?: LODLevel;
  concurrentLoads?: number;
  batchSize?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize special characters to ASCII equivalents
 * e.g., "ö" -> "o", "é" -> "e", "Ä" -> "a"
 */
function normalizeToAscii(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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
    .replace(/['']/g, '')
    .replace(/[-\s]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
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
  async getTexture(cardNameOrSlug: string, lod: LODLevel): Promise<Texture> {
    const slug = cardNameOrSlug.includes('_')
      ? cardNameOrSlug
      : cardNameToSlug(cardNameOrSlug);
    const loadKey = this.getLoadKey(slug, lod);

    if (this.failedLoads.has(loadKey)) {
      return Texture.WHITE;
    }

    const cachedTexture = this.getCachedTexture(slug, lod);
    if (cachedTexture) {
      return cachedTexture;
    }

    const loadingPromise = this.loadingPromises.get(loadKey);
    if (loadingPromise) {
      return loadingPromise;
    }

    const promise = this.loadTexture(slug, lod);
    this.loadingPromises.set(loadKey, promise);

    try {
      const texture = await promise;
      this.cacheTexture(slug, lod, texture);
      return texture;
    } catch {
      this.failedLoads.add(loadKey);
      return Texture.WHITE;
    } finally {
      this.loadingPromises.delete(loadKey);
    }
  }

  /**
   * Get texture synchronously if cached, otherwise return null
   */
  getTextureSync(cardNameOrSlug: string, lod: LODLevel): Texture | null {
    const slug = cardNameOrSlug.includes('_')
      ? cardNameOrSlug
      : cardNameToSlug(cardNameOrSlug);
    return this.getCachedTexture(slug, lod);
  }

  /**
   * Preload textures with controlled parallelism.
   */
  async preloadTextures(
    cardNames: string[],
    options: PreloadOptions = {},
  ): Promise<void> {
    const lod = options.lod ?? LOD_LEVELS.THUMBNAIL;
    const concurrentLoads = options.concurrentLoads ?? CONCURRENT_LOADS;
    const batchSize = options.batchSize ?? PRELOAD_BATCH_SIZE;

    const toLoad = cardNames.filter((name) => {
      const slug = cardNameToSlug(name);
      const loadKey = this.getLoadKey(slug, lod);
      return (
        !this.getCachedTexture(slug, lod) &&
        !this.failedLoads.has(loadKey) &&
        !this.loadingPromises.has(loadKey)
      );
    });

    if (toLoad.length === 0) return;

    for (let i = 0; i < toLoad.length; i += batchSize) {
      const batch = toLoad.slice(i, i + batchSize);
      const queue = [...batch];
      const workerCount = Math.min(concurrentLoads, queue.length);

      const workers: Promise<void>[] = [];
      for (let worker = 0; worker < workerCount; worker++) {
        workers.push((async () => {
          while (queue.length > 0) {
            const name = queue.shift();
            if (!name) break;
            await this.getTexture(name, lod).catch(() => null);
          }
        })());
      }

      await Promise.all(workers);
    }
  }

  /**
   * Slowly preload full-resolution textures in the background.
   */
  async preloadFullTextures(cardNames: string[]): Promise<void> {
    await this.preloadTextures(cardNames, {
      lod: LOD_LEVELS.FULL,
      concurrentLoads: BACKGROUND_CONCURRENT_LOADS,
      batchSize: BACKGROUND_BATCH_SIZE,
    });
  }

  /**
   * Clear cached textures to free memory
   */
  clearCache(): void {
    const seen = new Set<Texture>();
    for (const cached of this.cache.values()) {
      for (const texture of Object.values(cached)) {
        if (!texture || seen.has(texture)) continue;
        seen.add(texture);
        texture.destroy();
      }
    }
    this.cache.clear();
    this.failedLoads.clear();
    this.loadingPromises.clear();
  }

  /**
   * Get number of cached cards
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  private getLoadKey(slug: string, lod: LODLevel): string {
    return `${slug}:${lod}`;
  }

  private getCachedTexture(slug: string, lod: LODLevel): Texture | null {
    const cached = this.cache.get(slug);
    if (!cached) return null;

    if (lod === LOD_LEVELS.THUMBNAIL) {
      return cached.thumbnail ?? cached.medium ?? cached.full ?? null;
    }
    if (lod === LOD_LEVELS.MEDIUM) {
      return cached.medium ?? cached.full ?? cached.thumbnail ?? null;
    }
    return cached.full ?? cached.medium ?? cached.thumbnail ?? null;
  }

  private getImageUrls(slug: string, lod: LODLevel): string[] {
    const fullUrl = `${FULL_IMAGE_PATH}/${slug}.webp`;
    if (!USE_SEPARATE_LOD_ASSETS) {
      return [fullUrl];
    }

    let urls: string[];
    if (lod === LOD_LEVELS.THUMBNAIL) {
      urls = [`${THUMBNAIL_IMAGE_PATH}/${slug}.webp`, fullUrl];
    } else if (lod === LOD_LEVELS.MEDIUM) {
      urls = [`${MEDIUM_IMAGE_PATH}/${slug}.webp`, fullUrl];
    } else {
      urls = [fullUrl];
    }

    return Array.from(new Set(urls));
  }

  private async loadTexture(slug: string, lod: LODLevel): Promise<Texture> {
    const urls = this.getImageUrls(slug, lod);
    let lastError: unknown;

    for (const url of urls) {
      try {
        return await Assets.load<Texture>(url);
      } catch (error) {
        lastError = error;
      }
    }

    if (!this.failedLoads.has(this.getLoadKey(slug, lod))) {
      console.warn(`Image not found: ${slug}.webp (${lod})`);
    }
    throw lastError ?? new Error(`Failed to load texture for ${slug} (${lod})`);
  }

  private cacheTexture(slug: string, lod: LODLevel, texture: Texture): void {
    const cached = this.cache.get(slug) ?? {};
    cached[lod] = texture;
    this.cache.set(slug, cached);
  }
}

// Singleton instance
export const lodManager = new LODManager();
