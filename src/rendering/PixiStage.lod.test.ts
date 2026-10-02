import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PixiStage } from './PixiStage';
import type { CameraBounds } from './Camera';
import { LOD_LEVELS, lodManager, type LODTextureInvalidation } from './LODManager';

function card(name: string, left: number) {
  return {
    cardName: name, imageSlug: name, visible: true,
    getWorldBounds: () => ({ left, right: left + 100, top: 100, bottom: 240 }),
    loadInitialTexture: vi.fn(), updateLOD: vi.fn(), refreshCurrentLOD: vi.fn(),
    reloadCurrentTexture: vi.fn(), releaseTextureForLOD: vi.fn(),
  };
}

interface StageHarness {
  camera: { zoom: number; getVisibleBounds(): CameraBounds };
  performCulling(): void;
  handleZoomChange(zoom: number): void;
  getVisibleCardNamesForHighDetail(): string[];
  getPhoneMediumPriorityCardNames(): string[];
  refreshVisibleTextureLODs(): void;
  reloadVisibleTexturesAfterContextRestore(): void;
  handleTextureInvalidated(invalidation: LODTextureInvalidation): void;
  startTextureReveal(): Promise<void>;
}

let stage: StageHarness;
let visible: ReturnType<typeof card>;
let near: ReturnType<typeof card>;
let distant: ReturnType<typeof card>;
let avatar: ReturnType<typeof card>;
let bounds: CameraBounds;

