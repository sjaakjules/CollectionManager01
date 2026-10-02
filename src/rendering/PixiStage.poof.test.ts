// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { PixiStage } from './PixiStage';
import type { CanvasArea } from '@/canvas/canvasAreas';

const created = vi.hoisted(() => vi.fn());
vi.mock('./DeletionPoof', () => ({
  DeletionPoof: class {
    readonly root = new Container();
    readonly update = vi.fn(() => true);
    readonly destroy = vi.fn(() => this.root.destroy({ children: true }));
    constructor(bounds: Bounds, zoom: number) { created(bounds, zoom); }
  },
}));

interface Bounds { left: number; top: number; right: number; bottom: number }
interface Effect {
  root: Container;
  update: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}
interface StageHarness {
  initialize(container: HTMLElement): Promise<void>;
  camera: { container: Container; zoom: number } | null;
  deletionPuffs: Array<{ effect: Effect; start: number }>;
  canvasAreas: CanvasArea[];
  zoneCardSprites: Map<string, typeof card & { sprite: Container }>;
  removeCanvasCardInstance: ReturnType<typeof vi.fn>;
  emitCanvasAreasChange: ReturnType<typeof vi.fn>;
  drawZoneDeleteOverlay: ReturnType<typeof vi.fn>;
  showDeletionPuff(bounds: Bounds): void;
  handleZoneCardDelete(card: { key: string; zoneId: string; instanceId: string; bounds: Bounds }, x: number, y: number): void;
  populateTouchActions(panel: HTMLElement, target: typeof touchTarget, x: number, y: number): void;
  handleTouchTap(target: typeof touchTarget, world: { x: number; y: number }, screen: { x: number; y: number }, doubleTap: boolean): void;
  update(): void;
}
const bounds = { left: 20, top: 40, right: 180, bottom: 260 };
const card = { key: 'deck:a', zoneId: 'deck', instanceId: 'a', bounds };
const touchTarget = { kind: 'zone-card', zoneId: 'deck', instanceId: 'a', zoneCardKey: card.key } as const;
let stage: PixiStage;
let harness: StageHarness;
let cameraRoot: Container;

function firstPuff() {
  const puff = harness.deletionPuffs[0];
  if (!puff) throw new Error('Expected a deletion poof');
  return puff;
}

beforeEach(() => {
  created.mockClear();
  vi.spyOn(PixiStage.prototype as unknown as StageHarness, 'initialize').mockResolvedValue();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  stage = new PixiStage({ container: document.createElement('div'), onAddToDeck: vi.fn(), onRemoveFromDeck: vi.fn() });
  stage.setInteractionEffects({ intensity: 'expressive', lettering: 'both' });
  cameraRoot = new Container();
  harness = Object.assign(stage as unknown as StageHarness, {
    camera: { container: cameraRoot, zoom: 0.5 },
    removeCanvasCardInstance: vi.fn(),
    emitCanvasAreasChange: vi.fn(),
    drawZoneDeleteOverlay: vi.fn(),
  });
});

afterEach(() => {
  stage.destroy();
  cameraRoot.destroy({ children: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('card deletion poof integration', () => {
  it('plays on the first click and removes the card immediately', () => {
    harness.handleZoneCardDelete(card, 0, 0);
    expect(created).toHaveBeenCalledExactlyOnceWith(bounds, 0.5);
    expect(firstPuff().effect.root.parent?.label).toBe('manga-effects');
    expect(firstPuff().effect.root.parent?.parent).toBe(cameraRoot);
    expect(harness.removeCanvasCardInstance).toHaveBeenCalledExactlyOnceWith('deck', 'a');
    expect(harness.emitCanvasAreasChange).toHaveBeenCalledOnce();
  });

  it('honors reduced motion without delaying or preventing deletion', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    harness.handleZoneCardDelete(card, 0, 0);
    expect(created).not.toHaveBeenCalled();
    expect(harness.deletionPuffs).toHaveLength(0);
    expect(harness.removeCanvasCardInstance).toHaveBeenCalledExactlyOnceWith('deck', 'a');
  });

  it('removes from the touch menu on its first activation', () => {
    harness.canvasAreas = [{ id: 'deck', type: 'deck', name: 'Deck', pinned: true,
      bounds: { x: 0, y: 0, width: 600, height: 600 }, cards: [] }];
    harness.zoneCardSprites.set(card.key, { ...card, sprite: new Container() });
    const panel = document.createElement('div');
    harness.populateTouchActions(panel, touchTarget, 100, 100);
    const remove = [...panel.querySelectorAll('button')].find(button => button.textContent === 'Remove from deck canvas');
    expect(remove).toBeDefined();
    remove?.click();
    expect(harness.removeCanvasCardInstance).toHaveBeenCalledExactlyOnceWith('deck', 'a');
    expect(created).toHaveBeenCalledOnce();
  });

  it('removes with one tap on the visible canvas X without requiring a double-tap', () => {
    Object.assign(harness, {hoveredZoneCardKey: card.key,
      app: {canvas: document.createElement('canvas'), destroy: vi.fn()},
      updateHoveredFromWorldPos: vi.fn()});
    harness.zoneCardSprites.set(card.key, { ...card, sprite: new Container() });
    harness.handleTouchTap(touchTarget, { x: bounds.right - 10, y: bounds.top + 10 }, { x: 100, y: 100 }, false);
    expect(harness.removeCanvasCardInstance).toHaveBeenCalledExactlyOnceWith('deck', 'a');
    expect(created).toHaveBeenCalledOnce();
  });

  it('safely skips an effect when the canvas camera is unavailable', () => {
    harness.camera = null;
    harness.showDeletionPuff(bounds);
    expect(created).not.toHaveBeenCalled();
    expect(harness.deletionPuffs).toHaveLength(0);
  });

  it('advances effects by elapsed wall time and forgets completed effects', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    harness.showDeletionPuff(bounds);
    const puff = firstPuff();
    clock.mockReturnValue(1250);
    harness.update();
    expect(puff.effect.update).toHaveBeenLastCalledWith(250);
    expect(harness.deletionPuffs).toHaveLength(1);

    puff.effect.update.mockReturnValue(false);
    clock.mockReturnValue(4000);
    harness.update();
    expect(puff.effect.update).toHaveBeenLastCalledWith(3000);
    expect(harness.deletionPuffs).toHaveLength(0);
  });

  it('uses at most one full cloud during rapid deletions', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    harness.showDeletionPuff(bounds);
    for (let i = 0; i < 8; i++) {
      clock.mockReturnValue(1100 + i * 100);
      harness.showDeletionPuff(bounds);
    }
    expect(created).toHaveBeenCalledOnce();
    expect(harness.deletionPuffs).toHaveLength(1);
    expect(cameraRoot.children.length).toBeLessThanOrEqual(9);
  });

  it('disposes every remaining effect when the canvas is destroyed', () => {
    harness.showDeletionPuff(bounds);
    harness.showDeletionPuff(bounds);
    const effects = harness.deletionPuffs.map((puff) => puff.effect);
    stage.destroy();
    expect(harness.deletionPuffs).toHaveLength(0);
    for (const effect of effects) expect(effect.destroy).toHaveBeenCalledOnce();
    expect(cameraRoot.children).toHaveLength(0);
  });
});
