import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PixiStage } from './PixiStage';
import type { CanvasLabel } from '@/data/dataModels';
import type { CanvasArea, CanvasCardInstance } from '@/canvas/canvasAreas';

function required<T>(value: T | undefined | null): T { if (value == null) throw new Error('Missing fixture'); return value; }

type Point = { x: number; y: number };
interface Harness {
  canvasAreas: CanvasArea[];
  canvasLabels: CanvasLabel[];
  dragDetached: boolean;
  getLabelTarget: ReturnType<typeof vi.fn>;
  emitCanvasAreasChange: ReturnType<typeof vi.fn>;
  emitCanvasLabelsChange: ReturnType<typeof vi.fn>;
  removeCanvasCardInstance: ReturnType<typeof vi.fn>;
  applyLabelDrop(cards: CanvasCardInstance[], source: CanvasArea, target: CanvasArea, pos: Point, mixed: boolean): void;
  handleZoneCardDelete(card: { key: string; zoneId: string; instanceId: string; bounds: { left: number; top: number; right: number; bottom: number } }, x: number, y: number): void;
  startLabelDrag(id: string, pos: Point): void;
  updateLabelDrag(pos: Point): void;
  endLabelDrag(cancel?: boolean): void;
  deleteLabel(id: string): void;
  fitLabelRegionBounds(zone: CanvasArea): boolean;
}
let stage: Harness;
let area: CanvasArea;
beforeEach(() => {
  area = { id: 'deck', name: 'Deck', type: 'deck', pinned: true, bounds: { x: 0, y: 0, width: 3000, height: 3000 }, cards: [
    { id: 'a', cardName: 'Spell', x: 500, y: 600, board: 'mainboard', labelId: 'label', isNew: true },
    { id: 'b', cardName: 'Spell', x: 800, y: 600, board: 'mainboard' },
  ] };
  stage = Object.assign(Object.create(PixiStage.prototype) as Harness, {
    canvasAreas: [area], canvasLabels: [{ id: 'label', text: 'Draw', x: 480, y: 550, areaId: 'deck', board: 'mainboard' }],
    labelSprites: new Map(), labelRegionGraphics: new Map(), zoneCardSprites: new Map(),
    labelDragState: { isDragging: false }, labelDragCardStarts: new Map(), labelDragLabelStarts: new Map(),
    getLabelTarget: vi.fn(() => null), getZoneAtPosition: vi.fn(() => area), getDeckBoardForPosition: vi.fn(() => 'mainboard'),
    isLandscapeCard: vi.fn(() => false), rebuildZoneVisuals: vi.fn(), rebuildLabelSprites: vi.fn(), rebuildLabelRegions: vi.fn(),
    emitCanvasAreasChange: vi.fn(), emitCanvasLabelsChange: vi.fn(), reconcileCanvasAreaBounds: vi.fn(),
    removeDeckVariantCardReferences: vi.fn(), syncDeckVariantForBoardChange: vi.fn(), removeCanvasCardInstance: vi.fn(),
    drawZoneDeleteOverlay: vi.fn(), showDeletionPuff: vi.fn(),
  });
});

describe('deck label interactions', () => {
  it('moves only member cards with the label and cancels without persisting', () => {
    stage.startLabelDrag('label', { x: 480, y: 550 });
    stage.updateLabelDrag({ x: 680, y: 650 });
    expect(area.cards[0]).toMatchObject({ x: 700, y: 700 });
    expect(area.cards[1]).toMatchObject({ x: 800, y: 600 });
    stage.endLabelDrag(true);
    expect(area.cards[0]).toMatchObject({ x: 500, y: 600 });
    expect(stage.canvasLabels[0]).toMatchObject({ x: 480, y: 550 });
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
  });
  it('retains label membership until shaken or moved to another board', () => {
    const card = required(area.cards[0]);
    stage.applyLabelDrop([card], area, area, { x: 100, y: 100 }, false);
    expect(card.labelId).toBe('label');
    stage.dragDetached = true;
    stage.applyLabelDrop([card], area, area, { x: 100, y: 100 }, false);
    expect(card.labelId).toBeUndefined();
    card.labelId = 'label';
    card.board = 'collection';
    stage.dragDetached = false;
    stage.applyLabelDrop([card], area, area, { x: 100, y: 100 }, false);
    expect(card.labelId).toBeUndefined();
  });
  it('joins a label only when explicitly dropped on its title', () => {
    stage.getLabelTarget.mockReturnValue(stage.canvasLabels[0]);
    stage.applyLabelDrop([required(area.cards[1])], area, area, { x: 480, y: 550 }, false);
    expect(required(area.cards[1]).labelId).toBe('label');
  });
  it('deleting a label keeps cards and releases direct members', () => {
    stage.deleteLabel('label');
    expect(stage.canvasLabels).toEqual([]);
    expect(area.cards).toHaveLength(2);
    expect(required(area.cards[0]).labelId).toBeUndefined();
  });
  it('does not expand a deck for an empty label', () => {
    required(area.cards[0]).labelId = undefined;
    required(stage.canvasLabels[0]).x = -10000;
    const before = { ...area.bounds };
    expect(stage.fitLabelRegionBounds(area)).toBe(false);
    expect(area.bounds).toEqual(before);
  });
});

describe('single-click card deletion', () => {
  it('removes the exact card on the first click and saves immediately', () => {
    const card = { key: 'deck:a', zoneId: 'deck', instanceId: 'a', bounds: { left: 0, top: 0, right: 100, bottom: 150 } };
    stage.handleZoneCardDelete(card, 0, 0);
    expect(stage.removeCanvasCardInstance).toHaveBeenCalledExactlyOnceWith('deck', 'a');
    expect(stage.emitCanvasAreasChange).toHaveBeenCalledOnce();
  });
  it('removes each independently clicked card without an arming state', () => {
    const card = { key: 'deck:a', zoneId: 'deck', instanceId: 'a', bounds: { left: 0, top: 0, right: 100, bottom: 150 } };
    stage.handleZoneCardDelete(card, 0, 0);
    stage.handleZoneCardDelete({ ...card, key: 'deck:b', instanceId: 'b' }, 0, 0);
    expect(stage.removeCanvasCardInstance.mock.calls).toEqual([['deck', 'a'], ['deck', 'b']]);
    expect(stage.emitCanvasAreasChange).toHaveBeenCalledTimes(2);
  });
});
