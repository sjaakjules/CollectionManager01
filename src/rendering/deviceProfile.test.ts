import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMediumAtlasPageBudget,
  getInitialRevealConcurrentLoads,
  getPixiCanvasResolution,
  isConstrainedTextureDevice,
  isHighMemoryConstrainedTextureDevice,
  isLowDetailTextureDevice,
  shouldUseFullCardHoverPreview,
  shouldPreloadFullTextureCatalog,
} from "./deviceProfile";

interface TestDevice {
  width: number;
  height: number;
  dpr: number;
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
    devicePixelRatio: device.dpr,
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

describe("deviceProfile", () => {
  it("keeps desktop rendering on the richer texture path", () => {
    useDevice({
      width: 1440,
      height: 900,
      dpr: 3,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      maxTouchPoints: 0,
    });

    expect(isConstrainedTextureDevice()).toBe(false);
    expect(getPixiCanvasResolution()).toBe(2);
    expect(getInitialRevealConcurrentLoads()).toBe(24);
    expect(getMediumAtlasPageBudget()).toEqual({
      targetPages: Number.POSITIVE_INFINITY,
      maxPages: Number.POSITIVE_INFINITY,
    });
    expect(shouldUseFullCardHoverPreview()).toBe(true);
    expect(shouldPreloadFullTextureCatalog()).toBe(false);
  });

  it("allows modern phone-sized touch devices to use richer visible-card detail", () => {
    useDevice({
      width: 390,
      height: 844,
      dpr: 3,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      maxTouchPoints: 5,
      media: {
        "(pointer: coarse)": true,
        "(hover: none)": true,
      },
    });

    expect(isConstrainedTextureDevice()).toBe(true);
    expect(isHighMemoryConstrainedTextureDevice()).toBe(false);
    expect(isLowDetailTextureDevice()).toBe(false);
    expect(getPixiCanvasResolution()).toBe(3);
    expect(getInitialRevealConcurrentLoads()).toBe(1);
    expect(getMediumAtlasPageBudget()).toEqual({
      targetPages: 12,
      maxPages: 18,
    });
    expect(shouldUseFullCardHoverPreview()).toBe(false);
    expect(shouldPreloadFullTextureCatalog()).toBe(false);
  });

  it("gives high-memory constrained devices a larger medium atlas budget", () => {
    useDevice({
      width: 430,
      height: 932,
      dpr: 3,
      userAgent:
        "Mozilla/5.0 (Android 15; Mobile) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36",
      maxTouchPoints: 5,
      deviceMemory: 8,
      media: {
        "(pointer: coarse)": true,
        "(hover: none)": true,
      },
    });

    expect(isConstrainedTextureDevice()).toBe(true);
    expect(isHighMemoryConstrainedTextureDevice()).toBe(true);
    expect(isLowDetailTextureDevice()).toBe(false);
    expect(getMediumAtlasPageBudget()).toEqual({
      targetPages: 16,
      maxPages: 24,
    });
  });

  it("keeps save-data phone-sized touch devices on the safest texture path", () => {
    useDevice({
      width: 390,
      height: 844,
      dpr: 3,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      maxTouchPoints: 5,
      connection: { saveData: true },
      media: {
        "(pointer: coarse)": true,
        "(hover: none)": true,
      },
    });

    expect(isConstrainedTextureDevice()).toBe(true);
    expect(isLowDetailTextureDevice()).toBe(true);
    expect(getPixiCanvasResolution()).toBe(1.5);
    expect(getInitialRevealConcurrentLoads()).toBe(1);
    expect(getMediumAtlasPageBudget()).toEqual({
      targetPages: 0,
      maxPages: 0,
    });
    expect(shouldUseFullCardHoverPreview()).toBe(false);
    expect(shouldPreloadFullTextureCatalog()).toBe(false);
  });

  it("keeps large hybrid pointer devices on the desktop texture path", () => {
    useDevice({
      width: 1440,
      height: 900,
      dpr: 2,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
      maxTouchPoints: 10,
      media: {
        "(pointer: coarse)": false,
        "(hover: none)": false,
      },
    });

    expect(isConstrainedTextureDevice()).toBe(false);
    expect(getPixiCanvasResolution()).toBe(2);
    expect(shouldPreloadFullTextureCatalog()).toBe(false);
  });
});
