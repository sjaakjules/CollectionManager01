// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { PixiStage } from './PixiStage';

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
  removeCanvasCardInstance: ReturnType<typeof vi.fn>;
  emitCanvasAreasChange: ReturnType<typeof vi.fn>;
  drawZoneDeleteOverlay: ReturnType<typeof vi.fn>;
  showDeletionPuff(bounds: Bounds): void;
  handleZoneCardDelete(card: { key: string; zoneId: string; instanceId: string; bounds: Bounds }, x: number, y: number): void;
  update(): void;
}
const bounds = { left: 20, top: 40, right: 180, bottom: 260 };
const card = { key: 'deck:a', zoneId: 'deck', instanceId: 'a', bounds };
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
  it('plays only after confirmation and removes the card immediately', () => {
    harness.handleZoneCardDelete(card, 0, 0);
    expect(created).not.toHaveBeenCalled();
    expect(harness.removeCanvasCardInstance).not.toHaveBeenCalled();

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
    harness.handleZoneCardDelete(card, 0, 0);
    expect(created).not.toHaveBeenCalled();
    expect(harness.deletionPuffs).toHaveLength(0);
    expect(harness.removeCanvasCardInstance).toHaveBeenCalledExactlyOnceWith('deck', 'a');
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
