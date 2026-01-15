/**
 * Level of Detail (LOD) management for card textures
 *
 * Manages multiple resolution textures for each card:
 * - Thumbnail: Used when zoomed out (fast loading, low memory)
 * - Medium: Used at normal zoom levels
 * - Full: Used when hovering or zoomed in (highest quality)
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
  THUMBNAIL_MAX: 0.15,
  MEDIUM_MAX: 0.5,
} as const;

// Image URL patterns - adjust based on actual CDN structure
const IMAGE_BASE_URL = 'https://card.sorcerytcg.com';

// ============================================================================
// Types
// ============================================================================

interface TextureCache {
  thumbnail?: Texture;
  medium?: Texture;
  full?: Texture;
}

// ============================================================================
// LOD Manager
// ============================================================================

export class LODManager {
  private cache: Map<string, TextureCache> = new Map();
  private loadingPromises: Map<string, Promise<Texture>> = new Map();

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
  async getTexture(variantSlug: string, lod: LODLevel): Promise<Texture> {
    const cacheKey = `${variantSlug}_${lod}`;

    // Check cache first
    const cached = this.cache.get(variantSlug);
    if (cached?.[lod]) {
      return cached[lod]!;
    }

    // Check if already loading
    const loadingPromise = this.loadingPromises.get(cacheKey);
    if (loadingPromise) {
      return loadingPromise;
    }

    // Start loading
    const url = this.getImageUrl(variantSlug, lod);
    const promise = this.loadTexture(url);
    this.loadingPromises.set(cacheKey, promise);

    try {
      const texture = await promise;
      this.cacheTexture(variantSlug, lod, texture);
      return texture;
    } finally {
      this.loadingPromises.delete(cacheKey);
    }
  }

  /**
   * Get texture synchronously if cached, otherwise return placeholder
   */
  getTextureSync(variantSlug: string, lod: LODLevel): Texture | null {
    const cached = this.cache.get(variantSlug);
    if (cached?.[lod]) {
      return cached[lod]!;
    }

    // Try lower LOD levels as fallback
    if (lod === LOD_LEVELS.FULL && cached?.medium) {
      return cached.medium;
    }
    if ((lod === LOD_LEVELS.FULL || lod === LOD_LEVELS.MEDIUM) && cached?.thumbnail) {
      return cached.thumbnail;
    }

    return null;
  }

  /**
   * Preload textures for visible cards
   */
  async preloadForViewport(
    variantSlugs: string[],
    lod: LODLevel
  ): Promise<void> {
    const promises = variantSlugs.map((slug) =>
      this.getTexture(slug, lod).catch((error) => {
        console.warn(`Failed to preload texture for ${slug}:`, error);
        return null;
      })
    );
    await Promise.all(promises);
  }

  /**
   * Clear cached textures to free memory
   */
  clearCache(): void {
    for (const cached of this.cache.values()) {
      cached.thumbnail?.destroy();
      cached.medium?.destroy();
      cached.full?.destroy();
    }
    this.cache.clear();
  }

  /**
   * Clear textures for cards no longer visible
   */
  evictUnusedTextures(activeVariantSlugs: Set<string>): void {
    for (const [slug, cached] of this.cache) {
      if (!activeVariantSlugs.has(slug)) {
        cached.thumbnail?.destroy();
        cached.medium?.destroy();
        cached.full?.destroy();
        this.cache.delete(slug);
      }
    }
  }

  private getImageUrl(variantSlug: string, lod: LODLevel): string {
    // URL structure based on common CDN patterns
    // Adjust based on actual Sorcery TCG image hosting
    const size = lod === LOD_LEVELS.THUMBNAIL ? 'small' : lod === LOD_LEVELS.MEDIUM ? 'medium' : 'large';
    return `${IMAGE_BASE_URL}/${size}/${variantSlug}.webp`;
  }

  private async loadTexture(url: string): Promise<Texture> {
    try {
      const texture = await Assets.load<Texture>(url);
      return texture;
    } catch (error) {
      console.error(`Failed to load texture from ${url}:`, error);
      throw error;
    }
  }

  private cacheTexture(variantSlug: string, lod: LODLevel, texture: Texture): void {
    let cached = this.cache.get(variantSlug);
    if (!cached) {
      cached = {};
      this.cache.set(variantSlug, cached);
    }
    cached[lod] = texture;
  }
}

// Singleton instance
export const lodManager = new LODManager();
