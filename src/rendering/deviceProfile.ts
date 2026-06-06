/**
 * Runtime rendering hints for devices with tighter GPU and memory budgets.
 */

const MOBILE_VIEWPORT_SHORT_SIDE_MAX = 820;
const MOBILE_RENDER_RESOLUTION_CAP = 3;
const LOW_DETAIL_RENDER_RESOLUTION_CAP = 1.5;
const DESKTOP_RENDER_RESOLUTION_CAP = 2;
const DESKTOP_TEXT_RESOLUTION_MAX = 3;
const LOW_DEVICE_MEMORY_GB_MAX = 4;

interface NavigatorWithResourceHints extends Navigator {
  connection?: {
    saveData?: boolean;
  };
  deviceMemory?: number;
}

function getNavigator(): NavigatorWithResourceHints | null {
  if (typeof navigator === "undefined") return null;
  return navigator as NavigatorWithResourceHints;
}

function getDevicePixelRatio(): number {
  if (typeof window === "undefined") return 1;
  const dpr = window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

function getShortViewportSide(): number {
  if (typeof window === "undefined") return Number.POSITIVE_INFINITY;
  const width = window.innerWidth || window.screen?.width || 0;
  const height = window.innerHeight || window.screen?.height || 0;
  if (width <= 0 || height <= 0) return Number.POSITIVE_INFINITY;
  return Math.min(width, height);
}

function matchesMedia(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(query).matches;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isConstrainedTextureDevice(): boolean {
  const nav = getNavigator();
  if (!nav) return false;

  const userAgent = nav.userAgent;
  const isMobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const isIPadDesktopMode =
    /\bMacintosh\b/.test(userAgent) && (nav.maxTouchPoints ?? 0) > 1;
  const hasSmallTouchViewport =
    getShortViewportSide() <= MOBILE_VIEWPORT_SHORT_SIDE_MAX &&
    (matchesMedia("(pointer: coarse)") || matchesMedia("(hover: none)"));
  const lowDeviceMemory =
    typeof nav.deviceMemory === "number" &&
    nav.deviceMemory <= LOW_DEVICE_MEMORY_GB_MAX;
  const saveData = nav.connection?.saveData === true;

  return (
    isMobileUserAgent ||
    isIPadDesktopMode ||
    hasSmallTouchViewport ||
    lowDeviceMemory ||
    saveData
  );
}

export function isLowDetailTextureDevice(): boolean {
  const nav = getNavigator();
  if (!nav) return false;

  const lowDeviceMemory =
    typeof nav.deviceMemory === "number" &&
    nav.deviceMemory <= LOW_DEVICE_MEMORY_GB_MAX;
  const saveData = nav.connection?.saveData === true;

  return lowDeviceMemory || saveData;
}

export function getPixiCanvasResolution(): number {
  let cap = DESKTOP_RENDER_RESOLUTION_CAP;
  if (isConstrainedTextureDevice()) {
    cap = isLowDetailTextureDevice()
      ? LOW_DETAIL_RENDER_RESOLUTION_CAP
      : MOBILE_RENDER_RESOLUTION_CAP;
  }
  return clamp(getDevicePixelRatio(), 1, cap);
}

export function getPixiTextResolution(): number {
  if (isConstrainedTextureDevice()) {
    return getPixiCanvasResolution();
  }
  return clamp(getDevicePixelRatio() * 1.5, 1, DESKTOP_TEXT_RESOLUTION_MAX);
}

export function getInitialRevealConcurrentLoads(): number {
  return isConstrainedTextureDevice() ? 4 : 24;
}

export function getHighDetailLoadOptions(): {
  concurrentLoads: number;
  batchSize: number;
} {
  return isConstrainedTextureDevice()
    ? { concurrentLoads: 2, batchSize: 4 }
    : { concurrentLoads: 6, batchSize: 24 };
}

export function shouldPreloadFullTextureCatalog(): boolean {
  return false;
}
