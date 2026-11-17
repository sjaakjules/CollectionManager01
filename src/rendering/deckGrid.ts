import type { Graphics } from 'pixi.js';
import type { CanvasAreaBounds } from '@/canvas/canvasAreas';
import { DRAWN_GRID } from './Grid';
import { MANGA_PALETTE } from './mangaStyle';

const DOT_RADIUS = 1.25;
const MAX_INTERSECTIONS = 4096;

/** Draw behind deck cards, on the same lattice as world-space snapping. */
export function drawDeckGrid(graphics: Graphics, bounds: CanvasAreaBounds): void {
  const { x: left, y: top, width, height } = bounds;
  const right = left + width;
  const bottom = top + height;
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return;

  // A free resize can make a mostly empty deck arbitrarily large. Coarsen its
  // drawn lattice in whole units so rebuilding the frame remains bounded.
  let stepX: number = DRAWN_GRID.width;
  let stepY: number = DRAWN_GRID.height;
  while ((Math.ceil(width / stepX) + 1) * (Math.ceil(height / stepY) + 1) > MAX_INTERSECTIONS) {
    if (width / stepX >= height / stepY) stepX *= 2;
    else stepY *= 2;
  }

  const startX = Math.ceil((left + DOT_RADIUS) / stepX) * stepX;
  const startY = Math.ceil((top + DOT_RADIUS) / stepY) * stepY;
  const columns = Math.max(0, Math.floor((right - DOT_RADIUS - startX) / stepX) + 1);
  const rows = Math.max(0, Math.floor((bottom - DOT_RADIUS - startY) / stepY) + 1);

  if (columns || rows) {
    for (let col = 0; col < columns; col++) {
      const x = startX + col * stepX;
      graphics.moveTo(x, top).lineTo(x, bottom);
    }
    for (let row = 0; row < rows; row++) {
      const y = startY + row * stepY;
      graphics.moveTo(left, y).lineTo(right, y);
    }
    graphics.stroke({ width: 0.7, color: MANGA_PALETTE.muted, alpha: 0.14 });
  }
  if (columns && rows) {
    for (let col = 0; col < columns; col++) {
      const x = startX + col * stepX;
      for (let row = 0; row < rows; row++) graphics.circle(x, startY + row * stepY, DOT_RADIUS);
    }
    graphics.fill({ color: MANGA_PALETTE.muted, alpha: 0.32 });
  }
}
