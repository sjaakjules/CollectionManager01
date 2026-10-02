// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Text } from 'pixi.js';
import { PixiStage } from './PixiStage';
import type { CanvasArea, CanvasCardInstance } from '@/canvas/canvasAreas';
import type { CanvasLabel } from '@/data/dataModels';
import type { EffectBounds } from './MangaEffect';
import type { MangaEffectKind } from '@/data/interactionEffects';

interface Harness {
  initialize(host: HTMLElement): Promise<void>;
  canvasAreas: CanvasArea[];
  canvasLabels: CanvasLabel[];
  isInitialized: boolean;
  hasReceivedAreas: boolean;
  initialRevealCompleted: boolean;
  playMangaEffect(kind: MangaEffectKind, bounds?: EffectBounds): void;
  playCardsEffect(kind: MangaEffectKind, keys: Iterable<string>, follow?: boolean): void;
  update(): void;
  getMangaEffectLayer(): Container;
  updateZoneCardDragFeedback(position: { x: number; y: number }): void;
  dragFeedbackText: Text | null;
  zoneCardSprites: Map<string, { bounds: EffectBounds; zoneId?: string; instanceId?: string; cardType?: string; displaySize?: { width: number; height: number } }>;
  selectedZoneCardKeys: Set<string>;
  removeCanvasCardInstance(area: string, card: string): void;
  mangaEffects: Array<{ effect: { root: Container; update(elapsed: number, zoom: number, bounds?: EffectBounds): boolean }; follow?: string[] }>;
}
let stage: PixiStage;
let h: Harness;
let cameraRoot: Container;
const bounds = { left: 10, top: 20, right: 110, bottom: 160 };
function area(cards: CanvasCardInstance[] = []): CanvasArea {
  return { id: 'deck', name: 'Example', pinned: true, type: 'deck', bounds: { x: 0, y: 0, width: 1000, height: 1000 }, cards,
    deckVariants: [{ id: 'variant', name: 'Original', activeCardIds: cards.map(card => card.id) }] };
}
beforeEach(() => {
  vi.spyOn(PixiStage.prototype as unknown as Harness, 'initialize').mockResolvedValue();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  stage = new PixiStage({ container: document.createElement('div'), onAddToDeck: vi.fn(), onRemoveFromDeck: vi.fn() });
  cameraRoot = new Container();
  h = Object.assign(stage as unknown as Harness, {
    camera: { container: cameraRoot, zoom: 1 },
    isInitialized: true, initialRevealCompleted: true,
    rebuildZoneVisuals: vi.fn(), reconcileCanvasAreaBounds: vi.fn(),
    emitCanvasAreasChange: vi.fn(), clearZoneDropPreview: vi.fn(), deactivateQuickTransfer: vi.fn(),
    ensureDeckZoneVariants: vi.fn((entry: CanvasArea) => entry.deckVariants ?? []),
  });
});
afterEach(() => {
  h.isInitialized = false;
  h.zoneCardSprites.clear();
  stage.destroy(); cameraRoot.destroy({ children: true });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('canvas gesture integration', () => {
  it('does not replay saved decks on hydration or when state echoes back', () => {
    const play = vi.spyOn(h, 'playMangaEffect');
    const saved = area(); stage.setCanvasAreas([saved]); stage.setCanvasAreas([saved]);
    expect(play).not.toHaveBeenCalled();
  });
  it('plays a single arrival for a batch and ignores a transfer of existing IDs', () => {
    const play = vi.spyOn(h, 'playMangaEffect');
    stage.setCanvasAreas([area()]);
    h.zoneCardSprites.set('deck:a', { bounds });
    const added = area(['a','b','c'].map(id => ({ id, cardName: 'Spell', x: 20, y: 40, board: 'mainboard' })));
    stage.setCanvasAreas([added]);
    expect(play).toHaveBeenCalledExactlyOnceWith('arrive', bounds);
    play.mockClear();
    stage.setCanvasAreas([{ ...added, cards: added.cards.map(card => ({ ...card, board: 'collection' })) }]);
    expect(play).not.toHaveBeenCalled();
  });
  it('honors off and reduced motion at the canvas boundary', () => {
    stage.setInteractionEffects({ intensity: 'off', lettering: 'both' });
    h.playMangaEffect('attach', bounds);
    expect(cameraRoot.children).toHaveLength(0);
    stage.setInteractionEffects({ intensity: 'subtle', lettering: 'both' });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    h.playMangaEffect('attach', bounds);
    expect(cameraRoot.children).toHaveLength(0);
  });
  it('keeps drop guidance legible and on screen at overview zoom', () => {
    // Text rasterization is checked in the browser; jsdom has no font canvas.
    vi.spyOn(Text.prototype, 'width', 'get').mockImplementation(function (this: Text) { return 280 * this.scale.x; });
    vi.spyOn(Text.prototype, 'height', 'get').mockImplementation(function (this: Text) { return 32 * this.scale.y; });
    Object.assign(h, {
      camera: { container: cameraRoot, zoom: 0.05, getVisibleBounds: () => ({ left: 0, top: 0, right: 16000, bottom: 10000 }) },
      zoneCardDragState: { cards: new Map() },
      getLabelTarget: () => null, getZoneAtPosition: () => null,
    });
    h.updateZoneCardDragFeedback({ x: 15900, y: 10 });
    const label = h.dragFeedbackText;
    if (!label) throw new Error('Expected drop guidance');
    expect(label.scale.x * 0.05).toBeCloseTo(1);
    expect(label.y).toBeGreaterThanOrEqual(0);
    expect(label.x + label.width).toBeLessThan(16000);
    expect(label.text).toContain('Keep board');
  });
  it('follows all selected card bounds and stays above later selection and drop outlines', () => {
    const a = { left: 10, top: 20, right: 110, bottom: 160 };
    const b = { left: 10, top: 36, right: 110, bottom: 176 };
    h.zoneCardSprites.set('deck:a', { bounds: a });
    h.zoneCardSprites.set('deck:b', { bounds: b });
    h.playCardsEffect('pickup', ['deck:a', 'deck:b', 'deck:a'], true);
    const gesture = h.mangaEffects[0];
    if (!gesture) throw new Error('Expected a pickup effect');
    expect(gesture.follow).toEqual(['deck:a', 'deck:b']);
    expect(gesture.effect.root.position.y).toBe(98);
    const overlay = new Container();
    overlay.zIndex = 100000;
    cameraRoot.addChild(overlay);
    h.getMangaEffectLayer();
    cameraRoot.sortChildren();
    expect(cameraRoot.children.at(-1)?.label).toBe('manga-effects');
    const update = vi.spyOn(gesture.effect, 'update');
    a.left += 50; a.right += 50; b.left += 50; b.right += 50;
    h.isInitialized = false;
    h.update();
    expect(update).toHaveBeenCalledWith(expect.any(Number), 1, { left: 60, top: 20, right: 160, bottom: 176 });
  });
  it('caps transient graphics and clears them immediately when settings change', () => {
    const clock = vi.spyOn(performance, 'now');
    for (let i = 0; i < 20; i++) { clock.mockReturnValue(i * 200); h.playMangaEffect('arrive', bounds); }
    expect(h.mangaEffects).toHaveLength(8);
    expect(cameraRoot.children).toHaveLength(1);
    expect(cameraRoot.children[0]?.label).toBe('manga-effects');
    expect((cameraRoot.children[0] as Container).children).toHaveLength(8);
    stage.setInteractionEffects({ intensity: 'off', lettering: 'both' });
    expect(cameraRoot.children).toHaveLength(0);
  });
  it('undo restores the exact instance, position, board, label and variant without erasing later edits', () => {
    const original: CanvasCardInstance = { id: 'a', cardName: 'Spell', x: 555, y: 777, board: 'collection', labelId: 'label', isNew: false };
    h.canvasAreas = [area([original])];
    h.canvasLabels = [{ id: 'label', text: 'Keep', x: 500, y: 700, areaId: 'deck', board: 'collection' }];
    h.removeCanvasCardInstance('deck', 'a');
    expect(h.canvasAreas[0]?.cards).toHaveLength(0);
    h.playMangaEffect('delete', bounds);
    h.canvasAreas[0]?.cards.push({ id: 'later', cardName: 'Another', x: 800, y: 900, board: 'mainboard' });
    stage.runCanvasGesture('undo');
    expect(h.canvasAreas[0]?.cards).toEqual([original, expect.objectContaining({ id: 'later' })]);
    expect(h.canvasAreas[0]?.deckVariants?.[0]?.activeCardIds).toContain('a');
    expect(cameraRoot.children.some(child => child.label === 'manga:delete')).toBe(false);
  });
  it('undo does not resurrect a label that was deleted afterwards', () => {
    h.canvasAreas = [area([{ id: 'a', cardName: 'Spell', x: 10, y: 20, labelId: 'deleted' }])];
    h.removeCanvasCardInstance('deck', 'a');
    stage.runCanvasGesture('undo');
    expect(h.canvasAreas[0]?.cards[0]?.labelId).toBeUndefined();
  });
  it('clears removal history and transient effects when switching accounts', () => {
    h.canvasAreas = [area([{ id: 'a', cardName: 'Spell', x: 10, y: 20 }])];
    h.removeCanvasCardInstance('deck', 'a');
    h.playMangaEffect('restore', bounds);
    stage.resetSessionGestures();
    expect(stage.runCanvasGesture('undo')).toContain('no card removal');
    expect(cameraRoot.children).toHaveLength(0);
    expect(h.hasReceivedAreas).toBe(false);
  });
  it('aligns a mixed-board selection without changing membership, offsets or other cards', () => {
    const cards: CanvasCardInstance[] = [
      { id: 'a', cardName: 'Spell', x: 555, y: 777, board: 'mainboard', labelId: 'label' },
      { id: 'b', cardName: 'Site', x: 1200, y: 1050, board: 'collection' },
      { id: 'c', cardName: 'Spell', x: 880, y: 200, board: 'maybeboard' },
    ];
    h.canvasAreas = [area(cards)];
    h.canvasLabels = [{ id: 'label', text: 'Keep', x: 500, y: 700, areaId: 'deck', board: 'mainboard' }];
    h.zoneCardSprites.set('deck:a', { bounds, zoneId: 'deck', instanceId: 'a', cardType: 'Magic', displaySize: { width: 300, height: 420 } });
    h.selectedZoneCardKeys = new Set(['deck:a', 'deck:b']);
    stage.runCanvasGesture('tidy');
    const [a, b, c] = h.canvasAreas[0]?.cards ?? [];
    if (!a || !b) throw new Error('Expected both selected cards to remain');
    expect(a).toMatchObject({ board: 'mainboard', labelId: 'label' });
    expect(b).toMatchObject({ board: 'collection' });
    expect(b.x - a.x).toBe(645);
    expect(b.y - a.y).toBe(273);
    expect(c).toEqual(cards[2]);
  });
});
