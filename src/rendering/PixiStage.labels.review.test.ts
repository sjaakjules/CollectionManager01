import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PixiStage } from './PixiStage';
import { CARD_SIZE, snapCardCenter } from './Grid';
import type { CanvasLabel } from '@/data/dataModels';
import type { CanvasArea, CanvasCardInstance } from '@/canvas/canvasAreas';
import { openCanvasLabelEditor } from '@/ui/canvasLabelEditor';

vi.mock('@/ui/canvasLabelEditor', () => ({ openCanvasLabelEditor: vi.fn() }));

interface Harness {
  canvasLabels: CanvasLabel[];
  canvasAreas: CanvasArea[];
  dragDetached: boolean;
  labelDragState: { isDragging: boolean };
  zoneCardDragState: { isDragging: boolean; cards: Map<string, unknown> };
  applyLabelDrop(cards: CanvasCardInstance[], source: CanvasArea, target: CanvasArea, point: { x: number; y: number }, mixed: boolean): void;
  deleteLabel(id: string): void;
  editLabel(id: string): void;
  startLabelDrag(id: string, point: { x: number; y: number }): void;
  updateLabelDrag(point: { x: number; y: number }): void;
  endLabelDrag(cancel?: boolean): void;
  cancelActiveTouchDrag(): void;
  resetZoneCardDrag(): void;
  sortZoneCards(id: string): void;
  getLabelTarget: ReturnType<typeof vi.fn>;
  reconcileCanvasAreaBounds: ReturnType<typeof vi.fn>;
  emitCanvasAreasChange: ReturnType<typeof vi.fn>;
  emitCanvasLabelsChange: ReturnType<typeof vi.fn>;
}

