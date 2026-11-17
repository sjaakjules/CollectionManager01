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
  it.each([false, true])('keeps the Preview watermark inside card bounds through detail changes and dragging (landscape: %s)', isLandscape => {
    stubLODManager();
    const card = new CardSprite({ name: 'Video card', isLandscape, isPreview: true, x: 200, y: 300 });
    const bounds = card.getWorldBounds();
    const watermark = card.children.find(child => child.label === 'preview-watermark');
    expect(watermark?.eventMode).toBe('none');
    expect(watermark?.interactiveChildren).toBe(false);
    expect(watermark?.children.find(child => child instanceof Text)?.text).toBe('Preview');
    card.loadInitialTexture(); card.updateLOD(2); card.setSelected(true);
    expect(card.children.filter(child => child.label === 'preview-watermark')).toHaveLength(1);
    expect(card.getWorldBounds()).toEqual(bounds);
    const ghost = card.createDragPreview();
    expect(ghost.children.filter(child => child.label === 'preview-watermark')).toHaveLength(1);
    expect(lodManager.getTexture).not.toHaveBeenCalled();
    ghost.destroy({ children: true }); card.destroy({ children: true });
  });
  it.each([false, true])('shows a correctly oriented drag destination before artwork loads (landscape %s)', (isLandscape) => {
    stubLODManager();
    const card = new CardSprite({ name: 'Cold card', isLandscape, x: 200, y: 200 });
    const ghost = card.createDragPreview();
    const image = ghost.children[0] as Sprite;
    expect(image.visible).toBe(true);
    expect(ghost.width).toBe(isLandscape ? 140 : 100);
    expect(ghost.height).toBe(isLandscape ? 100 : 140);
    expect(lodManager.getTexture).not.toHaveBeenCalled();
    ghost.destroy({ children: true });
    expect(Texture.WHITE.destroyed).toBe(false);
    card.destroy();
  });

  it('shares the visible artwork in a ghost without loading or destroying its texture', () => {
    stubLODManager();
    const card = new CardSprite({ name: 'Ready card', isLandscape: true, x: 200, y: 200 });
    const original = card.children[0] as Sprite;
    original.visible = true;
    const ghost = card.createDragPreview();
    const image = ghost.children[0] as Sprite;
    expect(image.texture).toBe(original.texture);
    expect(image.rotation).toBe(original.rotation);
    expect(image.scale.x).toBe(original.scale.x);
    expect(lodManager.getTexture).not.toHaveBeenCalled();
    ghost.destroy({ children: true });
    expect(original.texture.destroyed).toBe(false);
    card.destroy();
  });
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

describe('arrival artwork transforms', () => {
  it.each([false, true])('keeps stack bounds, selection and hit targets stable while the artwork wobbles (landscape: %s)', (isLandscape) => {
    stubLODManager();
    const width = isLandscape ? 140 : 100;
    const height = isLandscape ? 100 : 140;
    const card = new CardSprite({ name: 'Arrival', isLandscape, x: 700, y: 900, displaySize: { width, height } });
    const before = card.getWorldBounds();
    const center = card.getCenter();
    card.setSelected(true);
    card.setNewlyAdded(true);
    const outline = card.getChildByLabel('selection-outline');
    card.setArrivalPose({ scale: 1.08, rotation: 0.04, offsetY: -.025 });
    const visual = card.getChildByLabel('arrival-artwork');
    expect(visual?.pivot.x).toBe(width / 2);
    expect(visual?.pivot.y).toBe(height / 2);
    expect(visual?.position.y).toBe(height * .475);
    expect(visual?.rotation).toBe(.04);
    expect(card.getWorldBounds()).toEqual(before);
    expect(card.getCenter()).toEqual(center);
    expect(card.hitArea?.contains(1, 1)).toBe(true);
    expect(card.hitArea?.contains(width + 1, height)).toBe(false);
    expect(outline?.parent).toBe(card);
    expect(card.rotation).toBe(0);

    // A sharper image arriving mid-wobble must retain its own orientation.
    card.loadInitialTexture();
    const artwork = visual?.children.find((child): child is Sprite => child instanceof Sprite);
    expect(artwork?.rotation).toBe(isLandscape ? Math.PI / 2 : 0);
    card.setArrivalPose(null);
    expect(visual?.scale.x).toBe(1);
    expect(visual?.rotation).toBe(0);
    expect(visual?.position.y).toBe(height / 2);
    expect(card.getWorldBounds()).toEqual(before);
    card.destroy({ children: true });
    expect(() => card.setArrivalPose(null)).not.toThrow();
  });

  it('keeps missing artwork inside the arrival transform and replaces it when detail arrives', async () => {
    stubLODManager();
    vi.mocked(lodManager.getTextureMatchSync).mockReturnValue(null);
    vi.mocked(lodManager.getTexture).mockResolvedValue(Texture.WHITE);
    const card = new CardSprite({ name: 'Missing Site', isLandscape: true, x: 0, y: 0 });
    card.setArrivalPose({ scale: .9, rotation: -.03, offsetY: 0 });
    card.loadInitialTexture();
    await card.textureReady;
    const visual = card.getChildByLabel('arrival-artwork');
    const label = visual?.children.find((child): child is Text => child instanceof Text);
    expect(label?.text).toContain('Artwork unavailable');
    vi.mocked(lodManager.getTextureMatchSync).mockReturnValue({ lod: LOD_LEVELS.FULL, texture: Texture.EMPTY });
    card.emit('pointerover', {} as FederatedPointerEvent);
    expect(visual?.children).not.toContain(label);
    expect(visual?.rotation).toBe(-.03);
    card.destroy({ children: true });
  });
});
