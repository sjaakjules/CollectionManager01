import { afterEach, describe, expect, it, vi } from "vitest";
import { Texture, type FederatedPointerEvent } from "pixi.js";
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

describe("CardSprite LOD display", () => {
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
