// @vitest-environment jsdom
import 'pixi.js/events';
import { CanvasTextMetrics, Container, EventBoundary, FederatedPointerEvent, Rectangle, Text, TextStyle } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasArea, CanvasAreaBounds } from '@/canvas/canvasAreas';
import type { DeckSectionSummary } from '@/canvas/deckSectionStatistics';
import type { CanvasStatisticTooltip } from '@/ui/canvasStatisticTooltip';
import { required } from '@/utils/required';
import { PixiStage } from './PixiStage';
import { DeckStatisticStrip } from './DeckStatisticStrip';

type StatisticTarget = { kind: 'statistic-control'; key: string; allowLongPress: false };

interface StatisticsStage {
  zoneContainer: Container;
  statisticTooltip?: CanvasStatisticTooltip;
  canvasAreas: CanvasArea[];
  emitCanvasAreasChange: () => void;
  getTouchTarget(position: { x: number; y: number }): StatisticTarget;
  handleTouchTap(target: StatisticTarget, world: { x: number; y: number }, screen: { x: number; y: number }, doubleTap: boolean): void;
  addDeckStatisticColumns(key: string, summary: DeckSectionSummary, bounds: CanvasAreaBounds, zIndex: number, labels: Container[]): void;
}

describe('deck statistic canvas interactions', () => {
  let stage: StatisticsStage;
  let boundary: EventBoundary;
  let labels: Container[];
  const summary: DeckSectionSummary = { count: 10, columns: [
    { id: 'minions', rows: [{ text: '4 Minions', tooltip: '4 Minions in the current deck.' }] },
    { id: 'sites', rows: [{ text: '6 Sites', tooltip: '6 Sites in the current deck.' }] },
  ] };

  beforeEach(() => {
    // jsdom has no 2D text measurement. Pixi still handles hit testing and event propagation.
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation((text, style) => {
      expect(style).toBeInstanceOf(TextStyle);
      const height = Number(style.fontSize);
      const width = text.length * height * 0.55;
      return new CanvasTextMetrics(text, style, width, height, [text], [width], height, width,
        { ascent: height, descent: 0, fontSize: height });
    });
    const zoneContainer = new Container({ eventMode: 'static', hitArea: new Rectangle(0, 0, 500, 500) });
    const area: CanvasArea = { id: 'deck', type: 'deck', name: 'Deck', pinned: true,
      bounds: { x: 0, y: 0, width: 500, height: 500 },
      cards: [{ id: 'minion', cardName: 'Minion', x: 20, y: 180, board: 'mainboard' }] };
    stage = Object.assign(Object.create(PixiStage.prototype) as StatisticsStage, {
      zoneContainer, canvasAreas: [area], app: { canvas: document.createElement('canvas') }, camera: { zoom: 1 },
      labelDragState: { isDragging: false }, zoneDragState: { isDragging: false }, zoneCardDragState: { isDragging: false },
      dragState: { isDragging: false }, selectionBox: { isActive: false }, emitCanvasAreasChange: vi.fn(),
    });
    boundary = new EventBoundary(zoneContainer);
    labels = [];
    stage.addDeckStatisticColumns('deck:main', summary, { x: 40, y: 70, width: 90, height: 50 }, 2, labels);
  });

  afterEach(() => {
    stage.statisticTooltip?.destroy();
    stage.zoneContainer.destroy({ children: true });
    vi.restoreAllMocks();
  });

  const descendants = (root: Container): Container[] => [root, ...root.children.flatMap(descendants)];
  const findText = (name: string) => required(labels.flatMap(descendants).find(label => label instanceof Text && label.text === name));
  const tooltip = () => document.querySelector<HTMLElement>('[role="tooltip"]:not([hidden])');

  function pointer(type: string, x: number, y: number, buttons = 0, pointerType = 'mouse', pointerId = 1) {
    // A renderer normally updates world transforms before the event boundary uses them.
    for (const label of labels.flatMap(descendants)) label.getGlobalTransform(label.worldTransform);
    const event = new FederatedPointerEvent(boundary);
    Object.assign(event, { type, pointerType, pointerId, button: 0, buttons, isPrimary: pointerId === 1 });
    event.global.set(x, y);
    event.client.set(x, y);
    event.nativeEvent = new MouseEvent(type, { clientX: x, clientY: y, buttons });
    boundary.mapEvent(event);
  }

  function cellPoint(name: string) {
    const bounds = findText(name).getBounds();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

  it('shows the hovered metric and leaves its region drag target available', () => {
    const { x, y } = cellPoint('4 Minions');
    const onRegionPointerDown = vi.fn();
    stage.zoneContainer.on('pointerdown', onRegionPointerDown);

    pointer('pointermove', x, y);
    expect(tooltip()?.textContent).toBe('4 Minions in the current deck.');
    pointer('pointermove', 450, 450);
    expect(tooltip()).toBeNull();

    pointer('pointerdown', x, y, 1);
    pointer('pointermove', x, y, 1);
    expect(onRegionPointerDown).toHaveBeenCalledOnce();
    expect(tooltip()).toBeNull();
  });

  it('changes the visible columns on page taps and updates tooltip targets without changing the deck', () => {
    const original = structuredClone(stage.canvasAreas);
    expect(findText('4 Minions').visible).toBe(true);
    expect(findText('6 Sites').visible).toBe(false);

    const next = cellPoint('›');
    pointer('pointermove', next.x, next.y);
    expect(tooltip()?.textContent).toBe('More statistics');
    pointer('pointerdown', next.x, next.y, 1);
    pointer('pointerup', next.x, next.y);
    expect(tooltip()).toBeNull();
    expect(findText('4 Minions').visible).toBe(false);

    const sites = cellPoint('6 Sites');
    pointer('pointermove', sites.x, sites.y);
    expect(tooltip()?.textContent).toBe('6 Sites in the current deck.');

    const previous = cellPoint('‹');
    pointer('pointerdown', previous.x, previous.y, 1);
    pointer('pointerup', previous.x, previous.y);
    expect(tooltip()).toBeNull();
    expect(findText('6 Sites').visible).toBe(false);
    expect(findText('4 Minions').visible).toBe(true);
    expect(stage.canvasAreas).toEqual(original);
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
  });

  it('lets touch starts on a statistic or pager reach the viewport', () => {
    const onViewportPointerDown = vi.fn();
    stage.zoneContainer.on('pointerdown', onViewportPointerDown);

    const minions = cellPoint('4 Minions');
    pointer('pointermove', minions.x, minions.y, 1, 'touch');
    pointer('pointerdown', minions.x, minions.y, 1, 'touch');
    const next = cellPoint('›');
    pointer('pointerdown', next.x, next.y, 1, 'touch', 2);

    expect(onViewportPointerDown).toHaveBeenCalledTimes(2);
    expect(tooltip()).toBeNull();
    expect(findText('4 Minions').visible).toBe(true);
  });

  it.each([false, true])('pages on touch without changing selection or placing labels (placement=%s)', placement => {
    const clearSelection = vi.fn(), addLabelAtPosition = vi.fn(), consumeLabelPlacementMode = vi.fn();
    Object.assign(stage, { labelPlacementMode: placement, clearSelection, addLabelAtPosition,
      consumeLabelPlacementMode, cancelSelectionBox: vi.fn(), updateHoveredFromWorldPos: vi.fn() });
    let target: StatisticTarget;
    let taps = 0;
    stage.zoneContainer.on('pointerdown', (event: FederatedPointerEvent) => {
      target = stage.getTouchTarget(event.global);
      expect(target).toMatchObject({ kind: 'statistic-control', allowLongPress: false });
    });
    // The canvas receives pointerup before the child's pointertap page action.
    stage.zoneContainer.on('pointerup', (event: FederatedPointerEvent) => {
      stage.handleTouchTap(target, event.global, event.global, taps++ > 0);
    });
    for (const glyph of ['›', '‹']) {
      const at = cellPoint(glyph);
      pointer('pointerdown', at.x, at.y, 1, 'touch');
      pointer('pointerup', at.x, at.y, 0, 'touch');
    }
    expect(taps).toBe(2);
    expect(findText('4 Minions').visible).toBe(true);
    expect(clearSelection).not.toHaveBeenCalled();
    expect(addLabelAtPosition).not.toHaveBeenCalled();
    expect(consumeLabelPlacementMode).not.toHaveBeenCalled();
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
  });

  it('contains pager targets inside the heading row and clears stale hover text when reflowing', () => {
    const strip = required(labels.find(label => label instanceof DeckStatisticStrip));
    expect(strip.pageControlAt({ x: 89, y: 49 })).toBe(1);
    expect(strip.pageControlAt({ x: 90, y: 49 })).toBeNull();
    expect(strip.pageControlAt({ x: 89, y: 50 })).toBeNull();
    const at = cellPoint('4 Minions');
    pointer('pointermove', at.x, at.y);
    expect(tooltip()).not.toBeNull();
    strip.layout(400);
    expect(tooltip()).toBeNull();
    expect(strip.pageControlAt({ x: 89, y: 49 })).toBeNull();
  });

  it('emphasizes every Main total and omits the mana legend for Atlas', () => {
    stage.addDeckStatisticColumns('deck:atlas', { count: 5, columns: [
      { id: 'counts', rows: [
        { text: '20 Spells', bold: true }, { text: '5 Sites', bold: true, warning: true }, { text: '2 Collection', bold: true },
      ] },
      { id: 'sites', group: 'composition', rows: [
        { text: 'Atlas cards' }, { text: '2 E / 1 A / 1 W / 1 F', tooltip: '2 Earth / 1 Air / 1 Water / 1 Fire', elementCounts: [
          { element: 'earth', count: 2 }, { element: 'air', count: 1 }, { element: 'water', count: 1 }, { element: 'fire', count: 1 },
        ] }, { text: '2 o / 1 e / 1 e / 1 u' },
      ] },
      { id: 'synergy', group: 'synergy', rows: [
        { text: 'Courts' }, { text: '2 / 5' }, { text: '40%' }, { text: '90% / 100%' },
      ] },
    ] }, { x: 0, y: 150, width: 900, height: 50 }, 2, labels);
    for (const value of ['20 Spells', '5 Sites', '2 Collection']) {
      expect((findText(value) as Text).style.fontWeight).toBe('600');
    }
    const strip = required(labels.at(-1));
    const legend = (value: string) => required(descendants(strip).find(child => child instanceof Text && child.text === value));
    expect(legend('Elements').visible).toBe(true);
    expect(legend('Rarity').visible).toBe(true);
    expect(legend('Mana').visible).toBe(false);
    expect(legend('Draw').visible).toBe(true);
    const number = findText('2').getBounds();
    pointer('pointermove', number.x + number.width + 1, number.y + number.height / 2);
    expect(tooltip()?.textContent).toBe('2 Earth / 1 Air / 1 Water / 1 Fire');
  });
});
