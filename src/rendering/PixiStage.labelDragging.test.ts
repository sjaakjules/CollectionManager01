import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { PixiStage } from './PixiStage';
import { DRAWN_GRID, snapGridToPixels } from './Grid';
import type { CanvasArea } from '@/canvas/canvasAreas';
import type { CanvasLabel } from '@/data/dataModels';
import { getLabelHeadingLayout } from '@/canvas/labelRegions';
import { required } from '@/utils/required';

interface Harness {
  canvasLabels: CanvasLabel[];
  labelDragPreview: { group: boolean; name: { x: number; y: number }; delta: { x: number; y: number } } | null;
  startLabelDrag(id: string, point: { x: number; y: number }): void;
  updateLabelDrag(point: { x: number; y: number }): void;
  endLabelDrag(cancel?: boolean): void;
  setCanvasAreas(areas: CanvasArea[], labels?: CanvasLabel[]): void;
  setCanvasLabels(labels: CanvasLabel[]): void;
  emitCanvasAreasChange: ReturnType<typeof vi.fn>;
  emitCanvasLabelsChange: ReturnType<typeof vi.fn>;
}

describe('top-left label headings and snapped group ghosts', () => {
  let stage: Harness;
  let area: CanvasArea;
  let name: Graphics;
  let stats: Graphics;
  let source: Container;
  let previews: Container;
  let start: { x: number; y: number };
  beforeEach(() => {
    const center = snapGridToPixels(6, 6, false);
    area = { id: 'deck', type: 'deck', name: 'Deck', pinned: true, bounds: { x: 0, y: 0, width: 2000, height: 2000 }, cards: [
      { id: 'a', cardName: 'Spell', x: center.x - 50, y: center.y - 70, labelId: 'group', board: 'mainboard' },
      { id: 'b', cardName: 'Spell', x: center.x + 70, y: center.y - 70, labelId: 'group', board: 'mainboard' },
    ] };
    const labels: CanvasLabel[] = [{ id: 'group', text: 'Group', areaId: 'deck', board: 'mainboard', x: 0, y: 0 }];
    const { headings, bands } = getLabelHeadingLayout(labels, [area], () => false, () => ({ width: 50, height: 18 }));
    start = required(headings.get('group'));
    name = new Graphics().rect(0, 0, 50, 18).fill(0xffffff);
    name.position.set(start.x, start.y);
    stats = new Graphics().rect(0, 0, 180, 22).fill(0xffffff);
    const band = required(bands.get('group'));
    stats.position.set(band.x + 10, band.y + band.height - 28);
    source = Object.assign(new Container(), { createDragPreview: () => new Container() });
    source.position.set(required(area.cards[0]).x, required(area.cards[0]).y);
    source.alpha = 0.8;
    previews = new Container();
    stage = Object.assign(Object.create(PixiStage.prototype) as Harness, {
      canvasLabels: labels, canvasAreas: [area], labelDragCardStarts: new Map(), labelDragLabelStarts: new Map(),
      labelSprites: new Map([['group', { label: labels[0], text: name, statistics: stats, band, bounds: {} }]]),
      labelRegionGraphics: new Map(), zoneCardSprites: new Map([['deck:a', { sprite: source }]]),
      zoneDropPreviewContainer: previews, isLandscapeCard: () => false, camera: { zoom: 1 },
      getDeckBoardRects: () => ({ mainboard: area.bounds, collection: area.bounds, maybeboard: area.bounds }),
      getLabelTarget: () => null, getZoneAtPosition: () => area, drawLabelDeleteButton: vi.fn(), updateCardQuickAddTargets: vi.fn(),
      reconcileCanvasAreaBounds: vi.fn(), rebuildZoneVisuals: vi.fn(), rebuildLabelSprites: vi.fn(),
      cancelSelectionLayout: vi.fn(), cloneCanvasAreas: (areas: CanvasArea[]) => structuredClone(areas),
      applyCanvasLayoutProfile: vi.fn(), ensureDeckZoneVariants: vi.fn(), clearZoneDropPreview: vi.fn(), deactivateQuickTransfer: vi.fn(),
      emitCanvasAreasChange: vi.fn(), emitCanvasLabelsChange: vi.fn(),
    });
  });

  it('keeps the name top-left within a grid unit, leaving the stats and cards fixed without saving', () => {
    const before = structuredClone(area.cards);
    const labelsBefore = structuredClone(stage.canvasLabels);
    const statsStart = { x: stats.x, y: stats.y };
    stage.startLabelDrag('group', start);
    stage.updateLabelDrag({ x: start.x + 22, y: start.y + 4 });
    expect(stage.labelDragPreview?.group).toBe(false);
    expect(name.x).toBe(start.x);
    expect({ x: stats.x, y: stats.y }).toEqual(statsStart);
    expect(area.cards).toEqual(before);
    expect(previews.children).toHaveLength(0);
    stage.endLabelDrag();
    expect(stage.canvasLabels).toEqual(labelsBefore);
    expect(area.cards).toEqual(before);
    expect(stage.emitCanvasLabelsChange).not.toHaveBeenCalled();
  });

  it('previews shared grid translations, then commits exactly those positions', () => {
    const before = structuredClone(area.cards);
    const sourceStart = { x: source.x, y: source.y };
    stage.startLabelDrag('group', start);
    stage.updateLabelDrag({ x: start.x + DRAWN_GRID.width * 1.6, y: start.y + 10 });
    expect(stage.labelDragPreview?.group).toBe(true);
    expect(stage.labelDragPreview?.delta).toEqual({ x: DRAWN_GRID.width * 2, y: 0 });
    expect(area.cards).toEqual(before);
    expect(source.alpha).toBeCloseTo(0.8 * 0.24);
    expect(required(previews.children[0]).x).toBe(sourceStart.x + DRAWN_GRID.width * 2);
    expect(stats.x).toBe(start.x + DRAWN_GRID.width * 2);
    stage.endLabelDrag();
    expect(area.cards).toEqual(before.map(card => ({ ...card, x: card.x + DRAWN_GRID.width * 2, isNew: false })));
    expect(previews.children).toHaveLength(0);
    expect(source.alpha).toBe(0.8);
    expect(area.cards[0]?.y).toBe(before[0]?.y);
  });

  it('keeps a group gesture latched after crossing the threshold and cancels without publishing', () => {
    const before = structuredClone(area.cards);
    const labels = structuredClone(stage.canvasLabels);
    stage.startLabelDrag('group', start);
    stage.updateLabelDrag({ x: start.x + DRAWN_GRID.width + 2, y: start.y });
    stage.updateLabelDrag({ x: start.x + 12, y: start.y });
    expect(stage.labelDragPreview?.group).toBe(true);
    stage.endLabelDrag(true);
    expect(area.cards).toEqual(before);
    expect(stage.canvasLabels).toEqual(labels);
    expect(name.x).toBe(start.x);
    expect(source.alpha).toBe(0.8);
    expect(previews.children).toHaveLength(0);
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
    expect(stage.emitCanvasLabelsChange).not.toHaveBeenCalled();
  });

  it('does not save a clamped name drag that leaves its displayed position unchanged', () => {
    stage.startLabelDrag('group', start);
    stage.updateLabelDrag({ x: start.x - 20, y: start.y });
    expect(name.x).toBe(start.x);
    stage.endLabelDrag();
    expect(stage.emitCanvasLabelsChange).not.toHaveBeenCalled();
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
  });

  it('cancels stale previews before incoming saved areas replace the model', () => {
    stage.startLabelDrag('group', start);
    stage.updateLabelDrag({ x: start.x + 140, y: start.y });
    const incoming = structuredClone(area);
    required(incoming.cards[0]).x += 600;
    stage.setCanvasAreas([incoming], []);
    expect(previews.children).toHaveLength(0);
    expect(stage.labelDragPreview).toBeNull();
    stage.endLabelDrag();
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
    expect(stage.emitCanvasLabelsChange).not.toHaveBeenCalled();
  });

  it('clears ghosts even when the dragged label was removed before release', () => {
    stage.startLabelDrag('group', start);
    stage.updateLabelDrag({ x: start.x + 140, y: start.y });
    stage.canvasLabels = [];
    stage.endLabelDrag();
    expect(stage.labelDragPreview).toBeNull();
    expect(previews.children).toHaveLength(0);
    expect(source.alpha).toBe(0.8);
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
  });
});
