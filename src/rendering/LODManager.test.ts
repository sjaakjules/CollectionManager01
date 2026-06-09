import { afterEach, describe, expect, it, vi } from "vitest";
import { Assets, Texture } from "pixi.js";
import { LOD_LEVELS, LODManager } from "./LODManager";

interface TestDevice {
  width: number;
  height: number;
  userAgent: string;
  maxTouchPoints: number;
  media?: Record<string, boolean>;
  connection?: { saveData?: boolean };
  deviceMemory?: number;
}

function createMatchMedia(matchesByQuery: Record<string, boolean>): typeof window.matchMedia {
  return vi.fn((query: string): MediaQueryList => ({
    matches: matchesByQuery[query] ?? false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
}

function useDevice(device: TestDevice): void {
  vi.stubGlobal("window", {
    innerWidth: device.width,
    innerHeight: device.height,
    devicePixelRatio: 2,
    screen: {
      width: device.width,
      height: device.height,
    },
    matchMedia: createMatchMedia(device.media ?? {}),
  });
  vi.stubGlobal("navigator", {
    userAgent: device.userAgent,
    maxTouchPoints: device.maxTouchPoints,
    connection: device.connection,
    deviceMemory: device.deviceMemory,
  });
}

function createDisposableTexture(): Texture {
  return {
    destroy: vi.fn(),
  } as unknown as Texture;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LODManager", () => {
  it("uses on-screen card height for richer desktop LODs", () => {
    useDevice({
      width: 1440,
      height: 900,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      maxTouchPoints: 0,
    });

    const manager = new LODManager();

    expect(manager.getLODForZoom(0.05)).toBe(LOD_LEVELS.THUMBNAIL);
    expect(manager.getLODForZoom(1)).toBe(LOD_LEVELS.MEDIUM);
    expect(manager.getLODForCardDisplay(1, 274)).toBe(LOD_LEVELS.MEDIUM);
    expect(manager.getLODForCardDisplay(1, 275)).toBe(LOD_LEVELS.FULL);
    expect(manager.getLODForZoom(2)).toBe(LOD_LEVELS.FULL);
    expect(manager.getStartupLOD()).toBe(LOD_LEVELS.THUMBNAIL);
  });

  it("uses thumbnail and medium only for modern phone-sized touch devices", () => {
    useDevice({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      maxTouchPoints: 5,
      media: {
        "(pointer: coarse)": true,
        "(hover: none)": true,
      },
    });

    const manager = new LODManager();

    expect(manager.getLODForZoom(0.78)).toBe(LOD_LEVELS.THUMBNAIL);
    expect(manager.getLODForZoom(0.8)).toBe(LOD_LEVELS.MEDIUM);
    expect(manager.getLODForZoom(1)).toBe(LOD_LEVELS.MEDIUM);
    expect(manager.getLODForZoom(1.05)).toBe(LOD_LEVELS.MEDIUM);
    expect(manager.getLODForZoom(1.3)).toBe(LOD_LEVELS.MEDIUM);
    expect(manager.getLODForZoom(2.5)).toBe(LOD_LEVELS.MEDIUM);
    expect(manager.resolveLOD(LOD_LEVELS.FULL)).toBe(LOD_LEVELS.MEDIUM);
    expect(manager.shouldDeferAsyncTextureLoad(LOD_LEVELS.MEDIUM)).toBe(true);
  });

  it("does not fall back upward to cached full textures on modern phones", () => {
    useDevice({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      maxTouchPoints: 5,
      media: {
        "(pointer: coarse)": true,
        "(hover: none)": true,
      },
    });

    const manager = new LODManager();
    const managerState = manager as unknown as {
      cache: Map<string, { thumbnail?: Texture; medium?: Texture; full?: Texture }>;
    };

    managerState.cache.set("shield_maidens", {
      thumbnail: Texture.EMPTY,
      medium: Texture.WHITE,
      full: createDisposableTexture(),
    });

    expect(manager.getTextureMatchSync("shield_maidens", LOD_LEVELS.FULL)).toEqual({
      lod: LOD_LEVELS.MEDIUM,
      texture: Texture.WHITE,
    });
  });

  it("keeps automatic zoom LOD at thumbnails on low-detail touch devices", () => {
    useDevice({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      maxTouchPoints: 5,
      connection: { saveData: true },
      media: {
        "(pointer: coarse)": true,
        "(hover: none)": true,
      },
    });

    const manager = new LODManager();

    expect(manager.getLODForZoom(0.8)).toBe(LOD_LEVELS.THUMBNAIL);
    expect(manager.getLODForZoom(1.3)).toBe(LOD_LEVELS.THUMBNAIL);
    expect(manager.getLODForZoom(2.5)).toBe(LOD_LEVELS.THUMBNAIL);
  });

  it("prunes full texture cache by LRU while preserving requested cards", () => {
    useDevice({
      width: 1440,
      height: 900,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      maxTouchPoints: 0,
    });

    const manager = new LODManager();
    const unloadSpy = vi.spyOn(Assets, "unload");
    const managerState = manager as unknown as {
      cache: Map<string, { full?: Texture }>;
      textureAssetUrls: Map<string, string>;
      cacheAccessOrder: Map<string, number>;
    };

    for (let i = 0; i < 100; i++) {
      const slug = `card_${i}`;
      const loadKey = `${slug}:${LOD_LEVELS.FULL}`;
      managerState.cache.set(slug, { full: Texture.WHITE });
      managerState.textureAssetUrls.set(loadKey, `/assets/Cards/${slug}.webp`);
      managerState.cacheAccessOrder.set(loadKey, i);
    }

    manager.pruneFullTextureCache(["card_0", "card_1"]);

    expect(managerState.textureAssetUrls.size).toBe(72);
    expect(managerState.textureAssetUrls.has(`card_0:${LOD_LEVELS.FULL}`)).toBe(
      true,
    );
    expect(managerState.textureAssetUrls.has(`card_1:${LOD_LEVELS.FULL}`)).toBe(
      true,
    );
    expect(unloadSpy).not.toHaveBeenCalled();
  });

  it("removes full texture cache entries entirely on modern phones", () => {
    useDevice({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      maxTouchPoints: 5,
      media: {
        "(pointer: coarse)": true,
        "(hover: none)": true,
      },
    });

    const manager = new LODManager();
    const managerState = manager as unknown as {
      cache: Map<string, { full?: Texture }>;
      textureAssetUrls: Map<string, string>;
      cacheAccessOrder: Map<string, number>;
    };

    for (let i = 0; i < 2; i++) {
      const slug = `card_${i}`;
      const loadKey = `${slug}:${LOD_LEVELS.FULL}`;
      managerState.cache.set(slug, { full: Texture.WHITE });
      managerState.textureAssetUrls.set(loadKey, `/assets/Cards/${slug}.webp`);
      managerState.cacheAccessOrder.set(loadKey, i);
    }

    manager.pruneFullTextureCache(["card_0"]);

    expect(managerState.textureAssetUrls.size).toBe(0);
    expect(managerState.cache.size).toBe(0);
  });

  it("prunes old medium atlas pages on modern phones while keeping visible cards", () => {
    useDevice({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      maxTouchPoints: 5,
      media: {
        "(pointer: coarse)": true,
        "(hover: none)": true,
      },
    });

    const manager = new LODManager();
    const invalidations: Array<{ lod: string; slugs: string[] }> = [];
    manager.onTextureInvalidated((invalidation) => {
      invalidations.push(invalidation);
    });
    const managerState = manager as unknown as {
      cache: Map<string, { medium?: Texture }>;
      mediumAtlas: {
        manifest: {
          version: number;
          atlasCount: number;
          atlases: {
            id: string;
            image: string;
            width: number;
            height: number;
            count: number;
          }[];
          cards: Record<
            string,
            { atlasId: string; x: number; y: number; w: number; h: number }
          >;
        };
        pages: Map<
          string,
          { id: string; image: string; width: number; height: number; count: number }
        >;
        pageTextures: Map<string, Texture>;
        pageAccessOrder: Map<string, number>;
      };
    };

    const atlases = [];
    const cards: Record<
      string,
      { atlasId: string; x: number; y: number; w: number; h: number }
    > = {};

    for (let i = 0; i < 25; i++) {
      const atlasId = `atlas-${i}`;
      const slug = `card_${i}`;
      const atlas = {
        id: atlasId,
        image: `/assets/CardsMediumAtlas/${atlasId}.webp`,
        width: 1112,
        height: 1160,
        count: 1,
      };
      atlases.push(atlas);
      cards[slug] = { atlasId, x: 0, y: 0, w: 275, h: 384 };
      managerState.mediumAtlas.pages.set(atlasId, atlas);
      managerState.mediumAtlas.pageTextures.set(atlasId, createDisposableTexture());
      managerState.mediumAtlas.pageAccessOrder.set(atlasId, i);
      managerState.cache.set(slug, { medium: createDisposableTexture() });
    }

    managerState.mediumAtlas.manifest = {
      version: 1,
      atlasCount: atlases.length,
      atlases,
      cards,
    };

    manager.pruneCache(["card_24"]);

    expect(managerState.mediumAtlas.pageTextures.size).toBe(12);
    expect(managerState.mediumAtlas.pageTextures.has("atlas-0")).toBe(false);
    expect(managerState.mediumAtlas.pageTextures.has("atlas-24")).toBe(true);
    expect(managerState.cache.has("card_0")).toBe(false);
    expect(managerState.cache.has("card_24")).toBe(true);
    expect(
      invalidations.some(
        (invalidation) =>
          invalidation.lod === LOD_LEVELS.MEDIUM &&
          invalidation.slugs.includes("card_0"),
      ),
    ).toBe(true);
  });

  it("evicts all medium atlas pages on low-detail constrained devices", () => {
    useDevice({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      maxTouchPoints: 5,
      connection: { saveData: true },
      media: {
        "(pointer: coarse)": true,
        "(hover: none)": true,
      },
    });

    const manager = new LODManager();
    const managerState = manager as unknown as {
      cache: Map<string, { medium?: Texture }>;
      mediumAtlas: {
        manifest: {
          version: number;
          atlasCount: number;
          atlases: {
            id: string;
            image: string;
            width: number;
            height: number;
            count: number;
          }[];
          cards: Record<
            string,
            { atlasId: string; x: number; y: number; w: number; h: number }
          >;
        };
        pages: Map<
          string,
          { id: string; image: string; width: number; height: number; count: number }
        >;
        pageTextures: Map<string, Texture>;
        pageAccessOrder: Map<string, number>;
      };
    };

    const atlases = [];
    const cards: Record<
      string,
      { atlasId: string; x: number; y: number; w: number; h: number }
    > = {};

    for (let i = 0; i < 3; i++) {
      const atlasId = `atlas-${i}`;
      const slug = `card_${i}`;
      const atlas = {
        id: atlasId,
        image: `/assets/CardsMediumAtlas/${atlasId}.webp`,
        width: 1112,
        height: 1160,
        count: 1,
      };
      atlases.push(atlas);
      cards[slug] = { atlasId, x: 0, y: 0, w: 275, h: 384 };
      managerState.mediumAtlas.pages.set(atlasId, atlas);
      managerState.mediumAtlas.pageTextures.set(atlasId, createDisposableTexture());
      managerState.mediumAtlas.pageAccessOrder.set(atlasId, i);
      managerState.cache.set(slug, { medium: createDisposableTexture() });
    }

    managerState.mediumAtlas.manifest = {
      version: 1,
      atlasCount: atlases.length,
      atlases,
      cards,
    };

    manager.pruneCache(["card_2"]);

    expect(managerState.mediumAtlas.pageTextures.size).toBe(0);
    expect(managerState.cache.size).toBe(0);
  });

  it("creates card textures as frames sharing one atlas page source", async () => {
    useDevice({
      width: 1440,
      height: 900,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      maxTouchPoints: 0,
    });

    const manager = new LODManager();
    const pageTexture = Texture.EMPTY;
    const managerState = manager as unknown as {
      mediumAtlas: {
        manifest: {
          version: number;
          atlasCount: number;
          atlases: {
            id: string;
            image: string;
            width: number;
            height: number;
            count: number;
          }[];
          cards: Record<
            string,
            { atlasId: string; x: number; y: number; w: number; h: number }
          >;
        };
        pages: Map<
          string,
          { id: string; image: string; width: number; height: number; count: number }
        >;
        pageTextures: Map<string, Texture>;
      };
    };

    const atlas = {
      id: "atlas-0",
      image: "/assets/CardsMediumAtlas/atlas-0.webp",
      width: 1112,
      height: 1160,
      count: 12,
    };
    managerState.mediumAtlas.pages.set(atlas.id, atlas);
    managerState.mediumAtlas.pageTextures.set(atlas.id, pageTexture);
    managerState.mediumAtlas.manifest = {
      version: 2,
      atlasCount: 1,
      atlases: [atlas],
      cards: {
        card_0: { atlasId: atlas.id, x: 2, y: 2, w: 275, h: 384 },
        card_1: { atlasId: atlas.id, x: 279, y: 2, w: 275, h: 384 },
      },
    };

    const first = await manager.getTexture("Card 0", LOD_LEVELS.MEDIUM);
    const second = await manager.getTexture("Card 1", LOD_LEVELS.MEDIUM);

    expect(first).not.toBe(second);
    expect(first.source).toBe(pageTexture.source);
    expect(second.source).toBe(pageTexture.source);
    expect(first.frame.x).toBe(2);
    expect(second.frame.x).toBe(279);
  });

  it("cancels queued medium atlas pages outside the latest relevance set", () => {
    useDevice({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      maxTouchPoints: 5,
      media: {
        "(pointer: coarse)": true,
        "(hover: none)": true,
      },
    });

    const manager = new LODManager();
    const rejected = vi.fn();
    const managerState = manager as unknown as {
      mediumAtlas: {
        manifest: {
          version: number;
          atlasCount: number;
          atlases: {
            id: string;
            image: string;
            width: number;
            height: number;
            count: number;
          }[];
          cards: Record<
            string,
            { atlasId: string; x: number; y: number; w: number; h: number }
          >;
        };
        pageQueue: Array<{
          atlas: {
            id: string;
            image: string;
            width: number;
            height: number;
            count: number;
          };
          resolve: (texture: Texture) => void;
          reject: (error: Error) => void;
        }>;
        queuedPageIds: Set<string>;
        pagePromises: Map<string, Promise<Texture>>;
      };
    };

    const atlas0 = {
      id: "atlas-0",
      image: "/assets/CardsMediumAtlas/atlas-0.webp",
      width: 1112,
      height: 1160,
      count: 12,
    };
    const atlas1 = {
      id: "atlas-1",
      image: "/assets/CardsMediumAtlas/atlas-1.webp",
      width: 1112,
      height: 1160,
      count: 12,
    };

    managerState.mediumAtlas.manifest = {
      version: 2,
      atlasCount: 2,
      atlases: [atlas0, atlas1],
      cards: {
        card_0: { atlasId: atlas0.id, x: 2, y: 2, w: 275, h: 384 },
        card_1: { atlasId: atlas1.id, x: 2, y: 2, w: 275, h: 384 },
      },
    };
    managerState.mediumAtlas.pageQueue = [
      {
        atlas: atlas0,
        resolve: vi.fn(),
        reject: rejected,
      },
      {
        atlas: atlas1,
        resolve: vi.fn(),
        reject: vi.fn(),
      },
    ];
    managerState.mediumAtlas.queuedPageIds = new Set([atlas0.id, atlas1.id]);
    managerState.mediumAtlas.pagePromises.set(atlas0.id, Promise.resolve(Texture.EMPTY));
    managerState.mediumAtlas.pagePromises.set(atlas1.id, Promise.resolve(Texture.EMPTY));

    manager.cancelQueuedAtlasLoads(LOD_LEVELS.MEDIUM, ["card_1"]);

    expect(rejected).toHaveBeenCalledOnce();
    expect(managerState.mediumAtlas.pageQueue.map((item) => item.atlas.id)).toEqual([
      atlas1.id,
    ]);
    expect(managerState.mediumAtlas.queuedPageIds.has(atlas0.id)).toBe(false);
    expect(managerState.mediumAtlas.queuedPageIds.has(atlas1.id)).toBe(true);
    expect(managerState.mediumAtlas.pagePromises.has(atlas0.id)).toBe(false);
    expect(managerState.mediumAtlas.pagePromises.has(atlas1.id)).toBe(true);
  });
});
