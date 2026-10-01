import type { Graphics } from 'pixi.js';

export const MANGA_PALETTE = {
  ink: 0x161620, paper: 0xfff3d6, gold: 0xf2c572,
  muted: 0xb6af9f, line: 0x817969, surface: 0x1b1d29,
  raised: 0x292b36, active: 0x484336, danger: 0xef6b64,
} as const;

export interface EffectBounds { left: number; top: number; right: number; bottom: number }

/** Use the displayed envelope, including the offset of every card in a stack. */
export function unionEffectBounds(bounds: Iterable<EffectBounds>): EffectBounds | undefined {
  let result: EffectBounds | undefined;
  for (const next of bounds) {
    if (![next.left, next.top, next.right, next.bottom].every(Number.isFinite) || next.right <= next.left || next.bottom <= next.top) continue;
    result = result ? {
      left: Math.min(result.left, next.left), top: Math.min(result.top, next.top),
      right: Math.max(result.right, next.right), bottom: Math.max(result.bottom, next.bottom),
    } : { ...next };
  }
  return result;
}

/** Geometry follows cards exactly. Only stroke and lettering size are bounded. */
export function mangaGeometry(bounds: EffectBounds, zoom: number) {
  const scale = Math.max(0.01, zoom);
  const width = Math.max(0, bounds.right - bounds.left) * scale;
  const height = Math.max(0, bounds.bottom - bounds.top) * scale;
  return { width, height, detail: Math.min(1.25, Math.max(0.5, Math.min(width, height) / 115)) };
}

/** Paper rim, ink keyline and short gold corners; no opaque cover over the art. */
export function drawMangaOutline(graphics: Graphics, bounds: EffectBounds, zoom = 1, fresh = false): void {
  const safeZoom = Math.max(0.01, zoom);
  const pixel = 1 / safeZoom;
  const { left, top, right, bottom } = bounds;
  const inset = 2.5 * pixel;
  const length = Math.min(15 * pixel, Math.min(right - left, bottom - top) * 0.24);
  const x = left - inset; const y = top - inset;
  const width = right - left + inset * 2; const height = bottom - top + inset * 2;
  graphics.clear();
  graphics.roundRect(x, y, width, height, 3 * pixel)
    .stroke({ color: MANGA_PALETTE.ink, width: 4 * pixel, alpha: 0.85 });
  // Pixi consumes a path on stroke; retrace it for the lighter inner line.
  graphics.roundRect(x, y, width, height, 3 * pixel)
    .stroke({ color: fresh ? MANGA_PALETTE.gold : MANGA_PALETTE.paper, width: pixel, alpha: fresh ? 0.8 : 0.65 });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const cx = sx < 0 ? x : x + width; const cy = sy < 0 ? y : y + height;
    graphics.moveTo(cx - sx * length, cy).lineTo(cx, cy).lineTo(cx, cy - sy * length)
      .stroke({ color: MANGA_PALETTE.ink, width: 5 * pixel, alpha: 0.85 });
    graphics.moveTo(cx - sx * length, cy).lineTo(cx, cy).lineTo(cx, cy - sy * length)
      .stroke({ color: fresh ? MANGA_PALETTE.gold : MANGA_PALETTE.paper, width: 2 * pixel });
  }
}
