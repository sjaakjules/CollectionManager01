/**
 * Level of Detail (LOD) management for card textures
 *
 * Manages multiple resolution textures for each card:
 * - Thumbnail: Used when zoomed out (fast loading, low memory)
 * - Medium: Used at normal zoom levels
 * - Full: Used when hovering or zoomed in (highest quality)
 *
 * By default, thumbnail/medium/full LOD assets are enabled.
 * Optional separate LOD assets can be disabled with:
 * - VITE_CARD_LOD_ASSETS=0
 * - VITE_CARD_THUMBNAIL_PATH=/assets/CardsThumb   (optional)
 * - VITE_CARD_MEDIUM_PATH=/assets/CardsMedium     (optional)
 * Optional thumbnail atlas loading:
 * - VITE_CARD_THUMBNAIL_ATLAS=1
 * - VITE_CARD_THUMBNAIL_ATLAS_MANIFEST=/assets/CardsThumbAtlas/manifest.json
 * Optional medium atlas loading:
 * - VITE_CARD_MEDIUM_ATLAS=1
 * - VITE_CARD_MEDIUM_ATLAS_MANIFEST=/assets/CardsMediumAtlas/manifest.json
 * Optional minimum LOD clamp:
 * - VITE_CARD_MIN_LOD=medium  (skips thumbnail requests)
 */

import { Assets, Rectangle, Texture, TextureSource } from 'pixi.js';
import { isConstrainedTextureDevice } from './deviceProfile';

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
  import.meta.env.VITE_CARD_LOD_ASSETS === undefined ||
  import.meta.env.VITE_CARD_LOD_ASSETS === '1' ||
  import.meta.env.VITE_CARD_LOD_ASSETS === 'true';
const THUMBNAIL_ATLAS_FLAG = import.meta.env.VITE_CARD_THUMBNAIL_ATLAS;
const USE_THUMBNAIL_ATLAS =
  THUMBNAIL_ATLAS_FLAG === undefined ||
  THUMBNAIL_ATLAS_FLAG === '1' ||
  THUMBNAIL_ATLAS_FLAG === 'true';
const THUMBNAIL_ATLAS_MANIFEST_URL =
  import.meta.env.VITE_CARD_THUMBNAIL_ATLAS_MANIFEST ??
  '/assets/CardsThumbAtlas/manifest.json';
const MEDIUM_ATLAS_FLAG = import.meta.env.VITE_CARD_MEDIUM_ATLAS;
const USE_MEDIUM_ATLAS =
  MEDIUM_ATLAS_FLAG === undefined ||
  MEDIUM_ATLAS_FLAG === '1' ||
  MEDIUM_ATLAS_FLAG === 'true';
const MEDIUM_ATLAS_MANIFEST_URL =
  import.meta.env.VITE_CARD_MEDIUM_ATLAS_MANIFEST ??
  '/assets/CardsMediumAtlas/manifest.json';
const FULL_IMAGE_PATH = '/assets/Cards';
const THUMBNAIL_IMAGE_PATH =
  import.meta.env.VITE_CARD_THUMBNAIL_PATH ?? '/assets/CardsThumb';
const MEDIUM_IMAGE_PATH =
  import.meta.env.VITE_CARD_MEDIUM_PATH ?? '/assets/CardsMedium';
const MIN_LOD_ENV = (import.meta.env.VITE_CARD_MIN_LOD ?? '')
  .toString()
  .toLowerCase();
const CONFIGURED_MIN_LOD_LEVEL: LODLevel | null =
  MIN_LOD_ENV === LOD_LEVELS.MEDIUM
    ? LOD_LEVELS.MEDIUM
    : MIN_LOD_ENV === LOD_LEVELS.THUMBNAIL
      ? LOD_LEVELS.THUMBNAIL
      : null;

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
  onProgress?: (loaded: number, total: number) => void;
}

interface AtlasManifest {
  version: number;
  atlasCount: number;
  atlases: AtlasPage[];
  cards: Record<string, AtlasCard>;
}

interface AtlasPage {
  id: string;
  image: string;
  width: number;
  height: number;
  count: number;
}

