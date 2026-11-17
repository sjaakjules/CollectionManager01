// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Text } from 'pixi.js';
import { PixiStage } from './PixiStage';
import { CardSprite } from './CardSprite';
import { CARD_SIZE, DRAWN_GRID, getStackFan, snapCardToGrid } from './Grid';
import { cardBounds } from '@/canvas/labelRegions';
import type { CanvasArea, CanvasCardInstance } from '@/canvas/canvasAreas';
import type { DeckZoneBoard } from '@/canvas/deckBoardLayout';
import type { InteractionEffectsSettings } from '@/data/interactionEffects';
import type { EffectBounds } from './MangaEffect';

const created = vi.hoisted(() => vi.fn());
vi.mock('./ArrivalPop', () => ({
  ArrivalPop: class {
    readonly root = new Container();
    readonly refreshWords = vi.fn();
    readonly update = vi.fn(() => true);
    readonly destroy = vi.fn(() => this.root.destroy({ children: true }));
    constructor(bounds: EffectBounds, zoom: number, settings: InteractionEffectsSettings, full: boolean) {
      created(bounds, zoom, settings, full);
    }
  },
}));

interface ArrivalEntry {
  effect: { root: Container; refreshWords: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
  start: number;
  follow: string[];
  cardKey?: string;
}
interface ZoneCard {
  key: string; zoneId: string; instanceId: string; bounds: EffectBounds; sprite: CardSprite;
}
interface Harness {
  initialize(host: HTMLElement): Promise<void>;
  camera: { getVisibleBounds(): EffectBounds };
  canvasAreas: CanvasArea[];
  zoneCardSprites: Map<string, ZoneCard>;
  selectedZoneCardKeys: Set<string>;
  arrivalPops: ArrivalEntry[];
  arrivalStackHistory: Array<{ members: Set<string> }>;
  isInitialized: boolean;
  initialRevealCompleted: boolean;
  hasReceivedAreas: boolean;
  rebuildZoneVisuals(): void;
  duplicateCanvasCardInstance(zone: string, id: string): void;
  removeCanvasCardInstance(zone: string, id: string): void;
  playArrivalPop(zone: string, id: string): void;
  getZoneStackEffectKeys(zone: string, id: string): string[];
  startZoneCardDrag(card: ZoneCard, point: { x: number; y: number }): void;
  emitSelectionChange(): void;
  emitCanvasAreasChange: ReturnType<typeof vi.fn>;
  update(): void;
}
let stage: PixiStage;
let h: Harness;
let cameraRoot: Container;
let clock: ReturnType<typeof vi.spyOn>;
const visibleBounds = { left: -100000, top: -100000, right: 100000, bottom: 100000 };

function required<T>(value: T | undefined): T {
  if (!value) throw new Error('Missing fixture');
  return value;
}
function makeArea(name = 'Spell', count = 1, board: DeckZoneBoard = 'mainboard'): CanvasArea {
  const cards: CanvasCardInstance[] = Array.from({ length: count }, (_, index) => ({
    id: `card-${index}`, cardName: name, x: 500, y: 600, board,
  }));
  return { id: 'deck', name: 'Deck', pinned: true, type: 'deck', bounds: { x: 0, y: 0, width: 3000, height: 3000 }, cards,
    deckVariants: [{ id: 'variant', name: 'Original', activeCardIds: cards.map(card => card.id) }], activeDeckVariantId: 'variant' };
}
function arrange(name = 'Spell', count = 1, board: DeckZoneBoard = 'mainboard'): CanvasArea {
  const area = makeArea(name, count, board);
  h.canvasAreas = [area];
  h.rebuildZoneVisuals();
  return area;
}
function getArtwork(key: string): Container | undefined {
  return h.zoneCardSprites.get(key)?.sprite.children.find(child => child.label === 'arrival-artwork') as Container | undefined;
}

beforeEach(() => {
  created.mockClear();
  vi.spyOn(PixiStage.prototype as unknown as Harness, 'initialize').mockResolvedValue();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  stage = new PixiStage({ container: document.createElement('div'), onAddToDeck: vi.fn(), onRemoveFromDeck: vi.fn() });
  cameraRoot = new Container();
  // Exercise real CardSprite construction, stack geometry, duplication and
  // rebuilds, while keeping text rasterization and artwork loading offline.
  h = Object.assign(stage as unknown as Harness, {
    camera: { container: cameraRoot, zoom: 0.5, getVisibleBounds: () => visibleBounds },
    isLandscapeCard: (name: string) => name === 'Site',
    getCardType: (name: string) => name === 'Site' ? 'Site' : 'Magic',
    drawZoneFrame: vi.fn(() => ({ frame: new Graphics(), title: new Text({ text: '' }), subzoneLabels: [], avatarSprite: null })),
    updateCanvasAreaCardVisibility: vi.fn(), queueVisibleHighDetailPreload: vi.fn(),
    syncZoneSelectionVisuals: vi.fn(), applyActiveMetricHighlighting: vi.fn(),
    drawZoneDeleteOverlay: vi.fn(), rebuildLabelSprites: vi.fn(),
    emitCanvasAreasChange: vi.fn(), prepareZoneCardDragFeedback: vi.fn(),
  });
});

afterEach(() => {
  h.isInitialized = false;
  stage.destroy();
  cameraRoot.destroy({ children: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('card arrival stack integration', () => {
  it.each([
    { name: 'Site', count: 2, height: 118, rows: 2 },
    { name: 'Site', count: 3, height: 120, rows: 2 },
    { name: 'Site', count: 4, height: 120, rows: 2 },
    { name: 'Spell', count: 4, height: 180, rows: 3 },
  ])('fits $count copies of a $name within $rows snapped rows', ({ name, count, height, rows }) => {
    const landscape = name === 'Site';
    const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const area = makeArea(name, count);
    const position = snapCardToGrid(500, 600, landscape);
    for (const card of area.cards) Object.assign(card, position);
    h.canvasAreas = [area];
    h.rebuildZoneVisuals();

    const rendered = [...h.zoneCardSprites.values()].map(card => card.bounds);
    const middle = position.y + size.height / 2;
    const top = Math.min(...rendered.map(bounds => bounds.top));
    const bottom = Math.max(...rendered.map(bounds => bounds.bottom));
    expect(rendered).toHaveLength(count);
    expect(top).toBeGreaterThanOrEqual(middle - rows * DRAWN_GRID.height / 2);
    expect(bottom).toBeLessThanOrEqual(middle + rows * DRAWN_GRID.height / 2);
    expect(bottom - top).toBe(height);
    expect(required(cardBounds(area.cards, () => landscape).get('card-0'))).toMatchObject({ y: top, height });
  });

  it.each(['Spell', 'Site'])('animates the first %s added from the catalogue after hydration', name => {
    stage.setCanvasAreas([makeArea(name, 0)]);
    expect(created).not.toHaveBeenCalled();
    h.isInitialized = true;
    h.initialRevealCompleted = true;
    stage.setCanvasAreas([makeArea(name, 1)]);
    const size = name === 'Site' ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    expect(created).toHaveBeenCalledExactlyOnceWith({ left: 500, top: 600, right: 500 + size.width, bottom: 600 + size.height }, 0.5,
      { intensity: 'expressive', lettering: 'both' }, true);
    expect(getArtwork('deck:card-0')).toBeDefined();
    stage.setCanvasAreas([makeArea(name, 1)]);
    expect(created).toHaveBeenCalledOnce();
  });

  const stackCases = (['Spell', 'Site'] as const).flatMap(name =>
    (['mainboard', 'collection', 'maybeboard'] as const).flatMap(board =>
      [1, 2, 3, 4, 5].map(count => ({ name, board, count }))));
  it.each(stackCases)('uses current $name bounds for $count→next copies on $board', ({ name, board, count }) => {
    const area = arrange(name, count, board);
    const original = area.cards.map(card => ({ ...card }));
    h.duplicateCanvasCardInstance('deck', 'card-0');
    const landscape = name === 'Site';
    const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const { overhang } = getStackFan(count + 1, landscape);
    expect(created).toHaveBeenCalledExactlyOnceWith({
      left: 500, top: 600 - overhang,
      right: 500 + size.width, bottom: 600 + size.height + overhang,
    }, 0.5, { intensity: 'expressive', lettering: 'both' }, true);
    expect(area.cards.slice(0, count)).toEqual(original);
    expect(area.cards).toHaveLength(count + 1);
    expect(area.cards.at(-1)?.board).toBe(board);
    const entry = required(h.arrivalPops[0]);
    expect(entry.follow).toHaveLength(count + 1);
    expect(entry.cardKey).toBe(`deck:${required(area.cards.at(-1)).id}`);
    expect(getArtwork(entry.cardKey ?? '')).toBeDefined();
    for (const card of original) expect(getArtwork(`deck:${card.id}`)).toBeUndefined();
  });

  it('refreshes only the words across rapid presses and follows rebuilt, growing stacks', () => {
    const area = arrange();
    h.duplicateCanvasCardInstance('deck', 'card-0');
    const entry = required(h.arrivalPops[0]);
    const firstCard = required(h.zoneCardSprites.get(entry.cardKey ?? '')).sprite;
    clock.mockReturnValue(1150);
    h.duplicateCanvasCardInstance('deck', 'card-0');
    expect(firstCard.destroyed).toBe(true);
    expect(created).toHaveBeenCalledOnce();
    expect(entry.effect.refreshWords).toHaveBeenCalledExactlyOnceWith(150);
    expect(entry.start).toBe(1000);
    expect(entry.follow).toHaveLength(3);
    const { overhang } = getStackFan(3, false);
    expect(entry.effect.update).toHaveBeenLastCalledWith(150, 0.5, {
      left: 500, top: 600 - overhang, right: 500 + CARD_SIZE.PORTRAIT.width, bottom: 600 + CARD_SIZE.PORTRAIT.height + overhang,
    });
    expect(getArtwork(entry.cardKey ?? '')?.rotation).not.toBe(0);
    expect(getArtwork(`deck:${required(area.cards.at(-1)).id}`)).toBeUndefined();

    const membership = vi.spyOn(h, 'getZoneStackEffectKeys');
    clock.mockReturnValue(1220);
    h.update();
    expect(membership).not.toHaveBeenCalled();
    expect(h.arrivalPops).toHaveLength(1);
  });

  it('keeps later presses words-only after the first effect has completed', () => {
    arrange();
    h.duplicateCanvasCardInstance('deck', 'card-0');
    const first = required(h.arrivalPops[0]);
    first.effect.update.mockReturnValue(false);
    clock.mockReturnValue(5000);
    h.update();
    expect(h.arrivalPops).toHaveLength(0);
    expect(getArtwork(first.cardKey ?? '')?.rotation).toBe(0);
    expect(getArtwork(first.cardKey ?? '')?.scale.x).toBe(1);
    h.duplicateCanvasCardInstance('deck', 'card-0');
    expect(created.mock.calls.map(call => call[3])).toEqual([true, false]);
    expect(h.arrivalPops[0]?.cardKey).toBeUndefined();
  });

  it('retains repeat history when a stack moves and its original member is removed', () => {
    const area = arrange('Site');
    h.duplicateCanvasCardInstance('deck', 'card-0');
    const original = required(h.arrivalPops[0]);
    original.effect.update.mockReturnValue(false);
    h.update();
    const survivor = required(area.cards.at(-1)).id;
    h.removeCanvasCardInstance('deck', 'card-0');
    for (const card of area.cards) { card.x += 1200; card.y += 400; }
    h.rebuildZoneVisuals();
    h.duplicateCanvasCardInstance('deck', survivor);
    expect(created.mock.calls.map(call => call[3])).toEqual([true, false]);
    expect(created.mock.lastCall?.[0]).toMatchObject({ left: 1700, top: 1000 - getStackFan(2, true).overhang });
  });

  it('clears a duplicate’s new outline when another member of its pile is selected', () => {
    const area = arrange();
    h.duplicateCanvasCardInstance('deck', 'card-0');
    const copy = required(area.cards[1]);
    expect(copy.isNew).toBe(true);
    const sprite = required(h.zoneCardSprites.get(`deck:${copy.id}`)).sprite;
    const outline = vi.spyOn(sprite, 'setNewlyAdded');
    // The stack path is independent of the viewport test.
    h.camera.getVisibleBounds = () => ({ left: 0, top: 0, right: 300, bottom: 300 });
    h.selectedZoneCardKeys.add('deck:card-0');
    h.emitSelectionChange();
    expect(copy.isNew).toBe(false);
    expect(outline).toHaveBeenCalledExactlyOnceWith(false);
    expect(h.emitCanvasAreasChange).toHaveBeenCalledOnce();
  });

  it('acknowledges on-screen additions when selecting another pile and keeps offscreen ones new', () => {
    const area = makeArea();
    area.cards.push(
      { id: 'visible', cardName: 'Spell', x: 750, y: 600, board: 'mainboard', isNew: true },
      { id: 'offscreen', cardName: 'Spell', x: 1600, y: 600, board: 'mainboard', isNew: true },
    );
    h.camera.getVisibleBounds = () => ({ left: 0, top: 0, right: 1200, bottom: 900 });
    h.canvasAreas = [area];
    h.rebuildZoneVisuals();

    h.emitSelectionChange();
    expect(area.cards.slice(1).map(card => card.isNew)).toEqual([true, true]);
    h.selectedZoneCardKeys.add('deck:card-0');
    h.emitSelectionChange();
    expect(area.cards.slice(1).map(card => card.isNew)).toEqual([false, true]);
    h.emitSelectionChange();
    expect(h.emitCanvasAreasChange).toHaveBeenCalledOnce();
  });

  it('does not allocate empty repeated effects when lettering is disabled', () => {
    const area = arrange();
    stage.setInteractionEffects({ intensity: 'expressive', lettering: 'none' });
    h.duplicateCanvasCardInstance('deck', 'card-0');
    required(h.arrivalPops[0]).effect.update.mockReturnValue(false);
    h.update();
    h.duplicateCanvasCardInstance('deck', 'card-0');
    expect(area.cards).toHaveLength(3);
    expect(created).toHaveBeenCalledOnce();
    expect(h.arrivalPops).toHaveLength(0);
  });

  it('does not conflate cards on different deck boards at the same coordinates', () => {
    const area = arrange();
    area.cards.push({ id: 'maybe', cardName: 'Spell', x: 500, y: 600, board: 'maybeboard' });
    h.rebuildZoneVisuals();
    h.duplicateCanvasCardInstance('deck', 'card-0');
    h.duplicateCanvasCardInstance('deck', 'maybe');
    expect(created.mock.calls.map(call => call[3])).toEqual([true, true]);
    expect(h.arrivalPops.map(entry => entry.follow.length)).toEqual([2, 2]);
  });

  it('clears removed/hidden stacks and gives a replacement stack its first full pop', () => {
    const area = arrange();
    h.playArrivalPop('deck', 'card-0');
    const entry = required(h.arrivalPops[0]);
    h.removeCanvasCardInstance('deck', 'card-0');
    expect(h.arrivalPops).toHaveLength(0);
    expect(entry.effect.destroy).toHaveBeenCalledOnce();
    expect(h.arrivalStackHistory).toHaveLength(0);
    area.cards.push({ id: 'replacement', cardName: 'Spell', x: 500, y: 600, board: 'mainboard' });
    h.rebuildZoneVisuals();
    h.playArrivalPop('deck', 'replacement');
    expect(created.mock.calls.map(call => call[3])).toEqual([true, true]);
    area.pinned = false;
    h.rebuildZoneVisuals();
    expect(h.arrivalPops).toHaveLength(0);
  });

  it('resets arrival transforms before a card starts dragging', () => {
    arrange();
    h.duplicateCanvasCardInstance('deck', 'card-0');
    const entry = required(h.arrivalPops[0]);
    const card = required(h.zoneCardSprites.get(entry.cardKey ?? ''));
    clock.mockReturnValue(1140);
    h.update();
    expect(getArtwork(card.key)?.rotation).not.toBe(0);
    h.startZoneCardDrag(card, { x: 500, y: 600 });
    expect(h.arrivalPops).toHaveLength(0);
    expect(getArtwork(card.key)?.rotation).toBe(0);
    expect(getArtwork(card.key)?.scale.x).toBe(1);
    expect(entry.effect.destroy).toHaveBeenCalledOnce();
  });

  it('ends a stack arrival when a member is removed, without leaving a wobbling survivor', () => {
    arrange();
    h.duplicateCanvasCardInstance('deck', 'card-0');
    const entry = required(h.arrivalPops[0]);
    clock.mockReturnValue(1140);
    h.update();
    const artwork = required(getArtwork(entry.cardKey ?? ''));
    expect(artwork.rotation).not.toBe(0);
    h.removeCanvasCardInstance('deck', 'card-0');
    expect(entry.effect.destroy).toHaveBeenCalledOnce();
    expect(h.arrivalPops).toHaveLength(0);
    expect(getArtwork(entry.cardKey ?? '')).toBeUndefined();
  });

  it.each(['off', 'reduced'] as const)('preserves every addition with %s motion', mode => {
    const area = arrange();
    if (mode === 'off') stage.setInteractionEffects({ intensity: 'off', lettering: 'both' });
    else vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    h.duplicateCanvasCardInstance('deck', 'card-0');
    h.duplicateCanvasCardInstance('deck', 'card-0');
    expect(area.cards).toHaveLength(3);
    expect(created).not.toHaveBeenCalled();
  });

  it('clears transforms on settings changes, reduced motion changes, and account reset', () => {
    arrange();
    h.duplicateCanvasCardInstance('deck', 'card-0');
    let entry = required(h.arrivalPops[0]);
    stage.setInteractionEffects({ intensity: 'subtle', lettering: 'english' });
    expect(h.arrivalPops).toHaveLength(0);
    expect(getArtwork(entry.cardKey ?? '')?.scale.x).toBe(1);
    h.duplicateCanvasCardInstance('deck', 'card-0');
    entry = required(h.arrivalPops[0]);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    h.update();
    expect(entry.effect.destroy).toHaveBeenCalledOnce();
    expect(h.arrivalPops).toHaveLength(0);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    stage.resetSessionGestures();
    expect(h.arrivalStackHistory).toHaveLength(0);
    h.duplicateCanvasCardInstance('deck', 'card-0');
    expect(created.mock.lastCall?.[3]).toBe(true);
  });

  it('bounds concurrent effects and session history, and disposes everything on destroy', () => {
    const area = arrange();
    area.cards = Array.from({ length: 140 }, (_, index) => ({
      id: `stack-${index}`, cardName: 'Spell', x: 500 + index * 500, y: 600, board: 'mainboard',
    }));
    h.rebuildZoneVisuals();
    for (const card of area.cards) h.playArrivalPop('deck', card.id);
    expect(h.arrivalPops).toHaveLength(8);
    expect(h.arrivalStackHistory).toHaveLength(128);
    const entries = [...h.arrivalPops];
    stage.destroy();
    expect(h.arrivalPops).toHaveLength(0);
    expect(h.arrivalStackHistory).toHaveLength(0);
    for (const entry of entries) expect(entry.effect.destroy).toHaveBeenCalledOnce();
  });
});
