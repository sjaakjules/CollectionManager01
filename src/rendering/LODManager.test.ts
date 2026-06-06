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

afterEach(() => {
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
});
