import { required } from '@/utils/required';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Point, type Application } from 'pixi.js';
import { Camera, CAMERA_DEFAULTS } from './Camera';
import { CardSprite } from './CardSprite';
import { LOD_LEVELS, lodManager } from './LODManager';

let camera: Camera;
let canvas: HTMLCanvasElement;
let onZoomChange: ReturnType<typeof vi.fn<(zoom: number) => void>>;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  canvas = document.createElement('canvas');
  onZoomChange = vi.fn();
  camera = new Camera({
    app: {
      canvas, stage: new Container(), screen: { width: 1000, height: 800 },
      renderer: { events: {
        domElement: canvas,
        mapPositionToPoint: (point: Point, x: number, y: number) => point.set(x, y),
      } },
    } as unknown as Application,
    worldWidth: 10000, worldHeight: 10000, onZoomChange,
  });
  camera.setZoom(1);
  onZoomChange.mockClear();
});

afterEach(() => {
  camera.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function wheel(options: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', {
    clientX: 420, clientY: 310, cancelable: true, ...options,
  });
  canvas.dispatchEvent(event);
  return event;
}

describe('canvas wheel navigation', () => {
  it('keeps the overview below the login control and above the phone dock', () => {
    camera.viewport.resize(390, 844);
    const animate = vi.spyOn(camera.viewport, 'animate');
    camera.fitToContent({left: 0, top: 0, right: 3300, bottom: 7600}, 100, 1, 0,
      {top: 48, bottom: 56, left: 12, right: 12});
    const options = required(animate.mock.calls[0])[0];
    const scale = required(options.scale), position = required(options.position);
    expect(422 - position.y * scale).toBeGreaterThanOrEqual(48);
    expect(422 + (7600 - position.y) * scale).toBeLessThanOrEqual(788);
  });
  it('focuses deck bounds above an open analysis panel and still notifies detail loading', () => {
    const animate = vi.spyOn(camera.viewport, 'animate');
    camera.fitToContent({ left: 100, top: 200, right: 1100, bottom: 1000 }, 50, 450, 300);
    const options = animate.mock.calls[0]?.[0];
    expect(options?.scale).toBeCloseTo(500 / 900);
    const position = options?.position;
    if (!position) throw new Error('Missing focus destination');
    const zoom = options?.scale ?? 1;
    const topOnScreen = 400 + (200 - position.y) * zoom;
    const bottomOnScreen = 400 + (1000 - position.y) * zoom;
    expect(topOnScreen).toBeGreaterThan(0);
    expect(bottomOnScreen).toBeLessThan(500);
    expect(onZoomChange).toHaveBeenLastCalledWith(zoom);
  });
  it.each([
    { deltaY: -1.25 },
    { deltaY: -32 },
    { deltaY: -84.5 },
    { deltaY: -120 },
    { deltaY: -3, deltaMode: 1 },
    { deltaY: -1, deltaMode: 2 },
    { deltaX: 10, deltaY: -24 },
    { deltaY: -24, ctrlKey: true },
  ])('zooms at the cursor and notifies detail loading for %j', (options) => {
    const pointBefore = camera.screenToWorld(420, 310);
    const zoomBefore = camera.zoom;
    const event = wheel(options);

    expect(camera.zoom).toBeGreaterThan(zoomBefore);
    expect(onZoomChange).toHaveBeenLastCalledWith(camera.zoom);
    const pointAfter = camera.screenToWorld(420, 310);
    expect(pointAfter.x).toBeCloseTo(pointBefore.x);
    expect(pointAfter.y).toBeCloseTo(pointBefore.y);
    expect(event.defaultPrevented).toBe(true);

    wheel({ ...options, deltaY: -options.deltaY });
    expect(camera.zoom).toBeCloseTo(zoomBefore);
  });

  it('keeps zooming as a smooth wheel accelerates and while card dragging pauses pan', () => {
    camera.pauseDrag();
    for (const deltaY of [-1.5, -24, -120, -240]) {
      const zoomBefore = camera.zoom;
      wheel({ deltaY });
      expect(camera.zoom).toBeGreaterThan(zoomBefore);
    }
    camera.resumeDrag();
  });

  it('pans sideways only for purely horizontal scrolling', () => {
    const corner = camera.viewport.corner;
    wheel({ deltaX: 30 });
    expect(camera.viewport.corner.x).toBeCloseTo(corner.x + 30 / camera.zoom);
    expect(camera.viewport.corner.y).toBeCloseTo(corner.y);
    expect(camera.zoom).toBe(1);
    expect(onZoomChange).not.toHaveBeenCalled();
    // The horizontal gesture must not latch later vertical scrolling to pan.
    wheel({ deltaY: -24 });
    expect(camera.zoom).toBeGreaterThan(1);
  });

  it('keeps the established zoom limits', () => {
    wheel({ deltaY: -10000 });
    expect(camera.zoom).toBe(CAMERA_DEFAULTS.MAX_ZOOM);
    wheel({ deltaY: 10000 });
    expect(camera.zoom).toBe(CAMERA_DEFAULTS.MIN_ZOOM);
  });

  it('does not consume scrolling in a panel outside the canvas', () => {
    const panel = document.createElement('div');
    const event = new WheelEvent('wheel', { deltaY: 32, cancelable: true });
    panel.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(camera.zoom).toBe(1);
  });

  it('requests thumbnail, medium and full card detail as wheel zoom crosses the existing thresholds', () => {
    vi.spyOn(lodManager, 'getTextureMatchSync').mockReturnValue(null);
    vi.spyOn(lodManager, 'hasExactTexture').mockReturnValue(false);
    const getTexture = vi.spyOn(lodManager, 'getTexture').mockImplementation(() => new Promise(() => {}));
    const card = new CardSprite({ name: 'Lightning Bolt', isLandscape: false, x: 0, y: 0, displaySize: { width: 100, height: 140 } });
    onZoomChange.mockImplementation((zoom: number) => card.updateLOD(zoom));
    camera.setZoom(0.5); // 70px high: startup thumbnails.
    card.loadInitialTexture();
    expect(getTexture).toHaveBeenLastCalledWith('lightning_bolt', LOD_LEVELS.THUMBNAIL);

    wheel({ deltaY: -500 }); // ~150px high: medium atlas.
    expect(getTexture).toHaveBeenLastCalledWith('lightning_bolt', LOD_LEVELS.MEDIUM);
    wheel({ deltaY: -500 }); // ~322px high: full image.
    expect(getTexture).toHaveBeenLastCalledWith('lightning_bolt', LOD_LEVELS.FULL);
    wheel({ deltaY: 1000 });
    expect(getTexture).toHaveBeenLastCalledWith('lightning_bolt', LOD_LEVELS.THUMBNAIL);
    card.destroy({ children: true });
  });
});
