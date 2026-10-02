import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { PixiStage } from './PixiStage';
import type { CanvasArea, DeckRegionBounds } from '@/canvas/canvasAreas';
import type { CanvasLabel } from '@/data/dataModels';
import { fitDeckBoardSections } from '@/canvas/deckBoardLayout';
import type { DeckRegionHit } from '@/canvas/deckRegionInteraction';
import { required } from '@/utils/required';

vi.mock('pixi.js', async importOriginal => {
  const actual = await importOriginal<typeof import('pixi.js')>();
  class Text extends actual.Container {
    text: string;
    constructor(options: {text: string}) { super(); this.text = options.text; }
    override get width() { return this.text.length * 7; }
  }
  return {...actual, Text};
});

interface Harness {
  canvasAreas: CanvasArea[]; canvasLabels: CanvasLabel[];
  zoneCardSprites: Map<string, {sprite: Container}>;
  regionDrag: {preview: CanvasArea | null} | null;
  startDeckRegionDrag(id: string, hit: DeckRegionHit, point: {x: number; y: number}): void;
  updateDeckRegionDrag(point: {x: number; y: number}): void;
  endDeckRegionDrag(cancel?: boolean): void;
  getDeckRegionRects(zone: CanvasArea): DeckRegionBounds;
  emitCanvasAreasChange: ReturnType<typeof vi.fn>;
  emitCanvasLabelsChange: ReturnType<typeof vi.fn>;
}
let stage: Harness;
let area: CanvasArea;
beforeEach(() => {
  area = {id: 'd', name: 'Preview', type: 'deck', pinned: true,
    bounds: {x: 0, y: 0, width: 1000, height: 1500}, cards: [
      ...Array.from({length: 4}, (_, i) => ({id: `p${i}`, cardName: 'Spell', x: 5, y: 122.5, board: 'mainboard' as const})),
      ...Array.from({length: 4}, (_, i) => ({id: `s${i}`, cardName: 'Site', x: 12.5, y: 610, board: 'mainboard' as const})),
    ]};
  fitDeckBoardSections(area, 211, name => name === 'Site');
  const sprites = new Map(area.cards.map(card => {
    const sprite = new Container(); sprite.position.set(card.x, card.y);
    return [`d:${card.id}`, {zoneId: 'd', sprite}];
  }));
  stage = Object.assign(Object.create(PixiStage.prototype) as Harness, {
    canvasAreas: [area], canvasLabels: [], zoneCardSprites: sprites,
    zoneContainer: new Container(), labelSprites: new Map(), deckLayoutProfile: 'desktop',
    zoneFrames: new Map([['d', {frame: new Graphics(), subzoneLabels: []}]]),
    app: {canvas: {style: {cursor: ''}, title: ''}}, camera: {zoom: 1, resumeDrag: vi.fn()},
    isLandscapeCard: (name: string) => name === 'Site',
    configureTextQuality: (text: Container) => text,
    drawZoneDeleteOverlay: vi.fn(), rebuildZoneVisuals: vi.fn(), playCardsEffect: vi.fn(),
    emitCanvasAreasChange: vi.fn(), emitCanvasLabelsChange: vi.fn(),
  });
});

describe('deck region preview and commit', () => {
  it('shows translated translucent cards without changing saved positions, and cancels completely', () => {
    const rects = stage.getDeckRegionRects(area), atlas = required(rects.atlas), spells = required(rects.spellbook);
    const before = structuredClone(area);
    stage.startDeckRegionDrag('d', {id: 'atlas'}, {x: atlas.x + 30, y: atlas.y + 18});
    stage.updateDeckRegionDrag({x: atlas.x + 30, y: spells.y + 18});
    expect(area).toEqual(before);
    expect(required(stage.zoneCardSprites.get('d:s0')).sprite.alpha).toBeLessThan(1);
    expect(stage.regionDrag?.preview?.cards).not.toEqual(area.cards);
    stage.endDeckRegionDrag(true);
    expect(area).toEqual(before);
    expect(required(stage.zoneCardSprites.get('d:s0')).sprite.alpha).toBe(1);
    expect(required(stage.zoneCardSprites.get('d:s0')).sprite.y).toBe(required(area.cards[4]).y);
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
  });

  it('commits the same preview while preserving card IDs, boards and relative stack positions', () => {
    const rects = stage.getDeckRegionRects(area), atlas = required(rects.atlas), spells = required(rects.spellbook);
    const ids = area.cards.map(card => card.id);
    stage.startDeckRegionDrag('d', {id: 'atlas'}, {x: atlas.x + 30, y: atlas.y + 18});
    stage.updateDeckRegionDrag({x: atlas.x + 30, y: spells.y + 18});
    const proposed = structuredClone(required(stage.regionDrag?.preview));
    stage.endDeckRegionDrag();
    expect(area.cards).toEqual(proposed.cards);
    expect(area.deckRegionBounds).toEqual(proposed.deckRegionBounds);
    expect(area.cards.map(card => card.id)).toEqual(ids);
    expect(new Set(area.cards.slice(4).map(card => card.y)).size).toBe(1);
    expect(area.layoutProfiles?.desktop).toBeDefined();
    expect(stage.emitCanvasAreasChange).toHaveBeenCalledOnce();
  });

  it('does not create a saved layout from a simple title tap', () => {
    const before = structuredClone(area);
    stage.startDeckRegionDrag('d', {id: 'mainboard'}, {x: 0, y: 0});
    stage.endDeckRegionDrag();
    expect(area).toEqual(before);
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
  });

  it('stops a border at the full stack footprint without moving any card', () => {
    const rect = required(stage.getDeckRegionRects(area).atlas);
    const before = structuredClone(area.cards);
    stage.startDeckRegionDrag('d', {id: 'atlas', edge: 'e'}, {x: rect.x + rect.width, y: rect.y + 70});
    stage.updateDeckRegionDrag({x: rect.x - 1000, y: rect.y + 70});
    stage.endDeckRegionDrag();
    expect(area.cards).toEqual(before);
    expect(required(area.deckRegionBounds?.atlas).width).toBeGreaterThanOrEqual(140 + 36);
  });
});
