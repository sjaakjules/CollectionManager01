import { afterEach, describe, expect, it, vi } from 'vitest';
import { PixiStage } from './PixiStage';
import type { Card } from '@/data/dataModels';
import type { CatalogueLayoutConfig } from '@/data/catalogueLayout';
import { lodManager } from './LODManager';

const cards: Card[] = ['Site', 'Magic'].map((type) => ({
  name: type, elements: '', subTypes: '', sets: [], guardian: {
    type, rarity: 'Ordinary', rulesText: '', cost: 1, attack: null,
    defence: null, life: null, thresholds: { air: 0, earth: 1, fire: 0, water: 0 },
  },
}));
interface Harness {
  cards: Card[];
  catalogueCards: Card[];
  pendingCardSet: { cards: Card[]; catalogueCards: Card[]; catalogueLayout: CatalogueLayoutConfig } | null;
  setCards(cards: Card[], options?: { catalogueCards?: Card[] }): void;
  isLandscapeCard(name: string): boolean;
  selectedZoneCardKeys: Set<string>;
  startTextureReveal(): Promise<void>;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('catalogue filtering isolation', () => {
  it('retains deck metadata and selection and skips deck rebuilding when a site is filtered out', () => {
    const rebuild = vi.fn();
    const stage = Object.assign(Object.create(PixiStage.prototype) as Harness, {
      isInitialized: true, cards, rebuildCardSprites: rebuild,
      selectedZoneCardKeys: new Set(['deck/site']),
    });
    stage.setCards(cards, { catalogueCards: cards.filter((card) => card.name === 'Magic') });
    expect(stage.catalogueCards.map((card) => card.name)).toEqual(['Magic']);
    expect(stage.isLandscapeCard('Site')).toBe(true);
    expect(stage.selectedZoneCardKeys.has('deck/site')).toBe(true);
    expect(rebuild).toHaveBeenCalledWith(false);
    stage.setCards(cards, { catalogueCards: [] });
    expect(stage.cards).toBe(cards);
    expect(stage.isLandscapeCard('Site')).toBe(true);
    stage.setCards([...cards]);
    expect(rebuild).toHaveBeenLastCalledWith(true);
  });

  it('keeps the full metadata source through initialization while retaining the filtered input', () => {
    const stage = Object.assign(Object.create(PixiStage.prototype) as Harness, { isInitialized: false });
    stage.setCards(cards, { catalogueCards: [] });
    expect(stage.pendingCardSet?.cards).toBe(cards);
    expect(stage.pendingCardSet?.catalogueCards).toEqual([]);
  });

  it.each([false, true])('finishes startup when a filter replaces its pending sprites (empty=%s)', async (empty) => {
    let releaseManifest: (value: Map<string, string>) => void = () => {};
    const pendingManifest = new Promise<Map<string, string>>(resolve => { releaseManifest = resolve; });
    vi.spyOn(lodManager, 'getAtlasAssignments').mockImplementationOnce(() => pendingManifest).mockResolvedValue(new Map());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
    const obsolete = { alpha: 0, loadInitialTexture: vi.fn(), textureReady: new Promise<void>(() => {}) };
    const current = { alpha: 0, loadInitialTexture: vi.fn(), textureReady: Promise.resolve() };
    const progress = vi.fn();
    const stage = Object.assign(Object.create(PixiStage.prototype) as Harness, {
      isInitialized: true, cards, cardSprites: new Map([['old', { sprite: obsolete, layout: { name: 'Site' } }]]),
      headerLabels: [], pendingRevealTimeouts: [], revealRunId: 0, performCulling: vi.fn(),
      onTextureProgress: progress, rebuildCardSprites: vi.fn(),
    });
    stage.rebuildCardSprites.mockImplementation(() => {
      stage.cardSprites = empty ? new Map() : new Map([['new', { sprite: current, layout: { name: 'Magic' } }]]);
    });
    const oldRun = stage.startTextureReveal();
    stage.setCards(cards, { catalogueCards: empty ? [] : cards.filter(card => card.name === 'Magic') });
    await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith(empty ? 0 : 1, empty ? 0 : 1));
    releaseManifest(new Map());
    await oldRun;
    expect(obsolete.loadInitialTexture).not.toHaveBeenCalled();
    if (!empty) {
      expect(current.loadInitialTexture).toHaveBeenCalledOnce();
      expect(current.alpha).toBe(0.5);
    }
  });
});
