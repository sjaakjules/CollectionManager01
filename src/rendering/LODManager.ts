/**
 * Level of Detail (LOD) management for card textures
 *
 * Manages multiple resolution textures for each card:
 * - Thumbnail: Used when zoomed out (fast loading, low memory)
 * - Medium: Used at normal zoom levels
 * - Full: Used when hovering or zoomed in on unconstrained devices
 *
 * By default, thumbnail/medium/full LOD assets are enabled.
 * Optional separate LOD assets can be disabled with:
 * - VITE_CARD_LOD_ASSETS=0
 * - VITE_CARD_THUMBNAIL_PATH=/assets/CardsThumb   (optional)
 * - VITE_CARD_MEDIUM_PATH=/assets/CardsMedium     (optional standalone fallback)
 * Optional thumbnail atlas loading:
 * - VITE_CARD_THUMBNAIL_ATLAS=1
 * - VITE_CARD_THUMBNAIL_ATLAS_MANIFEST=/assets/CardsThumbAtlas/manifest.json
 * Optional medium atlas loading:
 * - VITE_CARD_MEDIUM_ATLAS=1
 * - VITE_CARD_MEDIUM_ATLAS_MANIFEST=/assets/CardsMediumAtlas/manifest.json
 * Optional minimum LOD clamp after startup:
 * - VITE_CARD_MIN_LOD=medium  (skips thumbnail requests after reveal)
 */

import { Assets, Rectangle, Texture, TextureSource } from 'pixi.js';
import {
  getMediumAtlasPageBudget,
  isConstrainedTextureDevice,
  isLowDetailTextureDevice,
} from './deviceProfile';

// Mipmaps improve desktop downscaling but add roughly a third more GPU memory.
TextureSource.defaultOptions.autoGenerateMipmaps = !isConstrainedTextureDevice();

// ============================================================================
// Constants
// ============================================================================

export const LOD_LEVELS = {
  THUMBNAIL: 'thumbnail',
  MEDIUM: 'medium',
  FULL: 'full',
} as const;

export type LODLevel = (typeof LOD_LEVELS)[keyof typeof LOD_LEVELS];

// Legacy zoom thresholds retained for callers that do not know card size.
export const LOD_ZOOM_THRESHOLDS = {
  THUMBNAIL_MAX: 0.1,
  MEDIUM_MAX: 0.4,
} as const;

// LOD switching is based on estimated on-screen card height in CSS pixels.
export const LOD_SCREEN_HEIGHT_THRESHOLDS = {
  THUMBNAIL_MAX: 96,
  FULL_MIN: 275,
} as const;

export const MOBILE_LOD_SCREEN_HEIGHT_THRESHOLDS = {
  THUMBNAIL_MAX: 110,
} as const;

const DEFAULT_CARD_WORLD_HEIGHT = 140;

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
const MEDIUM_IMAGE_PATH = import.meta.env.VITE_CARD_MEDIUM_PATH
  ?.toString()
  .trim();
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
const CONSTRAINED_CONCURRENT_LOADS = 2;
const CONSTRAINED_BATCH_SIZE = 8;
const CONSTRAINED_CACHE_MAX_TEXTURES = 90;
const CONSTRAINED_CACHE_TARGET_TEXTURES = 64;
const DESKTOP_FULL_CACHE_MAX_TEXTURES = 96;
const DESKTOP_FULL_CACHE_TARGET_TEXTURES = 72;
const CONSTRAINED_ATLAS_PAGE_LOADS = 1;
const THUMBNAIL_ATLAS_ADMIT_FRAME_GAP = 1;
const MEDIUM_ATLAS_ADMIT_FRAME_GAP = 2;

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
  shouldContinue?: () => boolean;
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

interface AtlasQueuedPageLoad {
  atlas: AtlasPage;
  resolve: (texture: Texture) => void;
  reject: (error: Error) => void;
}

export interface LODTextureInvalidation {
  lod: LODLevel;
  slugs: string[];
}

type LODTextureInvalidationListener = (
  invalidation: LODTextureInvalidation,
) => void;

class AtlasPageLoadCanceledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AtlasPageLoadCanceledError';
  }
}