beforeEach(() => {
  vi.useFakeTimers();
  visible = card('lightning_bolt', 400);
  near = card('riptide', 1100);
  distant = card('wasteland', 5400);
  avatar = card('animist', 200);
  bounds = { left: 0, right: 1000, top: 0, bottom: 800 };
  stage = Object.assign(Object.create(PixiStage.prototype) as StageHarness, {
    camera: { zoom: 1, getVisibleBounds: () => bounds },
    cardSprites: new Map(), deckSprites: new Map(), associationShelfSprites: new Map(),
    zoneCardSprites: new Map([visible, near, distant].map((sprite) => [sprite.cardName, { sprite }])),
    zoneFrames: new Map([['deck', { avatarSprite: avatar }]]),
    initialRevealCompleted: true, isRevealInProgress: false,
    queueVisibleHighDetailPreload: vi.fn(), pruneFullTextureCache: vi.fn(),
    viewportVelocityPxPerMs: { x: 0, y: 0 },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('on-demand deck card detail', () => {
  it('applies the latest zoom when startup images finish after the camera has moved', async () => {
    let finishThumbnail: () => void = () => {};
    const ready = new Promise<void>((resolve) => { finishThumbnail = resolve; });
    const catalogueCard = Object.assign(card('shield_maidens', 400), { textureReady: ready, isTextureReady: true, alpha: 1 });
    Object.assign(stage, {
      cardSprites: new Map([['shield_maidens', {
        sprite: catalogueCard, layout: { name: 'shield_maidens' }, bounds: catalogueCard.getWorldBounds(),
      }]]),
      headerLabels: [], pendingRevealTimeouts: [], revealRunId: 0,
    });
    vi.spyOn(lodManager, 'getAtlasAssignments').mockResolvedValue(new Map());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
    await stage.startTextureReveal();
    stage.camera.zoom = 2;
    stage.handleZoomChange(2);
    await vi.runAllTimersAsync();
    expect(catalogueCard.updateLOD).not.toHaveBeenCalled();

    finishThumbnail();
    await ready;
    expect(catalogueCard.updateLOD).toHaveBeenCalledWith(2);
  });

  it('stops obsolete preload work and progress after changing view or zooming out', async () => {
    let continueLoading: (() => boolean) | undefined;
    let reportProgress: ((loaded: number, total: number) => void) | undefined;
    let finishLoading: () => void = () => {};
    const pending = new Promise<void>((resolve) => { finishLoading = resolve; });
    vi.spyOn(lodManager, 'preloadTextures').mockImplementationOnce((_names, options) => {
      continueLoading = options?.shouldContinue;
      reportProgress = options?.onProgress;
      return pending;
    });
    const shouldLoad = vi.fn(() => true);
    const progress = vi.fn();
    const loader = Object.assign(Object.create(PixiStage.prototype) as {
      runVisibleHighDetailPreload(): Promise<void>;
      queueVisibleHighDetailPreload(): void;
      highDetailPreloadQueued: boolean;
    }, {
      shouldLoadHighDetail: shouldLoad,
      getVisibleDetailLOD: () => LOD_LEVELS.FULL,
      getVisibleCardNamesForHighDetail: () => ['lightning_bolt'],
      highDetailPreloadRunId: 0, highDetailPreloadRunning: false,
      highDetailPreloadQueued: false,
      refreshVisibleTextureLODs: vi.fn(), pruneFullTextureCache: vi.fn(),
      onBackgroundTextureProgress: progress,
    });
    const run = loader.runVisibleHighDetailPreload();
    expect(continueLoading?.()).toBe(true);

    loader.queueVisibleHighDetailPreload(); // Move to a different view.
    expect(continueLoading?.()).toBe(false);
    expect(loader.highDetailPreloadQueued).toBe(true);
    shouldLoad.mockReturnValue(false); // Zoom back to thumbnails.
    loader.queueVisibleHighDetailPreload();
    expect(loader.highDetailPreloadQueued).toBe(false);
    reportProgress?.(1, 10);
    expect(progress).toHaveBeenCalledExactlyOnceWith(0, 0);
    finishLoading();
    await run;
    expect(lodManager.preloadTextures).toHaveBeenCalledOnce();
  });

  it('loads visible and nearby cards plus avatars, leaving distant decks unloaded', () => {
    stage.performCulling();
    for (const sprite of [visible, near, avatar]) {
      expect(sprite.visible).toBe(true);
      expect(sprite.loadInitialTexture).toHaveBeenCalledOnce();
      expect(sprite.updateLOD).toHaveBeenCalledWith(1);
    }
    expect(distant.visible).toBe(false);
    expect(distant.loadInitialTexture).not.toHaveBeenCalled();
    expect(distant.updateLOD).not.toHaveBeenCalled();
    expect(stage.getVisibleCardNamesForHighDetail()).toEqual(['lightning_bolt', 'riptide', 'animist']);
    expect(stage.getPhoneMediumPriorityCardNames()).toEqual(['lightning_bolt', 'animist', 'riptide']);
  });

  it('upgrades visible deck avatars with zoom and loads newly revealed cards when panning at the same zoom', async () => {
    stage.performCulling();
    stage.camera.zoom = 2;
    stage.handleZoomChange(2);
    await vi.runAllTimersAsync();
    expect(avatar.updateLOD).toHaveBeenLastCalledWith(2);
    expect(visible.updateLOD).toHaveBeenLastCalledWith(2);
    expect(distant.updateLOD).not.toHaveBeenCalled();

    bounds = { left: 5000, right: 6000, top: 0, bottom: 800 };
    stage.performCulling();
    expect(distant.visible).toBe(true);
    expect(distant.loadInitialTexture).toHaveBeenCalledOnce();
    expect(distant.updateLOD).toHaveBeenCalledWith(2);
    expect(visible.visible).toBe(false);
    expect(avatar.visible).toBe(false);
    expect(stage.getVisibleCardNamesForHighDetail()).toEqual(['wasteland']);
  });

  it('uses the final cursor-anchored viewport before requesting detail after a large zoom step', async () => {
    bounds = { left: 0, right: 6000, top: 0, bottom: 800 };
    stage.performCulling();
    vi.clearAllMocks();
    stage.camera.zoom = 2;
    stage.handleZoomChange(2);
    // Like pixi-viewport, move to the cursor only after emitting zoomed.
    bounds = { left: 5000, right: 6000, top: 0, bottom: 800 };
    await vi.runAllTimersAsync();
    expect(visible.updateLOD).not.toHaveBeenCalled();
    expect(near.updateLOD).not.toHaveBeenCalled();
    expect(avatar.updateLOD).not.toHaveBeenCalled();
    expect(distant.updateLOD).toHaveBeenCalledWith(2);
    expect(stage.getVisibleCardNamesForHighDetail()).toEqual(['wasteland']);
  });

  it('refreshes deferred avatar detail and releases its textures safely on eviction or context loss', () => {
    stage.performCulling();
    stage.refreshVisibleTextureLODs();
    stage.reloadVisibleTexturesAfterContextRestore();
    expect(avatar.refreshCurrentLOD).toHaveBeenCalledOnce();
    expect(avatar.reloadCurrentTexture).toHaveBeenCalledOnce();
    expect(distant.refreshCurrentLOD).not.toHaveBeenCalled();
    expect(distant.reloadCurrentTexture).not.toHaveBeenCalled();

    stage.handleTextureInvalidated({ lod: LOD_LEVELS.MEDIUM, slugs: ['animist', 'lightning_bolt'] });
    expect(avatar.releaseTextureForLOD).toHaveBeenCalledWith(LOD_LEVELS.MEDIUM);
    expect(visible.releaseTextureForLOD).toHaveBeenCalledWith(LOD_LEVELS.MEDIUM);
    expect(near.releaseTextureForLOD).not.toHaveBeenCalled();
  });
});
