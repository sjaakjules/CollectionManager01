import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getInitialRevealConcurrentLoads,
  getPixiCanvasResolution,
  isConstrainedTextureDevice,
  shouldPreloadFullTextureCatalog,
} from "./deviceProfile";

interface TestDevice {
  width: number;
  height: number;
  dpr: number;
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
    expect(shouldPreloadFullTextureCatalog()).toBe(true);
  });

  it("uses a safer texture budget for phone-sized touch devices", () => {
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
    expect(getPixiCanvasResolution()).toBe(1.5);
    expect(getInitialRevealConcurrentLoads()).toBe(4);
    expect(shouldPreloadFullTextureCatalog()).toBe(false);
  });
});
