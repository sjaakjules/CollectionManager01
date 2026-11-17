import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PixiStage } from './PixiStage';
import { CARD_SIZE, SNAP_GRID, snapCardCenter, snapGridToPixels } from './Grid';
import type { CanvasLabel } from '@/data/dataModels';
import type { CanvasArea, CanvasCardInstance } from '@/canvas/canvasAreas';
import { openCanvasLabelEditor } from '@/ui/canvasLabelEditor';
import { required } from '@/utils/required';

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

function cardAtGrid(column: number, row: number, landscape = false) {
  const center = snapGridToPixels(column, row, landscape);
  const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
  return { x: center.x - size.width / 2, y: center.y - size.height / 2 };
}

const snappedMove = { x: 2 * SNAP_GRID.width, y: 2 * SNAP_GRID.height };
const rawMove = { x: snappedMove.x + SNAP_GRID.width / 8, y: snappedMove.y - SNAP_GRID.height / 4 };

beforeEach(() => {
  vi.mocked(openCanvasLabelEditor).mockReset();
  area = {
    id: 'deck', type: 'deck', name: 'Deck', pinned: true,
    bounds: { x: 0, y: 0, width: 1800, height: 1400 },
    cards: [
      { id: 'a', cardName: 'Spell A', ...cardAtGrid(1, 1), board: 'mainboard', labelId: 'child' },
      { id: 'b', cardName: 'Spell B', ...cardAtGrid(3, 1), board: 'mainboard', labelId: 'child' },
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
    const next: CanvasCardInstance = { id: 'new', cardName: 'New card', ...cardAtGrid(1, 1), board: 'mainboard' };
    stage.applyLabelDrop([next], area, area, { x: 0, y: 0 }, false);
    expect(next.labelId).toBe('child');
  });

  it('snaps a populated label by one card anchor while retaining all offsets', () => {
    const before = structuredClone(area.cards);
    stage.startLabelDrag('child', { x: 0, y: 0 });
    stage.updateLabelDrag(rawMove);
    stage.endLabelDrag();
    expect(area.cards.map(({ x, y }) => ({ x, y }))).toEqual(before.map(card => ({
      x: card.x + snappedMove.x, y: card.y + snappedMove.y,
    })));
    expect(stage.canvasLabels.find(label => label.id === 'child')).toMatchObject(snappedMove);
  });

  it('keeps mixed orientations, stacks and nested headings on the same grid translation', () => {
    area.cards.push({ ...required(area.cards[0]), id: 'copy' });
    area.cards.unshift({ id: 'site', cardName: 'Site', ...cardAtGrid(1, 1, true), board: 'mainboard', labelId: 'parent' });
    Object.assign(stage, { isLandscapeCard: (name: string) => name === 'Site' });
    const before = structuredClone(area.cards);
    const labelStart = { ...required(stage.canvasLabels.find(label => label.id === 'parent')) };
    stage.startLabelDrag('parent', { x: labelStart.x, y: labelStart.y });
    stage.updateLabelDrag({ x: labelStart.x + rawMove.x, y: labelStart.y + rawMove.y });
    stage.endLabelDrag();
    for (const [index, card] of area.cards.entries()) {
      const original = before[index];
      if (!original) throw new Error('Missing original card');
      const size = card.cardName === 'Site' ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
      const center = { x: card.x + size.width / 2, y: card.y + size.height / 2 };
      expect(snapCardCenter(center.x, center.y, card.cardName === 'Site')).toEqual(center);
      expect(card.x - original.x).toBe(snappedMove.x);
      expect(card.y - original.y).toBe(snappedMove.y);
    }
    expect(stage.canvasLabels.find(label => label.id === 'parent')).toMatchObject({
      x: labelStart.x + snappedMove.x, y: labelStart.y + snappedMove.y,
    });
    expect(stage.canvasLabels.find(label => label.id === 'child')).toMatchObject({ ...snappedMove, parentLabelId: labelStart.id });
  });

  it('leaves an empty label free and treats pointer jitter as a click', () => {
    area.cards = [];
    stage.startLabelDrag('child', { x: 0, y: 0 });
    stage.updateLabelDrag({ x: 113, y: 97 });
    stage.endLabelDrag();
    expect(stage.canvasLabels.find(label => label.id === 'child')).toMatchObject({ x: 113, y: 97 });
    stage.emitCanvasLabelsChange.mockClear();
    stage.startLabelDrag('child', { x: 113, y: 97 });
    stage.updateLabelDrag({ x: 114, y: 98 });
    stage.endLabelDrag();
    expect(stage.canvasLabels.find(label => label.id === 'child')).toMatchObject({ x: 113, y: 97 });
    expect(stage.emitCanvasLabelsChange).not.toHaveBeenCalled();
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
      return { close: vi.fn(), commit: vi.fn(), reposition: vi.fn() };
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
    const beforeLabels = structuredClone(stage.canvasLabels);
    stage.sortZoneCards(area.id);
    const child = stage.canvasLabels.find(label => label.id === 'child');
    const parent = stage.canvasLabels.find(label => label.id === 'parent');
    const left = Math.min(...area.cards.map(card => card.x));
    const top = Math.min(...area.cards.map(card => card.y));
    const dx = left - Math.min(...beforeCards.map(card => card.x));
    const dy = top - Math.min(...beforeCards.map(card => card.y));
    const previousChild = required(beforeLabels.find(label => label.id === 'child'));
    const previousParent = required(beforeLabels.find(label => label.id === 'parent'));
    expect(child).toMatchObject({ x: previousChild.x + dx, y: previousChild.y + dy });
    expect(parent).toMatchObject({ x: previousParent.x + dx, y: previousParent.y + dy });
    expect(child?.parentLabelId).toBe('parent');
    expect(stage.canvasLabels.find(label => label.id === 'empty')?.x).toBe(-8000);
    expect(area.cards.map(({ id, board, labelId }) => ({ id, board, labelId })))
      .toEqual(beforeCards.map(({ id, board, labelId }) => ({ id, board, labelId })));
    expect(stage.emitCanvasLabelsChange).toHaveBeenCalledOnce();
  });
});