interface AtlasCard {
  atlasId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasRuntimeState {
  enabled: boolean;
  defaultEnabled: boolean;
  manifestUrl: string;
  manifest: AtlasManifest | null;
  manifestPromise: Promise<AtlasManifest | null> | null;
  pages: Map<string, AtlasPage>;
  pageTextures: Map<string, Texture>;
  pagePromises: Map<string, Promise<Texture>>;
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
  private thumbnailAtlas = this.createAtlasState(
    USE_THUMBNAIL_ATLAS,
    THUMBNAIL_ATLAS_MANIFEST_URL,
  );
  private mediumAtlas = this.createAtlasState(
    USE_MEDIUM_ATLAS,
    MEDIUM_ATLAS_MANIFEST_URL,
  );

  /**
   * Get the appropriate LOD level for a given zoom
   */
  getLODForZoom(zoom: number): LODLevel {
    let lod: LODLevel;
    if (zoom <= LOD_ZOOM_THRESHOLDS.THUMBNAIL_MAX) {
      lod = LOD_LEVELS.THUMBNAIL;
    } else if (zoom < LOD_ZOOM_THRESHOLDS.MEDIUM_MAX) {
      lod = LOD_LEVELS.MEDIUM;
    } else {
      lod = LOD_LEVELS.FULL;
    }

    const minLODLevel = this.getMinimumLOD();
    if (minLODLevel === LOD_LEVELS.MEDIUM && lod === LOD_LEVELS.THUMBNAIL) {
      return LOD_LEVELS.MEDIUM;
    }
    return lod;
  }

  /**
   * Startup/default LOD used for initial reveal and generic preloads.
   */
  getStartupLOD(): LODLevel {
    return this.getMinimumLOD();
  }

  /**
   * Resolve card->atlas assignments for the requested LOD (when atlas mode is enabled).
   * Map keys are normalized slugs.
   */
  async getAtlasAssignments(
    cardNamesOrSlugs: string[],
    lod: LODLevel,
  ): Promise<Map<string, string>> {
    const assignments = new Map<string, string>();
    const state = this.getAtlasStateForLOD(lod);
    if (!state || !state.enabled || !USE_SEPARATE_LOD_ASSETS) {
      return assignments;
    }

    const manifest = await this.loadAtlasManifest(state);
    if (!manifest) {
      return assignments;
    }

    for (const nameOrSlug of cardNamesOrSlugs) {
      const slug = cardNameToSlug(nameOrSlug);
      const card = manifest.cards[slug];
      if (card) {
        assignments.set(slug, card.atlasId);
      }
    }

    return assignments;
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

    const exactCached = this.getExactCachedTexture(slug, lod);
    if (exactCached) {
      return exactCached;
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
    return this.getBestAvailableTexture(slug, lod);
  }

  /**
   * Check whether the requested LOD exists in cache (no fallback).
   */
  hasExactTexture(cardNameOrSlug: string, lod: LODLevel): boolean {
    const slug = cardNameOrSlug.includes('_')
      ? cardNameOrSlug
      : cardNameToSlug(cardNameOrSlug);
    return this.getExactCachedTexture(slug, lod) !== null;
  }

  /**
   * Preload textures with controlled parallelism.
   */
  async preloadTextures(
    cardNames: string[],
    options: PreloadOptions = {},
  ): Promise<void> {
    const lod = options.lod ?? this.getStartupLOD();
    const concurrentLoads = options.concurrentLoads ?? CONCURRENT_LOADS;
    const batchSize = options.batchSize ?? PRELOAD_BATCH_SIZE;

    const uniqueNames = Array.from(new Set(cardNames));
    const toLoad = uniqueNames.filter((name) => {
      const slug = cardNameToSlug(name);
      const loadKey = this.getLoadKey(slug, lod);
      return (
        !this.getExactCachedTexture(slug, lod) &&
        !this.failedLoads.has(loadKey)
      );
    });

    const total = toLoad.length;
    options.onProgress?.(0, total);
    if (total === 0) return;
    let loaded = 0;
    const reportProgress = () => {
      loaded++;
      options.onProgress?.(loaded, total);
    };

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
            reportProgress();
          }
        })());
      }

      await Promise.all(workers);
    }
  }

  /**
   * Slowly preload full-resolution textures in the background.
   */
  async preloadFullTextures(
    cardNames: string[],
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    await this.preloadTextures(cardNames, {
      lod: LOD_LEVELS.FULL,
      concurrentLoads: BACKGROUND_CONCURRENT_LOADS,
      batchSize: BACKGROUND_BATCH_SIZE,
      onProgress,
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
    this.clearAtlasState(this.thumbnailAtlas, seen);
    this.clearAtlasState(this.mediumAtlas, seen);

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

  private getMinimumLOD(): LODLevel {
    if (CONFIGURED_MIN_LOD_LEVEL) {
      return CONFIGURED_MIN_LOD_LEVEL;
    }
    return isConstrainedTextureDevice()
      ? LOD_LEVELS.THUMBNAIL
      : LOD_LEVELS.MEDIUM;
  }

  private getAtlasStateForLOD(lod: LODLevel): AtlasRuntimeState | null {
    if (lod === LOD_LEVELS.THUMBNAIL) {
      return this.thumbnailAtlas;
    }
    if (lod === LOD_LEVELS.MEDIUM) {
      return this.mediumAtlas;
    }
    return null;
  }

  private getExactCachedTexture(slug: string, lod: LODLevel): Texture | null {
    const cached = this.cache.get(slug);
    return cached?.[lod] ?? null;
  }

  private getBestAvailableTexture(slug: string, lod: LODLevel): Texture | null {
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
    const thumbUrl = `${THUMBNAIL_IMAGE_PATH}/${slug}.webp`;
    const mediumUrl = `${MEDIUM_IMAGE_PATH}/${slug}.webp`;
    if (!USE_SEPARATE_LOD_ASSETS) {
      return [fullUrl];
    }

    let urls: string[];
    if (lod === LOD_LEVELS.THUMBNAIL) {
      urls = [thumbUrl, fullUrl];
    } else if (lod === LOD_LEVELS.MEDIUM) {
      // Fall back to thumbnail before full-res so missing medium assets do not
      // immediately trigger heavyweight downloads.
      urls = [mediumUrl, thumbUrl, fullUrl];
    } else {
      urls = [fullUrl];
    }

    return Array.from(new Set(urls));
  }

  private async loadTexture(slug: string, lod: LODLevel): Promise<Texture> {
    if (lod === LOD_LEVELS.THUMBNAIL) {
      const atlasTexture = await this.loadFromAtlas(this.thumbnailAtlas, slug);
      if (atlasTexture) {
        return atlasTexture;
      }
    } else if (lod === LOD_LEVELS.MEDIUM) {
      const atlasTexture = await this.loadFromAtlas(this.mediumAtlas, slug);
      if (atlasTexture) {
        return atlasTexture;
      }
    }

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

  private createAtlasState(
    enabled: boolean,
    manifestUrl: string,
  ): AtlasRuntimeState {
    return {
      enabled,
      defaultEnabled: enabled,
      manifestUrl,
      manifest: null,
      manifestPromise: null,
      pages: new Map(),
      pageTextures: new Map(),
      pagePromises: new Map(),
    };
  }

  private clearAtlasState(state: AtlasRuntimeState, seen: Set<Texture>): void {
    for (const texture of state.pageTextures.values()) {
      if (seen.has(texture)) continue;
      seen.add(texture);
      texture.destroy();
    }

    state.pageTextures.clear();
    state.pagePromises.clear();
    state.pages.clear();
    state.manifest = null;
    state.manifestPromise = null;
    state.enabled = state.defaultEnabled;
  }

  private async loadFromAtlas(
    state: AtlasRuntimeState,
    slug: string,
  ): Promise<Texture | null> {
    if (!state.enabled || !USE_SEPARATE_LOD_ASSETS) {
      return null;
    }

    const manifest = await this.loadAtlasManifest(state);
    if (!manifest) {
      return null;
    }

    const card = manifest.cards[slug];
    if (!card) {
      return null;
    }

    const pageTexture = await this.loadAtlasPageTexture(state, card.atlasId);
    if (!pageTexture) {
      return null;
    }

    return new Texture({
      source: pageTexture.source,
      frame: new Rectangle(card.x, card.y, card.w, card.h),
      orig: new Rectangle(0, 0, card.w, card.h),
    });
  }

  private async loadAtlasManifest(
    state: AtlasRuntimeState,
  ): Promise<AtlasManifest | null> {
    if (!state.enabled) {
      return null;
    }

    if (state.manifest) {
      return state.manifest;
    }

    if (state.manifestPromise) {
      return state.manifestPromise;
    }

    const promise = fetch(state.manifestUrl, {
      cache: 'force-cache',
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Atlas manifest request failed: ${response.status} ${response.statusText}`,
        );
      }

      const manifest = (await response.json()) as AtlasManifest;
      if (!manifest || typeof manifest !== 'object') {
        throw new Error('Atlas manifest is invalid');
      }
      if (!manifest.cards || !manifest.atlases || !Array.isArray(manifest.atlases)) {
        throw new Error('Atlas manifest missing required fields');
      }

      state.pages = new Map(manifest.atlases.map((atlas) => [atlas.id, atlas]));
      state.manifest = manifest;
      return manifest;
    }).catch((error) => {
      // Disable atlas mode for this session and fall back to per-card files.
      state.enabled = false;
      state.pages.clear();
      console.warn('Atlas disabled; falling back to per-card files.', error);
      return null;
    }).finally(() => {
      state.manifestPromise = null;
    });

    state.manifestPromise = promise;
    return promise;
  }

  private async loadAtlasPageTexture(
    state: AtlasRuntimeState,
    atlasId: string,
  ): Promise<Texture | null> {
    const cached = state.pageTextures.get(atlasId);
    if (cached) {
      return cached;
    }

    const inFlight = state.pagePromises.get(atlasId);
    if (inFlight) {
      try {
        return await inFlight;
      } catch {
        return null;
      }
    }

    const atlas = state.pages.get(atlasId);
    if (!atlas) {
      return null;
    }

    const promise = Assets.load<Texture>(atlas.image)
      .then((texture) => {
        state.pageTextures.set(atlasId, texture);
        return texture;
      })
      .finally(() => {
        state.pagePromises.delete(atlasId);
      });

    state.pagePromises.set(atlasId, promise);

    try {
      return await promise;
    } catch (error) {
      console.warn(`Failed to load atlas page: ${atlasId}`, error);
      return null;
    }
  }

  private cacheTexture(slug: string, lod: LODLevel, texture: Texture): void {
    const cached = this.cache.get(slug) ?? {};
    cached[lod] = texture;
    this.cache.set(slug, cached);
  }
}

// Singleton instance
export const lodManager = new LODManager();