interface AtlasRuntimeState {
  lod: LODLevel;
  enabled: boolean;
  defaultEnabled: boolean;
  manifestUrl: string;
  manifest: AtlasManifest | null;
  manifestPromise: Promise<AtlasManifest | null> | null;
  pages: Map<string, AtlasPage>;
  pageTextures: Map<string, Texture>;
  pagePromises: Map<string, Promise<Texture>>;
  pageAccessOrder: Map<string, number>;
  pageQueue: AtlasQueuedPageLoad[];
  queuedPageIds: Set<string>;
  activePageLoads: number;
  pageLoadGeneration: number;
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

function waitAnimationFrames(frameCount: number): Promise<void> {
  if (frameCount <= 0) return Promise.resolve();

  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }

      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => step(remaining - 1));
      } else {
        setTimeout(() => step(remaining - 1), 16);
      }
    };

    step(frameCount);
  });
}

function loadDecodedImageTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      Assets.load<Texture>(url).then(resolve, reject);
      return;
    }

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    let finished = false;

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      const decode = typeof image.decode === 'function'
        ? image.decode().catch(() => undefined)
        : Promise.resolve();

      decode.then(() => {
        cleanup();
        resolve(Texture.from(image, true));
      }, (error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    };

    image.onload = finish;
    image.onerror = () => {
      cleanup();
      reject(new Error(`Atlas image request failed: ${url}`));
    };
    image.src = url;

    if (image.complete && image.naturalWidth > 0) {
      finish();
    }
  });
}

// ============================================================================
// LOD Manager
// ============================================================================

export class LODManager {
  private cache: Map<string, TextureCache> = new Map();
  private loadingPromises: Map<string, Promise<Texture>> = new Map();
  private failedLoads: Set<string> = new Set();
  private textureAssetUrls: Map<string, string> = new Map();
  private cacheAccessOrder: Map<string, number> = new Map();
  private cacheAccessCounter = 0;
  private atlasAccessCounter = 0;
  private atlasAdmissionTail: Promise<void> = Promise.resolve();
  private invalidationListeners = new Set<LODTextureInvalidationListener>();
  private thumbnailAtlas = this.createAtlasState(
    LOD_LEVELS.THUMBNAIL,
    USE_THUMBNAIL_ATLAS,
    THUMBNAIL_ATLAS_MANIFEST_URL,
  );
  private mediumAtlas = this.createAtlasState(
    LOD_LEVELS.MEDIUM,
    USE_MEDIUM_ATLAS,
    MEDIUM_ATLAS_MANIFEST_URL,
  );

  /**
   * Get the appropriate LOD level for a given zoom
   */
  getLODForZoom(zoom: number): LODLevel {
    return this.getLODForCardDisplay(zoom, DEFAULT_CARD_WORLD_HEIGHT);
  }

