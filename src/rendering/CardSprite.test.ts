import { afterEach, describe, expect, it, vi } from "vitest";
import { Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import { CardSprite } from "./CardSprite";
import { shouldRotateCardImage } from "./cardOrientation";
import { LOD_LEVELS, lodManager, type LODLevel } from "./LODManager";

function stubLODManager() {
  const exactLODs = new Set<LODLevel>([
    LOD_LEVELS.THUMBNAIL,
    LOD_LEVELS.MEDIUM,
    LOD_LEVELS.FULL,
  ]);

  vi.spyOn(lodManager, "getStartupLOD").mockReturnValue(LOD_LEVELS.THUMBNAIL);
  vi.spyOn(lodManager, "resolveLOD").mockImplementation((lod) => lod);
  vi.spyOn(lodManager, "getInteractiveDetailLOD").mockReturnValue(
    LOD_LEVELS.FULL,
  );
  vi.spyOn(lodManager, "shouldDeferAsyncTextureLoad").mockReturnValue(false);
  vi.spyOn(lodManager, "hasExactTexture").mockImplementation((_slug, lod) =>
    exactLODs.has(lod),
  );
  vi.spyOn(lodManager, "getTextureMatchSync").mockImplementation((_slug, lod) =>
    exactLODs.has(lod) ? { lod, texture: Texture.EMPTY } : null,
  );
  vi.spyOn(lodManager, "getExactTextureSync").mockImplementation((_slug, lod) =>
    exactLODs.has(lod) ? Texture.EMPTY : null,
  );
  vi.spyOn(lodManager, "getTexture").mockImplementation(async () => Texture.EMPTY);

  return {
    setFullAvailable(available: boolean) {
      if (available) {
        exactLODs.add(LOD_LEVELS.FULL);
      } else {
        exactLODs.delete(LOD_LEVELS.FULL);
      }
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function deferredTexture() {
  let resolve: (texture: Texture) => void = () => {};
  const promise = new Promise<Texture>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function delayedCardTextures() {
  stubLODManager();
  const pending = {
    thumbnail: deferredTexture(),
    medium: deferredTexture(),
    full: deferredTexture(),
  };
  vi.mocked(lodManager.getTextureMatchSync).mockReturnValue(null);
  vi.mocked(lodManager.hasExactTexture).mockReturnValue(false);
  vi.mocked(lodManager.getTexture).mockImplementation((_slug, lod) => pending[lod].promise);
  const sprite = new CardSprite({
    name: 'Lightning Bolt', isLandscape: false, x: 0, y: 0,
    displaySize: { width: 100, height: 140 },
  });
  sprite.loadInitialTexture();
  return { sprite, pending };
}

describe("CardSprite LOD display", () => {
  it('keeps full detail when earlier medium and thumbnail downloads finish later', async () => {
    const { sprite, pending } = delayedCardTextures();
    sprite.updateLOD(1);
    sprite.updateLOD(2);
    pending.full.resolve(Texture.EMPTY);
    await pending.full.promise;
    expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.FULL);

    for (const lod of [LOD_LEVELS.MEDIUM, LOD_LEVELS.THUMBNAIL]) {
      pending[lod].resolve(Texture.EMPTY);
      await pending[lod].promise;
      expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.FULL);
    }
    sprite.destroy({ children: true });
  });

  it('shows each useful fallback immediately while sharper detail is still downloading', async () => {
    const { sprite, pending } = delayedCardTextures();
    sprite.updateLOD(1);
    sprite.updateLOD(2);
    for (const lod of [LOD_LEVELS.THUMBNAIL, LOD_LEVELS.MEDIUM, LOD_LEVELS.FULL]) {
      pending[lod].resolve(Texture.EMPTY);
      await pending[lod].promise;
      expect(sprite.currentTextureLOD).toBe(lod);
      expect(sprite.isTextureReady).toBe(true);
    }
    sprite.destroy({ children: true });
  });

  it('does not replace the small texture with a late full image after zooming out', async () => {
    const { sprite, pending } = delayedCardTextures();
    pending.thumbnail.resolve(Texture.EMPTY);
    await pending.thumbnail.promise;
    sprite.updateLOD(2);
    sprite.updateLOD(0.2);
    await pending.thumbnail.promise;
    pending.full.resolve(Texture.EMPTY);
    await pending.full.promise;
    expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.THUMBNAIL);
    sprite.destroy({ children: true });
  });

  it('leaves a destroyed sprite alone when its pending image arrives', async () => {
    const { sprite, pending } = delayedCardTextures();
    sprite.destroy({ children: true });
    pending.thumbnail.resolve(Texture.EMPTY);
    await pending.thumbnail.promise;
    await sprite.textureReady;
    expect(sprite.currentTextureLOD).toBeNull();
  });

  it('reuses cached detail immediately without downloading on selection or repeated zoom updates', () => {
    stubLODManager();
    const sprite = new CardSprite({ name: 'Lightning Bolt', isLandscape: false, x: 0, y: 0, displaySize: { width: 100, height: 140 } });
    sprite.loadInitialTexture();
    sprite.updateLOD(2);
    sprite.setSelected(true);
    sprite.updateLOD(2.1);
    sprite.refreshCurrentLOD();
    expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.FULL);
    expect(lodManager.getTexture).not.toHaveBeenCalled();
    sprite.destroy({ children: true });
  });

  it.each([false, true])('keeps cards with missing artwork visible and lets startup finish (landscape: %s)', async (isLandscape) => {
    stubLODManager();
    vi.mocked(lodManager.getTextureMatchSync).mockReturnValue(null);
    // The loader returns WHITE after a missing file (including cached failures).
    vi.mocked(lodManager.getTexture).mockResolvedValue(Texture.WHITE);
    const card = new CardSprite({ name: 'Preview Card', isLandscape, x: 0, y: 0 });
    card.updateLOD(1);
    await card.textureReady;
    const artwork = card.children.find((child) => child instanceof Sprite);
    expect(artwork?.visible).toBe(true);
    expect(artwork?.rotation).toBe(0);
    const label = card.children.find((child) => child instanceof Text);
    expect(label?.text).toContain('Preview Card');
    expect(label?.text).toContain('Artwork unavailable');

    // An available image on a later LOD request replaces the placeholder.
    vi.mocked(lodManager.getTextureMatchSync).mockReturnValue({ lod: LOD_LEVELS.FULL, texture: Texture.EMPTY });
    card.emit('pointerover', {} as FederatedPointerEvent);
    expect(card.currentTextureLOD).toBe(LOD_LEVELS.FULL);
    expect(card.children).not.toContain(label);
    card.destroy({ children: true });
  });

  it("rotates legacy portrait Site textures but preserves upright landscape sources", () => {
    expect(shouldRotateCardImage(true, 275, 384)).toBe(true);
    expect(shouldRotateCardImage(true, 1039, 744)).toBe(false);
    expect(shouldRotateCardImage(false, 275, 384)).toBe(false);
  });

  it("keeps a loaded full texture visible after hover ends while normal LOD is medium", () => {
    stubLODManager();
    const pointerEvent = {} as FederatedPointerEvent;
    vi.spyOn(lodManager, "getLODForCardDisplay").mockReturnValue(
      LOD_LEVELS.MEDIUM,
    );

    const sprite = new CardSprite({
      name: "Shield Maidens",
      isLandscape: false,
      x: 0,
      y: 0,
    });

    sprite.updateLOD(1);
    expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.MEDIUM);

    sprite.emit("pointerover", pointerEvent);
    expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.FULL);

    sprite.emit("pointerout", pointerEvent);
    expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.FULL);
  });

  it("downgrades a loaded full texture when zooming back to thumbnail", () => {
    stubLODManager();
    const pointerEvent = {} as FederatedPointerEvent;
    const getLODForCardDisplay = vi
      .spyOn(lodManager, "getLODForCardDisplay")
      .mockReturnValueOnce(LOD_LEVELS.MEDIUM)
      .mockReturnValueOnce(LOD_LEVELS.THUMBNAIL);

    const sprite = new CardSprite({
      name: "Shield Maidens",
      isLandscape: false,
      x: 0,
      y: 0,
    });

    sprite.updateLOD(1);
    sprite.emit("pointerover", pointerEvent);
    expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.FULL);

    sprite.updateLOD(0.2);
    expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.THUMBNAIL);
    expect(getLODForCardDisplay).toHaveBeenCalledTimes(2);
  });

  it("falls back from sticky full when the full texture has been evicted", () => {
    const stubs = stubLODManager();
    const pointerEvent = {} as FederatedPointerEvent;
    vi.spyOn(lodManager, "getLODForCardDisplay").mockReturnValue(
      LOD_LEVELS.MEDIUM,
    );

    const sprite = new CardSprite({
      name: "Shield Maidens",
      isLandscape: false,
      x: 0,
      y: 0,
    });

    sprite.updateLOD(1);
    sprite.emit("pointerover", pointerEvent);
    expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.FULL);

    stubs.setFullAvailable(false);
    sprite.emit("pointerout", pointerEvent);
    expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.MEDIUM);
  });

  it("releases an invalidated medium texture to the exact thumbnail fallback", () => {
    stubLODManager();
    vi.spyOn(lodManager, "getLODForCardDisplay").mockReturnValue(
      LOD_LEVELS.MEDIUM,
    );

    const sprite = new CardSprite({
      name: "Shield Maidens",
      isLandscape: false,
      x: 0,
      y: 0,
    });

    sprite.updateLOD(1);
    expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.MEDIUM);

    sprite.releaseTextureForLOD(LOD_LEVELS.MEDIUM);
    expect(sprite.currentTextureLOD).toBe(LOD_LEVELS.THUMBNAIL);
  });
});