let stage: Harness;
let area: CanvasArea;
beforeEach(() => {
  vi.mocked(openCanvasLabelEditor).mockReset();
  area = {
    id: 'deck', type: 'deck', name: 'Deck', pinned: true,
    bounds: { x: 0, y: 0, width: 1800, height: 1400 },
    cards: [
      { id: 'a', cardName: 'Spell A', x: 5, y: 12.5, board: 'mainboard', labelId: 'child' },
      { id: 'b', cardName: 'Spell B', x: 115, y: 12.5, board: 'mainboard', labelId: 'child' },
    ],
  };
  stage = Object.assign(Object.create(PixiStage.prototype) as Harness, {
    cards: [], canvasAreas: [area], canvasLabels: [
      { id: 'parent', text: 'Engine', x: -40, y: -50, areaId: 'deck', board: 'mainboard' },
      { id: 'child', text: 'Draw', x: 0, y: 0, areaId: 'deck', board: 'mainboard', parentLabelId: 'parent' },
    ],
    labelSprites: new Map(), labelRegionGraphics: new Map(), zoneCardSprites: new Map(),
    labelDragCardStarts: new Map(), labelDragLabelStarts: new Map(),
    labelDragState: { isDragging: false }, zoneCardDragState: { isDragging: false, cards: new Map() },
    selectionBox: { isActive: false, startWorldPos: null, graphics: null },
    dragState: { isDragging: false }, zoneDragState: { isDragging: false },
    getLabelTarget: vi.fn(() => null), getZoneAtPosition: vi.fn(() => area),
    getDeckBoardRects: vi.fn(() => ({ mainboard: area.bounds, collection: area.bounds, maybeboard: area.bounds })),
    isLandscapeCard: vi.fn(() => false),
    rebuildLabelRegions: vi.fn(), rebuildLabelSprites: vi.fn(), rebuildZoneVisuals: vi.fn(),
    reconcileCanvasAreaBounds: vi.fn(), removeDeckVariantCardReferences: vi.fn(), syncDeckVariantForBoardChange: vi.fn(),
    emitCanvasLabelsChange: vi.fn(), emitCanvasAreasChange: vi.fn(),
    clearZoneDropPreview: vi.fn(), setStacksDropVisual: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('label interaction review regressions', () => {
  it('deletes only the label and reparents its cards without changing their IDs or positions', () => {
    const before = structuredClone(area.cards);
    stage.deleteLabel('child');
    expect(stage.canvasLabels.map((label) => label.id)).toEqual(['parent']);
    expect(area.cards).toEqual(before.map((card) => ({ ...card, labelId: 'parent' })));
    stage.deleteLabel('parent');
    expect(area.cards).toEqual(before.map((card) => ({ ...card, labelId: undefined })));
  });

  it('joins a label on its explicit board and does not infer membership from overlapping bounds', () => {
    const label: CanvasLabel = { id: 'maybe', text: 'Try later', x: 0, y: 0, areaId: 'deck', board: 'maybeboard' };
    stage.canvasLabels.push(label);
    stage.getLabelTarget.mockReturnValue(label);
    stage.applyLabelDrop(area.cards, area, area, { x: 0, y: 0 }, false);
    expect(area.cards.every((card) => card.board === 'maybeboard' && card.labelId === 'maybe')).toBe(true);
    stage.getLabelTarget.mockReturnValue(null);
    stage.applyLabelDrop(area.cards, area, area, { x: 500, y: 500 }, false);
    expect(area.cards.every((card) => card.labelId === 'maybe')).toBe(true);
  });

  it('does not nest two loose labels outside a deck or stack', () => {
    area.cards = [];
    const parent: CanvasLabel = { id: 'loose-parent', text: 'Parent', x: 100, y: 100 };
    const child: CanvasLabel = { id: 'loose-child', text: 'Child', x: 0, y: 0 };
    stage.canvasLabels = [parent, child];
    Object.assign(stage, { getZoneAtPosition: () => null });
    stage.getLabelTarget.mockReturnValue(parent);
    stage.startLabelDrag(child.id, { x: 0, y: 0 });
    stage.updateLabelDrag({ x: 100, y: 100 });
    stage.endLabelDrag();
    expect(child.areaId).toBeUndefined();
    expect(child.parentLabelId).toBeUndefined();
  });

  it('drops invalid old parent ownership when a loose label first receives deck cards', () => {
    const parent: CanvasLabel = { id: 'loose-parent', text: 'Parent', x: -100, y: -100 };
    const child: CanvasLabel = { id: 'loose-child', text: 'Child', x: 0, y: 0, parentLabelId: parent.id };
    stage.canvasLabels = [parent, child];
    stage.getLabelTarget.mockReturnValue(child);
    stage.applyLabelDrop(area.cards, area, area, { x: 0, y: 0 }, false);
    expect(child.areaId).toBe('deck');
    expect(child.parentLabelId).toBeUndefined();
    expect(parent.areaId).toBeUndefined();
  });

  it('clears shake detachment at the end of a gesture so the next catalogue card can join a label', () => {
    stage.dragDetached = true;
    stage.resetZoneCardDrag();
    const label = stage.canvasLabels.find((entry) => entry.id === 'child');
    stage.getLabelTarget.mockReturnValue(label);
    const next: CanvasCardInstance = { id: 'new', cardName: 'New card', x: 5, y: 12.5, board: 'mainboard' };
    stage.applyLabelDrop([next], area, area, { x: 0, y: 0 }, false);
    expect(next.labelId).toBe('child');
  });

  it('snaps a populated label group as one translation without distorting card and label offsets', () => {
    stage.startLabelDrag('child', { x: 0, y: 0 });
    stage.updateLabelDrag({ x: 113, y: 97 });
    stage.endLabelDrag();
    const [first, second] = area.cards;
    if (!first || !second) throw new Error('Missing card fixture');
    const center = { x: first.x + CARD_SIZE.PORTRAIT.width / 2, y: first.y + CARD_SIZE.PORTRAIT.height / 2 };
    expect(snapCardCenter(center.x, center.y, false)).toEqual(center);
    expect(second.x - first.x).toBe(110);
    expect(second.y - first.y).toBe(0);
    const label = stage.canvasLabels.find((entry) => entry.id === 'child');
    expect(first.x - (label?.x ?? 0)).toBe(5);
    expect(first.y - (label?.y ?? 0)).toBe(12.5);
  });

  it('restores a cancelled touch label drag and does not publish moved positions', () => {
    const original = structuredClone(area.cards);
    stage.startLabelDrag('child', { x: 0, y: 0 });
    stage.updateLabelDrag({ x: 200, y: 100 });
    stage.cancelActiveTouchDrag();
    expect(area.cards).toEqual(original);
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
    expect(stage.emitCanvasLabelsChange).not.toHaveBeenCalled();
  });

  it('reconciles populated label bounds when its text becomes longer', () => {
    vi.mocked(openCanvasLabelEditor).mockImplementation((options) => {
      options.onSave('A much longer label title for these cards');
      return vi.fn();
    });
    stage.editLabel('child');
    expect(stage.reconcileCanvasAreaBounds).toHaveBeenCalledWith('deck');
    expect(stage.emitCanvasLabelsChange).toHaveBeenCalled();
  });

  it('moves populated label titles with rearranged cards when resetting their layout', () => {
    for (const card of area.cards) { card.x += 4000; card.y += 3000; }
    for (const label of stage.canvasLabels) { label.x += 4000; label.y += 3000; }
    stage.canvasLabels.push({ id: 'empty', text: 'Loose', x: -8000, y: -8000, areaId: 'deck', board: 'mainboard' });
    const beforeCards = structuredClone(area.cards);
    stage.sortZoneCards(area.id);
    const child = stage.canvasLabels.find(label => label.id === 'child');
    const parent = stage.canvasLabels.find(label => label.id === 'parent');
    const left = Math.min(...area.cards.map(card => card.x));
    const top = Math.min(...area.cards.map(card => card.y));
    expect(child?.x).toBe(left - 5);
    expect(child?.y).toBe(top - 12.5);
    expect(parent?.x).toBe(left - 45);
    expect(parent?.y).toBe(top - 62.5);
    expect(child?.parentLabelId).toBe('parent');
    expect(stage.canvasLabels.find(label => label.id === 'empty')?.x).toBe(-8000);
    expect(area.cards.map(({ id, board, labelId }) => ({ id, board, labelId })))
      .toEqual(beforeCards.map(({ id, board, labelId }) => ({ id, board, labelId })));
    expect(stage.emitCanvasLabelsChange).toHaveBeenCalledOnce();
  });
});