  /**
   * Get the appropriate LOD level for a card at a given zoom.
   *
   * `cardWorldHeight` is the Pixi world-space display height for the card,
   * letting portrait, landscape, deck avatar, and zone cards switch based on
   * the actual on-screen footprint rather than a raw zoom number.
   */
  getLODForCardDisplay(zoom: number, cardWorldHeight: number): LODLevel {
    const screenHeight = Math.max(0, zoom * cardWorldHeight);
    let lod: LODLevel;

    if (isConstrainedTextureDevice()) {
      if (isLowDetailTextureDevice()) {
        return LOD_LEVELS.THUMBNAIL;
      }

      if (screenHeight <= MOBILE_LOD_SCREEN_HEIGHT_THRESHOLDS.THUMBNAIL_MAX) {
        lod = LOD_LEVELS.THUMBNAIL;
      } else {
        lod = LOD_LEVELS.MEDIUM;
      }

      const minLODLevel = this.getMinimumLOD();
      if (minLODLevel === LOD_LEVELS.MEDIUM && lod === LOD_LEVELS.THUMBNAIL) {
        return LOD_LEVELS.MEDIUM;
      }
      return lod;
    }

    if (screenHeight <= LOD_SCREEN_HEIGHT_THRESHOLDS.THUMBNAIL_MAX) {
      lod = LOD_LEVELS.THUMBNAIL;
    } else if (screenHeight >= LOD_SCREEN_HEIGHT_THRESHOLDS.FULL_MIN) {
      lod = LOD_LEVELS.FULL;
    } else {
      lod = LOD_LEVELS.MEDIUM;
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
    return LOD_LEVELS.THUMBNAIL;
  }

  /**
   * Resolve the actual tier this device is allowed to load for a requested LOD.
   */
  resolveLOD(lod: LODLevel): LODLevel {
    return this.getEffectiveLOD(lod);
  }

  /**
   * Highest detail tier this device is allowed to use for hover/tap priority.
   */
  getInteractiveDetailLOD(): LODLevel {
    return this.getEffectiveLOD(LOD_LEVELS.FULL);
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

  shouldDeferAsyncTextureLoad(lod: LODLevel): boolean {
    return (
      isConstrainedTextureDevice() &&
      !isLowDetailTextureDevice() &&
      this.getEffectiveLOD(lod) === LOD_LEVELS.MEDIUM
    );
  }

  cancelQueuedAtlasLoads(
    lod: LODLevel,
    keepNamesOrSlugs: string[] = [],
  ): void {
    const state = this.getAtlasStateForLOD(this.getEffectiveLOD(lod));
    if (!state) return;

    const keepAtlasIds =
      keepNamesOrSlugs.length > 0
        ? this.getAtlasIdsForCards(state, keepNamesOrSlugs)
        : new Set<string>();

    this.cancelQueuedAtlasPageLoads(state, keepAtlasIds);
  }

  onTextureInvalidated(
    listener: LODTextureInvalidationListener,
  ): () => void {
    this.invalidationListeners.add(listener);
    return () => {
      this.invalidationListeners.delete(listener);
    };
  }

  /**
   * Get texture for a card at specified LOD level
   * Returns cached texture or loads it if not available
   */
  async getTexture(cardNameOrSlug: string, lod: LODLevel): Promise<Texture> {
    const effectiveLOD = this.getEffectiveLOD(lod);
    const slug = cardNameOrSlug.includes('_')
      ? cardNameOrSlug
      : cardNameToSlug(cardNameOrSlug);
    const loadKey = this.getLoadKey(slug, effectiveLOD);

    if (this.failedLoads.has(loadKey)) {
      return Texture.WHITE;
    }

    const exactCached = this.getExactCachedTexture(slug, effectiveLOD);
    if (exactCached) {
      this.touchCachedTexture(slug, effectiveLOD);
      return exactCached;
    }

    const loadingPromise = this.loadingPromises.get(loadKey);
    if (loadingPromise) {
      return loadingPromise;
    }

    const promise = this.loadTexture(slug, effectiveLOD)
      .then((texture) => {
        this.cacheTexture(slug, effectiveLOD, texture);
        return texture;
      })
      .catch((error: unknown) => {
        if (!this.isAtlasPageLoadCanceledError(error)) {
          this.failedLoads.add(loadKey);
        }
        return Texture.WHITE;
      })
      .finally(() => {
        this.loadingPromises.delete(loadKey);
      });
    this.loadingPromises.set(loadKey, promise);
    return promise;
  }

  /**
   * Get texture synchronously if cached, otherwise return null
   */
  getTextureSync(cardNameOrSlug: string, lod: LODLevel): Texture | null {
    return this.getTextureMatchSync(cardNameOrSlug, lod)?.texture ?? null;
  }

  /**
   * Get the exact cached texture for a LOD with no fallback tier.
   */
  getExactTextureSync(cardNameOrSlug: string, lod: LODLevel): Texture | null {
    const effectiveLOD = this.getEffectiveLOD(lod);
    const slug = cardNameOrSlug.includes('_')
      ? cardNameOrSlug
      : cardNameToSlug(cardNameOrSlug);
    const texture = this.getExactCachedTexture(slug, effectiveLOD);
    if (texture) {
      this.touchCachedTexture(slug, effectiveLOD);
    }
    return texture;
  }

  /**
   * Get the best cached texture and the LOD it actually represents.
   */
  getTextureMatchSync(
    cardNameOrSlug: string,
    lod: LODLevel,
  ): { lod: LODLevel; texture: Texture } | null {
    const effectiveLOD = this.getEffectiveLOD(lod);
    const slug = cardNameOrSlug.includes('_')
      ? cardNameOrSlug
      : cardNameToSlug(cardNameOrSlug);
    const match = this.getBestAvailableTextureWithLOD(slug, effectiveLOD);
    if (match) {
      this.touchCachedTexture(slug, match.lod);
      return match;
    }
    return null;
  }

  /**
   * Check whether the requested LOD exists in cache (no fallback).
   */
  hasExactTexture(cardNameOrSlug: string, lod: LODLevel): boolean {
    const effectiveLOD = this.getEffectiveLOD(lod);
    const slug = cardNameOrSlug.includes('_')
      ? cardNameOrSlug
      : cardNameToSlug(cardNameOrSlug);
    return this.getExactCachedTexture(slug, effectiveLOD) !== null;
  }

  /**
   * Preload textures with controlled parallelism.
   */
  async preloadTextures(
    cardNames: string[],
    options: PreloadOptions = {},
  ): Promise<void> {
    const constrained = isConstrainedTextureDevice();
    const lod = this.getEffectiveLOD(options.lod ?? this.getStartupLOD());
    const requestedConcurrentLoads = options.concurrentLoads ?? CONCURRENT_LOADS;
    const requestedBatchSize = options.batchSize ?? PRELOAD_BATCH_SIZE;
    const concurrentLoads = constrained
      ? Math.min(requestedConcurrentLoads, CONSTRAINED_CONCURRENT_LOADS)
      : requestedConcurrentLoads;
    const batchSize = constrained
      ? Math.min(requestedBatchSize, CONSTRAINED_BATCH_SIZE)
      : requestedBatchSize;

    const uniqueNames = Array.from(new Set(cardNames));
    if (constrained && lod === LOD_LEVELS.MEDIUM) {
      this.cancelQueuedAtlasLoads(lod, uniqueNames);
    }

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
            if (options.shouldContinue?.() === false) break;
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
    if (isConstrainedTextureDevice()) {
      onProgress?.(0, 0);
      return;
    }

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
    this.cancelQueuedAtlasPageLoads(this.thumbnailAtlas, new Set());
    this.cancelQueuedAtlasPageLoads(this.mediumAtlas, new Set());

    const seen = new Set<Texture>();
    this.notifyCachedTextureInvalidations();
    this.clearAtlasState(this.thumbnailAtlas, seen);
    this.clearAtlasState(this.mediumAtlas, seen);

    for (const [slug, cached] of this.cache) {
      for (const [lod, texture] of Object.entries(cached) as Array<
        [LODLevel, Texture | undefined]
      >) {
        if (!texture || seen.has(texture)) continue;
        seen.add(texture);
        this.destroyTexture(
          texture,
          this.textureAssetUrls.has(this.getLoadKey(slug, lod)),
        );
      }
    }

    for (const url of this.textureAssetUrls.values()) {
      if (Assets.cache.has(url)) {
        Assets.cache.remove(url);
      }
    }

    this.cache.clear();
    this.failedLoads.clear();
    this.loadingPromises.clear();
    this.textureAssetUrls.clear();
    this.cacheAccessOrder.clear();
    this.atlasAdmissionTail = Promise.resolve();
  }

  /**
   * Get number of cached cards
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  pruneCache(keepNamesOrSlugs: string[]): void {
    if (!isConstrainedTextureDevice()) return;

    this.pruneStandaloneTextureCache(
      keepNamesOrSlugs,
      CONSTRAINED_CACHE_MAX_TEXTURES,
      CONSTRAINED_CACHE_TARGET_TEXTURES,
    );
    const mediumBudget = getMediumAtlasPageBudget();
    this.pruneAtlasPageCache(
      this.mediumAtlas,
      keepNamesOrSlugs,
      mediumBudget.maxPages,
      mediumBudget.targetPages,
    );
  }

  pruneFullTextureCache(keepNamesOrSlugs: string[]): void {
    if (isConstrainedTextureDevice()) {
      this.pruneLODTextureCache(LOD_LEVELS.FULL, [], 0, 0);
      return;
    }

    this.pruneLODTextureCache(
      LOD_LEVELS.FULL,
      keepNamesOrSlugs,
      DESKTOP_FULL_CACHE_MAX_TEXTURES,
      DESKTOP_FULL_CACHE_TARGET_TEXTURES,
    );
  }

  private getLoadKey(slug: string, lod: LODLevel): string {
    return `${slug}:${lod}`;
  }

  private parseLoadKey(loadKey: string): { slug: string; lod: LODLevel } {
    const separator = loadKey.lastIndexOf(':');
    const slug = separator >= 0 ? loadKey.slice(0, separator) : loadKey;
    const lod = (separator >= 0 ? loadKey.slice(separator + 1) : LOD_LEVELS.THUMBNAIL) as LODLevel;
    return { slug, lod };
  }

  private getEffectiveLOD(lod: LODLevel): LODLevel {
    if (!isConstrainedTextureDevice()) {
      return lod;
    }
    if (isLowDetailTextureDevice()) {
      return LOD_LEVELS.THUMBNAIL;
    }
    if (lod === LOD_LEVELS.FULL) {
      return LOD_LEVELS.MEDIUM;
    }
    return lod;
  }

  private getMinimumLOD(): LODLevel {
    if (CONFIGURED_MIN_LOD_LEVEL) {
      return CONFIGURED_MIN_LOD_LEVEL;
    }
    return LOD_LEVELS.THUMBNAIL;
  }

  private getAtlasStateForLOD(lod: LODLevel): AtlasRuntimeState | null {
    if (isConstrainedTextureDevice() && isLowDetailTextureDevice()) {
      return lod === LOD_LEVELS.THUMBNAIL ? this.thumbnailAtlas : null;
    }

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
    const texture = cached?.[lod] ?? null;
    if (texture) return texture;

    const atlasTexture = this.getCachedAtlasFrameTexture(slug, lod);
    if (!atlasTexture) return null;

    this.cacheTexture(slug, lod, atlasTexture);
    return atlasTexture;
  }

  private getBestAvailableTextureWithLOD(
    slug: string,
    lod: LODLevel,
  ): { lod: LODLevel; texture: Texture } | null {
    const orderedLODs = this.getFallbackLODs(lod);

    for (const candidateLOD of orderedLODs) {
      const texture = this.getExactCachedTexture(slug, candidateLOD);
      if (texture) {
        return { lod: candidateLOD, texture };
      }
    }

    return null;
  }

  private getFallbackLODs(lod: LODLevel): LODLevel[] {
    if (isConstrainedTextureDevice()) {
      if (isLowDetailTextureDevice()) {
        return [LOD_LEVELS.THUMBNAIL];
      }

      return lod === LOD_LEVELS.THUMBNAIL
        ? [LOD_LEVELS.THUMBNAIL, LOD_LEVELS.MEDIUM]
        : [LOD_LEVELS.MEDIUM, LOD_LEVELS.THUMBNAIL];
    }

    if (lod === LOD_LEVELS.THUMBNAIL) {
      return [LOD_LEVELS.THUMBNAIL, LOD_LEVELS.MEDIUM, LOD_LEVELS.FULL];
    }
    if (lod === LOD_LEVELS.MEDIUM) {
      return [LOD_LEVELS.MEDIUM, LOD_LEVELS.FULL, LOD_LEVELS.THUMBNAIL];
    }
    return [LOD_LEVELS.FULL, LOD_LEVELS.MEDIUM, LOD_LEVELS.THUMBNAIL];
  }

  private getImageUrls(slug: string, lod: LODLevel): string[] {
    const fullUrl = `${FULL_IMAGE_PATH}/${slug}.webp`;
    const thumbUrl = `${THUMBNAIL_IMAGE_PATH}/${slug}.webp`;
    const constrained = isConstrainedTextureDevice();
    const mediumUrl = MEDIUM_IMAGE_PATH
      ? `${MEDIUM_IMAGE_PATH}/${slug}.webp`
      : null;

    if (constrained && isLowDetailTextureDevice()) {
      return [thumbUrl];
    }

    if (!USE_SEPARATE_LOD_ASSETS) {
      return constrained ? [thumbUrl] : [fullUrl];
    }

    if (constrained) {
      if (lod === LOD_LEVELS.MEDIUM) {
        return mediumUrl ? [mediumUrl, thumbUrl] : [thumbUrl];
      }
      if (lod === LOD_LEVELS.FULL) {
        return mediumUrl ? [mediumUrl, thumbUrl] : [thumbUrl];
      }
      return [thumbUrl];
    }

    let urls: string[];
    if (lod === LOD_LEVELS.THUMBNAIL) {
      urls = [thumbUrl, fullUrl];
    } else if (lod === LOD_LEVELS.MEDIUM) {
      // Fall back to thumbnail before full-res so missing medium assets do not
      // immediately trigger heavyweight downloads. The standalone medium path
      // is opt-in because this repo ships only the medium atlas by default.
      urls = mediumUrl ? [mediumUrl, thumbUrl, fullUrl] : [thumbUrl, fullUrl];
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
        const texture = await Assets.load<Texture>(url);
        this.textureAssetUrls.set(this.getLoadKey(slug, lod), url);
        return texture;
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
    lod: LODLevel,
    enabled: boolean,
    manifestUrl: string,
  ): AtlasRuntimeState {
    return {
      lod,
      enabled,
      defaultEnabled: enabled,
      manifestUrl,
      manifest: null,
      manifestPromise: null,
      pages: new Map(),
      pageTextures: new Map(),
      pagePromises: new Map(),
      pageAccessOrder: new Map(),
      pageQueue: [],
      queuedPageIds: new Set(),
      activePageLoads: 0,
      pageLoadGeneration: 0,
    };
  }

  private clearAtlasState(state: AtlasRuntimeState, seen: Set<Texture>): void {
    for (const [atlasId, texture] of state.pageTextures) {
      if (seen.has(texture)) continue;
      this.notifyAtlasPageInvalidated(state, atlasId);
      this.evictCardTexturesForAtlasPage(state, atlasId);
      seen.add(texture);
      this.destroyTexture(texture, true);
    }

    state.pageTextures.clear();
    state.pagePromises.clear();
    state.pageAccessOrder.clear();
    state.pageQueue = [];
    state.queuedPageIds.clear();
    state.activePageLoads = 0;
    state.pageLoadGeneration++;
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

    return this.createAtlasFrameTexture(pageTexture, card);
  }

  private getCachedAtlasFrameTexture(
    slug: string,
    lod: LODLevel,
  ): Texture | null {
    const state = this.getAtlasStateForLOD(lod);
    if (!state?.enabled || !USE_SEPARATE_LOD_ASSETS || !state.manifest) {
      return null;
    }

    const card = state.manifest.cards[slug];
    if (!card) return null;

    const pageTexture = state.pageTextures.get(card.atlasId);
    if (!pageTexture) return null;

    this.touchAtlasPage(state, card.atlasId);
    return this.createAtlasFrameTexture(pageTexture, card);
  }

  private createAtlasFrameTexture(
    pageTexture: Texture,
    card: AtlasCard,
  ): Texture {
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
      this.touchAtlasPage(state, atlasId);
      return cached;
    }

    const inFlight = state.pagePromises.get(atlasId);
    if (inFlight) {
      try {
        return await inFlight;
      } catch (error) {
        if (this.isAtlasPageLoadCanceledError(error)) {
          throw error;
        }
        return null;
      }
    }

    const atlas = state.pages.get(atlasId);
    if (!atlas) {
      return null;
    }

    const queued = this.shouldQueueAtlasPageLoads();
    const promise = queued
      ? this.enqueueAtlasPageLoad(state, atlas)
      : this.loadAtlasPageTextureNow(
        state,
        atlas,
        state.pageLoadGeneration,
      ).finally(() => {
        state.pagePromises.delete(atlasId);
      });
    state.pagePromises.set(atlasId, promise);

    try {
      return await promise;
    } catch (error) {
      if (this.isAtlasPageLoadCanceledError(error)) {
        throw error;
      }
      console.warn(`Failed to load atlas page: ${atlasId}`, error);
      return null;
    }
  }

  private shouldQueueAtlasPageLoads(): boolean {
    return isConstrainedTextureDevice();
  }

  private enqueueAtlasPageLoad(
    state: AtlasRuntimeState,
    atlas: AtlasPage,
  ): Promise<Texture> {
    return new Promise((resolve, reject) => {
      state.pageQueue.push({ atlas, resolve, reject });
      state.queuedPageIds.add(atlas.id);
      this.processAtlasPageQueue(state);
    });
  }

  private processAtlasPageQueue(state: AtlasRuntimeState): void {
    if (state.activePageLoads >= CONSTRAINED_ATLAS_PAGE_LOADS) return;

    const next = state.pageQueue.shift();
    if (!next) return;

    state.queuedPageIds.delete(next.atlas.id);
    state.activePageLoads++;
    const generation = state.pageLoadGeneration;

    void this.loadAtlasPageTextureNow(state, next.atlas, generation)
      .then(next.resolve, next.reject)
      .finally(() => {
        state.activePageLoads = Math.max(0, state.activePageLoads - 1);
        state.pagePromises.delete(next.atlas.id);
        this.processAtlasPageQueue(state);
      });
  }

  private async loadAtlasPageTextureNow(
    state: AtlasRuntimeState,
    atlas: AtlasPage,
    generation = state.pageLoadGeneration,
  ): Promise<Texture> {
    const cached = state.pageTextures.get(atlas.id);
    if (cached) {
      this.touchAtlasPage(state, atlas.id);
      return cached;
    }

    const texture = this.shouldQueueAtlasPageLoads()
      ? await loadDecodedImageTexture(atlas.image)
      : await Assets.load<Texture>(atlas.image);

    await this.waitForAtlasPageAdmission(state);
    if (generation !== state.pageLoadGeneration) {
      this.destroyTexture(texture, true);
      throw new AtlasPageLoadCanceledError(
        `Atlas page load superseded: ${atlas.id}`,
      );
    }

    state.pageTextures.set(atlas.id, texture);
    this.touchAtlasPage(state, atlas.id);
    return texture;
  }

  private waitForAtlasPageAdmission(state: AtlasRuntimeState): Promise<void> {
    if (!this.shouldQueueAtlasPageLoads()) return Promise.resolve();

    const frameGap = state.lod === LOD_LEVELS.MEDIUM
      ? MEDIUM_ATLAS_ADMIT_FRAME_GAP
      : THUMBNAIL_ATLAS_ADMIT_FRAME_GAP;
    const wait = this.atlasAdmissionTail.then(() => waitAnimationFrames(frameGap));
    this.atlasAdmissionTail = wait.catch(() => undefined);
    return wait;
  }

  private cancelQueuedAtlasPageLoads(
    state: AtlasRuntimeState,
    keepAtlasIds: Set<string>,
  ): void {
    if (state.pageQueue.length === 0) return;

    const kept: AtlasQueuedPageLoad[] = [];
    for (const item of state.pageQueue) {
      if (keepAtlasIds.has(item.atlas.id)) {
        kept.push(item);
        continue;
      }

      state.queuedPageIds.delete(item.atlas.id);
      state.pagePromises.delete(item.atlas.id);
      item.reject(
        new AtlasPageLoadCanceledError(
          `Atlas page load canceled: ${item.atlas.id}`,
        ),
      );
    }

    state.pageQueue = kept;
  }

  private cacheTexture(slug: string, lod: LODLevel, texture: Texture): void {
    const cached = this.cache.get(slug) ?? {};
    cached[lod] = texture;
    this.cache.set(slug, cached);
    this.touchCachedTexture(slug, lod);
  }

  private touchCachedTexture(slug: string, lod: LODLevel): void {
    this.cacheAccessOrder.set(this.getLoadKey(slug, lod), ++this.cacheAccessCounter);
  }

  private touchAtlasPage(state: AtlasRuntimeState, atlasId: string): void {
    state.pageAccessOrder.set(atlasId, ++this.atlasAccessCounter);
  }

  private pruneStandaloneTextureCache(
    keepNamesOrSlugs: string[],
    maxTextures: number,
    targetTextures: number,
  ): void {
    if (this.textureAssetUrls.size <= maxTextures) return;

    const keepSlugs = new Set(keepNamesOrSlugs.map((name) => cardNameToSlug(name)));
    const candidates = [...this.textureAssetUrls.keys()]
      .filter((loadKey) => {
        const { slug } = this.parseLoadKey(loadKey);
        return !keepSlugs.has(slug);
      })
      .sort(
        (a, b) =>
          (this.cacheAccessOrder.get(a) ?? 0) -
          (this.cacheAccessOrder.get(b) ?? 0),
      );

    for (const loadKey of candidates) {
      if (this.textureAssetUrls.size <= targetTextures) return;
      this.evictCachedTexture(loadKey);
    }
  }

  private pruneAtlasPageCache(
    state: AtlasRuntimeState,
    keepNamesOrSlugs: string[],
    maxPages: number,
    targetPages: number,
  ): void {
    if (!state.manifest || state.pageTextures.size <= maxPages) return;

    const keepAtlasIds = targetPages > 0
      ? this.getAtlasIdsForCards(state, keepNamesOrSlugs)
      : new Set<string>();
    const candidates = [...state.pageTextures.keys()]
      .filter(
        (atlasId) =>
          !keepAtlasIds.has(atlasId) && !state.pagePromises.has(atlasId),
      )
      .sort(
        (a, b) =>
          (state.pageAccessOrder.get(a) ?? 0) -
          (state.pageAccessOrder.get(b) ?? 0),
      );

    let remaining = state.pageTextures.size;
    for (const atlasId of candidates) {
      if (remaining <= targetPages) return;
      this.evictAtlasPageTexture(state, atlasId);
      remaining--;
    }
  }

  private getAtlasIdsForCards(
    state: AtlasRuntimeState,
    keepNamesOrSlugs: string[],
  ): Set<string> {
    const atlasIds = new Set<string>();
    if (!state.manifest) return atlasIds;

    for (const nameOrSlug of keepNamesOrSlugs) {
      const slug = cardNameToSlug(nameOrSlug);
      const card = state.manifest.cards[slug];
      if (card) {
        atlasIds.add(card.atlasId);
      }
    }

    return atlasIds;
  }

  private pruneLODTextureCache(
    lod: LODLevel,
    keepNamesOrSlugs: string[],
    maxTextures: number,
    targetTextures: number,
  ): void {
    const loadKeys = [...this.textureAssetUrls.keys()].filter((loadKey) => {
      return this.parseLoadKey(loadKey).lod === lod;
    });

    if (loadKeys.length <= maxTextures) return;

    const keepSlugs = new Set(keepNamesOrSlugs.map((name) => cardNameToSlug(name)));
    const candidates = loadKeys
      .filter((loadKey) => {
        const { slug } = this.parseLoadKey(loadKey);
        return !keepSlugs.has(slug);
      })
      .sort(
        (a, b) =>
          (this.cacheAccessOrder.get(a) ?? 0) -
          (this.cacheAccessOrder.get(b) ?? 0),
      );

    let remaining = loadKeys.length;
    for (const loadKey of candidates) {
      if (remaining <= targetTextures) return;
      this.evictCachedTexture(loadKey);
      remaining--;
    }
  }

  private evictCachedTexture(loadKey: string): void {
    const { slug, lod } = this.parseLoadKey(loadKey);
    const cached = this.cache.get(slug);
    const url = this.textureAssetUrls.get(loadKey);

    if (cached) {
      if (lod === LOD_LEVELS.THUMBNAIL) {
        cached.thumbnail = undefined;
      } else if (lod === LOD_LEVELS.MEDIUM) {
        cached.medium = undefined;
      } else {
        cached.full = undefined;
      }
      if (!cached.thumbnail && !cached.medium && !cached.full) {
        this.cache.delete(slug);
      }
    }

    this.textureAssetUrls.delete(loadKey);
    this.cacheAccessOrder.delete(loadKey);

    if (url && Assets.cache.has(url)) {
      Assets.cache.remove(url);
    }
  }

  private evictAtlasPageTexture(
    state: AtlasRuntimeState,
    atlasId: string,
  ): void {
    const texture = state.pageTextures.get(atlasId);
    const atlas = state.pages.get(atlasId);
    if (!texture) return;

    this.notifyAtlasPageInvalidated(state, atlasId);
    this.evictCardTexturesForAtlasPage(state, atlasId);
    state.pageTextures.delete(atlasId);
    state.pageAccessOrder.delete(atlasId);

    if (atlas && Assets.cache.has(atlas.image)) {
      Assets.cache.remove(atlas.image);
    }
    this.destroyTexture(texture, true);
  }

  private evictCardTexturesForAtlasPage(
    state: AtlasRuntimeState,
    atlasId: string,
  ): void {
    const manifest = state.manifest;
    if (!manifest) return;

    for (const [slug, card] of Object.entries(manifest.cards)) {
      if (card.atlasId !== atlasId) continue;

      const cached = this.cache.get(slug);
      const texture = cached?.[state.lod];
      if (!cached || !texture) continue;

      cached[state.lod] = undefined;
      this.cacheAccessOrder.delete(this.getLoadKey(slug, state.lod));
      this.destroyTexture(texture, false);

      if (!cached.thumbnail && !cached.medium && !cached.full) {
        this.cache.delete(slug);
      }
    }
  }

  private notifyCachedTextureInvalidations(): void {
    const slugsByLOD: Record<LODLevel, Set<string>> = {
      [LOD_LEVELS.THUMBNAIL]: new Set(),
      [LOD_LEVELS.MEDIUM]: new Set(),
      [LOD_LEVELS.FULL]: new Set(),
    };

    for (const [slug, cached] of this.cache) {
      for (const lod of Object.values(LOD_LEVELS)) {
        if (cached[lod]) {
          slugsByLOD[lod].add(slug);
        }
      }
    }

    for (const lod of Object.values(LOD_LEVELS)) {
      this.notifyTextureInvalidated(lod, [...slugsByLOD[lod]]);
    }
  }

  private notifyAtlasPageInvalidated(
    state: AtlasRuntimeState,
    atlasId: string,
  ): void {
    this.notifyTextureInvalidated(
      state.lod,
      this.getSlugsForAtlasPage(state, atlasId),
    );
  }

  private notifyTextureInvalidated(lod: LODLevel, slugs: string[]): void {
    if (slugs.length === 0 || this.invalidationListeners.size === 0) return;

    const invalidation: LODTextureInvalidation = {
      lod,
      slugs: Array.from(new Set(slugs)),
    };
    for (const listener of this.invalidationListeners) {
      listener(invalidation);
    }
  }

  private getSlugsForAtlasPage(
    state: AtlasRuntimeState,
    atlasId: string,
  ): string[] {
    const manifest = state.manifest;
    if (!manifest) return [];

    return Object.entries(manifest.cards)
      .filter(([, card]) => card.atlasId === atlasId)
      .map(([slug]) => slug);
  }

  private destroyTexture(texture: Texture, destroySource: boolean): void {
    if (texture === Texture.EMPTY || texture === Texture.WHITE) return;
    texture.destroy(destroySource);
  }

  private isAtlasPageLoadCanceledError(
    error: unknown,
  ): error is AtlasPageLoadCanceledError {
    return error instanceof AtlasPageLoadCanceledError;
  }
}

// Singleton instance
export const lodManager = new LODManager();