describe("CardSprite metric display", () => {
  it("shows decimal metric scores and dims inactive cards", () => {
    stubLODManager();
    const sprite = new CardSprite({
      name: "Shield Maidens",
      isLandscape: false,
      x: 0,
      y: 0,
    });
    const internals = sprite as unknown as {
      scoreText: { text: string; visible: boolean; style: { fill: unknown } };
      alpha: number;
    };

    sprite.setMetricScore(0.42, { color: 0x4aa8ff });

    expect(internals.scoreText.visible).toBe(true);
    expect(internals.scoreText.text).toBe("0.42");
    expect(sprite.alpha).toBe(1);

    sprite.setMetricScore(0, { dimInactive: true });

    expect(sprite.alpha).toBe(0.3);

    sprite.setMetricScore(null);

    expect(internals.scoreText.visible).toBe(false);
    expect(sprite.alpha).toBe(1);
  });

  it("can show metric colour without showing the decimal value", () => {
    stubLODManager();
    const sprite = new CardSprite({
      name: "Shield Maidens",
      isLandscape: false,
      x: 0,
      y: 0,
    });
    const internals = sprite as unknown as {
      metricOutline: { visible: boolean };
      scoreText: { visible: boolean };
      alpha: number;
    };

    sprite.setMetricScore(0.64, {
      color: 0x4aa8ff,
      dimInactive: false,
      showValue: false,
    });

    expect(internals.metricOutline.visible).toBe(true);
    expect(internals.scoreText.visible).toBe(false);
    expect(sprite.alpha).toBe(1);
  });
});
