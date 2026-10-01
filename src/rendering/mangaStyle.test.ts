import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { drawMangaOutline, mangaGeometry, unionEffectBounds, MANGA_PALETTE } from './mangaStyle';

describe('card gesture geometry', () => {
  it('retains portrait and landscape proportions at every zoom, including large stacks', () => {
    for (const zoom of [0.05, 0.3, 1, 3]) {
      const portrait = mangaGeometry({ left: 0, top: 0, right: 744, bottom: 1039 }, zoom);
      const landscape = mangaGeometry({ left: 0, top: 0, right: 1039, bottom: 744 }, zoom);
      expect(portrait.width).toBeCloseTo(744 * zoom);
      expect(portrait.height).toBeCloseTo(1039 * zoom);
      expect(landscape.width / landscape.height).toBeCloseTo(1039 / 744);
      expect(portrait.detail).toBeLessThanOrEqual(1.25);
    }
  });

  it('encloses both directions of stack offsets and ignores missing or invalid bounds', () => {
    const spellStack = unionEffectBounds([
      { left: 10, top: 20, right: 110, bottom: 160 },
      { left: 10, top: 36, right: 110, bottom: 176 },
      { left: NaN, top: 0, right: 0, bottom: 0 },
    ]);
    const siteStack = unionEffectBounds([
      { left: 200, top: 80, right: 340, bottom: 180 },
      { left: 200, top: 48, right: 340, bottom: 148 },
    ]);
    expect(spellStack).toEqual({ left: 10, top: 20, right: 110, bottom: 176 });
    expect(siteStack).toEqual({ left: 200, top: 48, right: 340, bottom: 180 });
    expect(unionEffectBounds([])).toBeUndefined();
  });

  it('draws paper rims outside the full card at any orientation or zoom', () => {
    for (const [width, height] of [[100, 140], [140, 100], [744, 1039]] as const) {
      for (const zoom of [0.1, 1, 3]) {
        const graphics = new Graphics();
        drawMangaOutline(graphics, { left: 0, top: 0, right: width, bottom: height }, zoom);
        const bounds = graphics.getLocalBounds();
        expect(bounds.minX).toBeLessThan(0);
        expect(bounds.minY).toBeLessThan(0);
        expect(bounds.maxX).toBeGreaterThan(width);
        expect(bounds.maxY).toBeGreaterThan(height);
        // Screen-space padding is constant; the art stays uncovered by a fill.
        expect(Math.abs(bounds.minX) * zoom).toBeLessThanOrEqual(6);
        const paperStrokes = graphics.context.instructions.filter(instruction =>
          instruction.action === 'stroke' && instruction.data.style.color === MANGA_PALETTE.paper);
        expect(paperStrokes).toHaveLength(5);
        for (const stroke of paperStrokes) {
          if (stroke.action !== 'stroke') continue;
          expect(stroke.data.path.bounds.width).toBeGreaterThan(0);
          expect(stroke.data.path.bounds.height).toBeGreaterThan(0);
        }
        graphics.destroy();
      }
    }
  });
});
