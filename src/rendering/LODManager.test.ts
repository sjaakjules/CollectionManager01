import { afterEach, describe, expect, it, vi } from "vitest";
import { LOD_LEVELS, LODManager } from "./LODManager";

interface TestDevice {
  width: number;
  height: number;
  userAgent: string;
  maxTouchPoints: number;
  media?: Record<string, boolean>;
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
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LODManager", () => {
  it("uses richer zoom LODs on desktop", () => {
    useDevice({
      width: 1440,
      height: 900,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      maxTouchPoints: 0,
    });

    const manager = new LODManager();

    expect(manager.getLODForZoom(0.05)).toBe(LOD_LEVELS.MEDIUM);
    expect(manager.getLODForZoom(0.2)).toBe(LOD_LEVELS.MEDIUM);
    expect(manager.getLODForZoom(0.8)).toBe(LOD_LEVELS.FULL);
  });

  it("keeps automatic zoom LOD at thumbnails on phone-sized touch devices", () => {
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

    expect(manager.getLODForZoom(0.05)).toBe(LOD_LEVELS.THUMBNAIL);
    expect(manager.getLODForZoom(0.2)).toBe(LOD_LEVELS.THUMBNAIL);
    expect(manager.getLODForZoom(0.8)).toBe(LOD_LEVELS.THUMBNAIL);
  });
});
