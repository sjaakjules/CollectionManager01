// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Point, type Application, type FederatedPointerEvent } from 'pixi.js';
import { Camera } from './Camera';
import { PixiStage } from './PixiStage';

interface NavigationStage {
  initialize(container: HTMLElement): Promise<void>;
  app: Application;
  inspection: Container | null;
  isInitialized: boolean;
  camera: Camera;
  spacePanHeld: boolean;
  handlePanKeyDown(event: KeyboardEvent): void;
  handlePanKeyUp(event: KeyboardEvent): void;
  onPointerDown(event: FederatedPointerEvent): void;
  onPointerMove(event: FederatedPointerEvent): void;
  onPointerUp(event: FederatedPointerEvent): void;
}
let stage: PixiStage;
let navigation: NavigationStage;
let camera: Camera;
const initializeStage = (PixiStage.prototype as unknown as NavigationStage).initialize;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(PixiStage.prototype as unknown as NavigationStage, 'initialize').mockResolvedValue();
  stage = new PixiStage({ container: document.createElement('div'), onAddToDeck: vi.fn(), onRemoveFromDeck: vi.fn() });
  navigation = stage as unknown as NavigationStage;
  const canvas = document.createElement('canvas');
  camera = new Camera({
    app: { canvas, stage: new Container(), screen: { width: 1000, height: 800 }, renderer: { events: { domElement: canvas } } } as unknown as Application,
    worldWidth: 10000, worldHeight: 10000,
  });
  navigation.camera = camera;
  // Use the real viewport input order: its navigation listener runs before the
  // canvas handler that pauses dragging for card movement or a selection box.
  camera.viewport.on('pointerdown', navigation.onPointerDown.bind(navigation));
  camera.viewport.on('pointermove', navigation.onPointerMove.bind(navigation));
  camera.viewport.on('pointerup', navigation.onPointerUp.bind(navigation));
  window.addEventListener('keydown', navigation.handlePanKeyDown);
  window.addEventListener('keyup', navigation.handlePanKeyUp);
});
afterEach(() => {
  window.removeEventListener('keydown', navigation.handlePanKeyDown);
  window.removeEventListener('keyup', navigation.handlePanKeyUp);
  if (!navigation.isInitialized) camera.destroy();
  stage.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pointer(x: number, y: number, button: number): FederatedPointerEvent {
  return { global: new Point(x, y), globalX: x, globalY: y, pointerId: 1, data: { pointerId: 1 }, pointerType: 'mouse', button, buttons: 1 << button } as FederatedPointerEvent;
}
function drag(button: number) {
  const before = { x: camera.viewport.x, y: camera.viewport.y };
  camera.viewport.emit('pointerdown', pointer(100, 100, button));
  camera.viewport.emit('pointermove', pointer(150, 140, button));
  camera.viewport.emit('pointerup', pointer(150, 140, button));
  return { x: camera.viewport.x - before.x, y: camera.viewport.y - before.y };
}

describe('real viewport navigation', () => {
  it.each([1, 2])('pans with mouse button %i without resetting the viewport drag origin', (button) => {
    expect(drag(button)).toEqual({ x: 50, y: 40 });
  });
  it('pans with Space and left-drag, then returns to selection after key release', () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
    expect(navigation.spacePanHeld).toBe(true);
    expect(drag(0)).toEqual({ x: 50, y: 40 });
    document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
    expect(navigation.spacePanHeld).toBe(false);
    expect(drag(0)).toEqual({ x: 0, y: 0 });
  });
  it('does not hijack Space when typing or activating a button', () => {
    for (const tag of ['input', 'textarea', 'button']) {
      const element = document.createElement(tag);
      document.body.append(element);
      element.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
      expect(navigation.spacePanHeld).toBe(false);
      element.remove();
    }
  });

  it('blocks wheel navigation behind inspection until it closes', async () => {
    camera.destroy();
    const canvas = document.createElement('canvas');
    const appStage = new Container();
    navigation.app = {
      init: vi.fn().mockResolvedValue(undefined), canvas, stage: appStage,
      screen: { width: 1000, height: 800 }, ticker: { add: vi.fn(), stop: vi.fn() },
      renderer: { events: { domElement: canvas, mapPositionToPoint: (point: Point, x: number, y: number) => point.set(x, y) } },
      destroy: () => appStage.destroy({ children: true }),
    } as unknown as Application;
    await initializeStage.call(navigation, document.createElement('div'));
    camera = navigation.camera;
    navigation.inspection = new Container();
    const initial = { x: camera.viewport.x, y: camera.viewport.y, zoom: camera.zoom };
    for (const options of [{ deltaX: 30 }, { deltaY: -40 }]) {
      const event = new WheelEvent('wheel', { clientX: 400, clientY: 300, cancelable: true, ...options });
      canvas.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect({ x: camera.viewport.x, y: camera.viewport.y, zoom: camera.zoom }).toEqual(initial);
    }
    stage.runCanvasGesture('close-inspection');
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, cancelable: true }));
    expect(camera.viewport.x).not.toBe(initial.x);
  });
});
