import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FederatedPointerEvent } from 'pixi.js';
import { PixiStage } from './PixiStage';
import { CARD_SIZE, SNAP_GRID, snapCardCenter } from './Grid';
import { TOUCH_LONG_PRESS_MS, TouchGestureTracker } from './touchGestures';
import type { CanvasArea, CanvasCardInstance } from '@/canvas/canvasAreas';

type Point = { x: number; y: number };
interface SpriteData {
  key: string; zoneId: string; instanceId: string; cardName: string; cardType: string;
  sprite: Point & { zIndex: number; visible: boolean; setSelected: ReturnType<typeof vi.fn>; setSelectionOutline: ReturnType<typeof vi.fn>; getWorldBounds(): {left:number;top:number;right:number;bottom:number} };
  bounds: { left: number; top: number; right: number; bottom: number };
  displaySize: { width: number; height: number };
}
interface StageHarness {
  [key: string]: unknown;
  canvasAreas: CanvasArea[];
  zoneCardSprites: Map<string, SpriteData>;
  selectedZoneCardKeys: Set<string>;
  zoneCardDragState: { isDragging: boolean };
  camera: { pauseDrag: ReturnType<typeof vi.fn>; resumeDrag: ReturnType<typeof vi.fn> };
  startZoneCardDrag(card: SpriteData, pos: Point): void;
  updateZoneCardDrag(pos: Point): void;
  endZoneCardDrag(pos: Point): void;
  cancelDesktopInteraction(): void;
  onPointerDown(event: FederatedPointerEvent): void;
  onPointerMove(event: FederatedPointerEvent): void;
  onPointerUp(event: FederatedPointerEvent): void;
  selectZoneCardForPointer(key: string, additive: boolean, doubleClick?: boolean, dragging?: boolean): void;
  endSelectionBox(pos: Point): void;
  syncZoneSelectionVisuals(): void;
  handleTouchTap(target: {kind: 'zone-card'; key: string; zoneCardKey: string; zoneId: string; instanceId: string; cardName: string; cardType: 'Minion'}, world: Point, screen: Point, doubleTap: boolean): void;
}
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing fixture value');
  return value;
}
let stage: StageHarness;
let anchor: SpriteData;
let base: Point;
function event(x: number, y: number, button = 0, pointerType = 'mouse'): FederatedPointerEvent {
  const pointer: Partial<FederatedPointerEvent> = {
    preventDefault: vi.fn(), globalX: x, globalY: y, button, pointerType, pointerId: 1, shiftKey: false, altKey: false,
  };
  return pointer as FederatedPointerEvent;
}

beforeEach(() => {
  const center = snapCardCenter(500, 500, false);
  base = { x: center.x - CARD_SIZE.PORTRAIT.width / 2, y: center.y - CARD_SIZE.PORTRAIT.height / 2 };
  const cards: CanvasCardInstance[] = [
    { id: 'a', cardName: 'Spell', ...base, board: 'mainboard' },
    { id: 'b', cardName: 'Spell', ...base, board: 'mainboard' },
    { id: 'c', cardName: 'Spell', x: base.x + 660, y: base.y, board: 'mainboard' },
    { id: 'd', cardName: 'Spell', x: base.x + 1320, y: base.y, board: 'collection' },
  ];
  const sprites = new Map(cards.map((card, index): [string, SpriteData] => {
    const key = `zone:${card.id}`;
    const y = card.y + (index === 0 ? -36 : index === 1 ? 36 : 0);
    return [key, {
      key, zoneId: 'zone', instanceId: card.id, cardName: card.cardName, cardType: 'Minion',
      sprite: { x: card.x, y, zIndex: index, visible: true, setSelected: vi.fn(), setSelectionOutline: vi.fn(), getWorldBounds() { return { left: this.x, top: this.y, right: this.x + CARD_SIZE.PORTRAIT.width, bottom: this.y + CARD_SIZE.PORTRAIT.height }; } },
      bounds: { left: card.x, top: y, right: card.x + CARD_SIZE.PORTRAIT.width, bottom: y + CARD_SIZE.PORTRAIT.height },
      displaySize: CARD_SIZE.PORTRAIT,
    }];
  }));
  anchor = required(sprites.get('zone:b'));
  stage = Object.assign(Object.create(PixiStage.prototype) as StageHarness, {
    canvasAreas: [{ id: 'zone', name: 'Deck', type: 'deck', pinned: true, cards, bounds: { x: 0, y: 0, width: 2000, height: 2000 } }],
    zoneCardSprites: sprites, selectedZoneCardKeys: new Set(['zone:a', 'zone:b']), selectedZoneId: 'zone',
    selectedCards: new Set(), cardSprites: new Map(), deckSprites: new Map(), associationShelfSprites: new Map(),
    zoneContainer: { sortChildren: vi.fn() }, drawZoneDeleteOverlay: vi.fn(), rebuildZoneVisuals: vi.fn(),
    emitCanvasAreasChange: vi.fn(), emitSelectionChange: vi.fn(),
    isLandscapeCard: vi.fn(() => false), getDeckBoardForPosition: vi.fn(() => 'mainboard'),
    syncDeckVariantForBoardChange: vi.fn(), reconcileCanvasAreaBounds: vi.fn(),
    dragState: { isDragging: false }, zoneCardDragState: { isDragging: false }, labelDragState: { isDragging: false }, zoneDragState: { isDragging: false },
    selectionBox: { isActive: false, startWorldPos: null, graphics: null }, quickTransferState: { active: false },
    camera: { screenToWorld: (x: number, y: number) => ({ x, y }), pauseDrag: vi.fn(), resumeDrag: vi.fn() },
    isTouchPointer: vi.fn(() => false), shouldIgnorePostTouchMouseEvent: vi.fn(() => false),
    clearZoneDropPreview: vi.fn(), updateHoveredFromWorldPos: vi.fn(),
    getZoneVariantTabTargetAtPosition: vi.fn(() => null), getZoneSortTargetAtPosition: vi.fn(() => null),
    getDeckFilterChipTargetAtPosition: vi.fn(() => null), getZoneFilterTargetAtPosition: vi.fn(() => null),
    getZoneCloseTargetAtPosition: vi.fn(() => null), getZoneHeaderAtPosition: vi.fn(() => null),
    getZoneCardAtPosition: vi.fn(() => anchor), getLabelAtPosition: vi.fn(() => null),
    getCardAtPosition: vi.fn(() => null), getZoneAtPosition: vi.fn(() => null),
    lastClickTime: 0, lastZoneCardClickTime: 0,
  });
});

describe('board menu when holding a card', () => {
  const openMenu = vi.fn(() => true);
  const dismissMenu = vi.fn();
  const showTouchActionSheet = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    openMenu.mockClear();
    dismissMenu.mockClear();
    showTouchActionSheet.mockClear();
    required(stage.canvasAreas[0]).deckId = 'deck';
    const touchTarget = { kind: 'zone-card', key: 'zone-card:zone:b', zoneCardKey: 'zone:b', zoneId: 'zone',
      instanceId: 'b', cardName: 'Spell', cardType: 'Minion', dragOnMove: true };
    Object.assign(stage, {
      cardQuickAddDeck: { deckId: 'deck', canvasAreaId: 'zone', name: 'Deck' },
      onCardQuickAddHoldOpen: openMenu, onCardQuickAddHoldCancel: dismissMenu,
      touchGestures: new TouchGestureTracker(), getTouchTarget: () => touchTarget,
      isTouchPointer: (pointer: FederatedPointerEvent) => pointer.pointerType === 'touch',
      getClientPosition: (pointer: FederatedPointerEvent) => ({ x: pointer.globalX, y: pointer.globalY }),
      captureTouchPointer: vi.fn(), releaseTouchPointer: vi.fn(), closeTouchActionSheet: vi.fn(), showTouchActionSheet,
      setStacksDropVisual: vi.fn(),
    });
  });

  afterEach(() => vi.useRealTimers());

  it.each(['mouse', 'touch'])('opens on a steady %s press and leaves the menu and group intact on release', pointerType => {
    const press = event(500, 500, 0, pointerType);
    stage.onPointerDown(press);
    stage.onPointerMove(event(502, 501, 0, pointerType));
    vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS - 1);
    expect(openMenu).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(openMenu).toHaveBeenCalledExactlyOnceWith('zone:b');
    expect(stage.zoneCardDragState.isDragging).toBe(false);
    stage.onPointerUp(press);
    expect([...stage.selectedZoneCardKeys]).toEqual(['zone:a', 'zone:b']);
    expect(dismissMenu).not.toHaveBeenCalled();
    expect(showTouchActionSheet).not.toHaveBeenCalled();
    expect(stage.camera.resumeDrag).toHaveBeenCalled();
  });

  it.each(['mouse', 'touch'])('does not open the menu after a %s drag begins', pointerType => {
    stage.onPointerDown(event(500, 500, 0, pointerType));
    stage.onPointerMove(event(600, 600, 0, pointerType));
    vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS);
    expect(stage.zoneCardDragState.isDragging).toBe(true);
    expect(openMenu).not.toHaveBeenCalled();
  });

  it.each(['mouse', 'touch'])('closes an already open menu when the %s drag begins', pointerType => {
    stage.onPointerDown(event(500, 500, 0, pointerType));
    vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS);
    stage.onPointerMove(event(600, 600, 0, pointerType));
    expect(openMenu).toHaveBeenCalledExactlyOnceWith('zone:b');
    expect(dismissMenu).toHaveBeenCalledOnce();
    expect(stage.zoneCardDragState.isDragging).toBe(true);
  });

  it('does not open a held menu after the active deck leaves the canvas', () => {
    stage.onPointerDown(event(500, 500));
    required(stage.canvasAreas[0]).pinned = false;
    vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS);
    expect(openMenu).not.toHaveBeenCalled();
  });
});

describe('empty canvas label gestures', () => {
  function emptyCanvas() {
    const addLabelAtPosition = vi.fn();
    Object.assign(stage, {
      getZoneCardAtPosition: () => null,
      startSelectionBox: vi.fn(), endSelectionBox: vi.fn(),
      setStacksDropVisual: vi.fn(), addLabelAtPosition,
    });
    return addLabelAtPosition;
  }
  it('creates on the second empty click, including empty deck space above catalogue cards', () => {
    const create = emptyCanvas();
    Object.assign(stage, { getZoneAtPosition: () => stage.canvasAreas[0], getCardAtPosition: () => 'behind-deck' });
    stage.onPointerDown(event(200, 200)); stage.onPointerUp(event(200, 200));
    expect(create).not.toHaveBeenCalled();
    const second = event(200, 200);
    stage.onPointerDown(second);
    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledExactlyOnceWith({ x: 200, y: 200 });
  });
  it('does not confuse a marquee, pan, or far-away click with double-click creation', () => {
    const create = emptyCanvas();
    stage.onPointerDown(event(200, 200)); stage.onPointerUp(event(400, 400));
    stage.onPointerDown(event(400, 400)); stage.onPointerUp(event(400, 400));
    stage.onPointerDown(event(400, 400, 2)); stage.onPointerUp(event(420, 420, 2));
    stage.onPointerDown(event(400, 400)); stage.onPointerUp(event(400, 400));
    stage.onPointerDown(event(500, 500));
    expect(create).not.toHaveBeenCalled();
  });
  it('routes the selected label cross to label deletion before any overlapping card', () => {
    const remove = vi.fn();
    Object.assign(stage, { getLabelDeleteTarget: () => 'label', deleteLabel: remove });
    stage.onPointerDown(event(500, 500));
    expect(remove).toHaveBeenCalledExactlyOnceWith('label');
    expect(stage.pendingZoneCardClick).toBeNull();
  });
});

describe('deck canvas mouse interactions', () => {
  const touchTarget = () => ({kind: 'zone-card' as const, key: 'zone-card:zone:b', zoneCardKey: 'zone:b', zoneId: 'zone', instanceId: 'b', cardName: 'Spell', cardType: 'Minion' as const});
  it('uses the same stack, single card and double-tap selection on touch without toggling variants', () => {
    Object.assign(stage, {handleTouchControlTap: vi.fn(() => false)});
    stage.selectedZoneCardKeys.clear();
    stage.handleTouchTap(touchTarget(), {x: 500, y: 500}, {x: 500, y: 500}, false);
    expect([...stage.selectedZoneCardKeys]).toEqual(['zone:a', 'zone:b']);
    stage.handleTouchTap(touchTarget(), {x: 500, y: 500}, {x: 500, y: 500}, false);
    expect([...stage.selectedZoneCardKeys]).toEqual(['zone:b']);
    stage.handleTouchTap(touchTarget(), {x: 500, y: 500}, {x: 500, y: 500}, true);
    expect([...stage.selectedZoneCardKeys]).toEqual(['zone:a', 'zone:b']);
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
  });

  it('does not delete from an invisible touch control and makes the visible duplicate control respond once', () => {
    const duplicate = vi.fn(), remove = vi.fn();
    Object.assign(stage, {hoveredZoneCardKey: null, canDuplicateZoneCard: () => true,
      getDuplicateButtonBounds: () => ({left: 90, top: 0, right: 100, bottom: 10}),
      getDeleteButtonBounds: () => ({left: 0, top: 0, right: 10, bottom: 10}),
      duplicateCanvasCardInstance: duplicate, handleZoneCardDelete: remove});
    stage.handleTouchTap(touchTarget(), {x: 5, y: 5}, {x: 5, y: 5}, false);
    expect(remove).not.toHaveBeenCalled();
    Object.assign(stage, {hoveredZoneCardKey: 'zone:b'});
    stage.handleTouchTap(touchTarget(), {x: 95, y: 5}, {x: 95, y: 5}, false);
    expect(duplicate).toHaveBeenCalledExactlyOnceWith('zone', 'b');
  });
  it('selects a stack, drills into one card, and restores the stack on double click', () => {
    stage.selectedZoneCardKeys.clear();
    stage.selectZoneCardForPointer(anchor.key, false);
    expect([...stage.selectedZoneCardKeys]).toEqual(['zone:a', 'zone:b']);
    stage.selectZoneCardForPointer(anchor.key, false);
    expect([...stage.selectedZoneCardKeys]).toEqual(['zone:b']);
    stage.selectZoneCardForPointer(anchor.key, false, true);
    expect([...stage.selectedZoneCardKeys]).toEqual(['zone:a', 'zone:b']);
  });

  it('pauses camera motion on a card press and starts moving the selected stack after the click threshold', () => {
    stage.onPointerDown(event(500, 500));
    expect(stage.camera.pauseDrag).toHaveBeenCalled();
    stage.onPointerMove(event(600, 620));
    expect(stage.zoneCardDragState.isDragging).toBe(true);
    expect(stage.zoneCardSprites.get('zone:a')?.sprite.x).toBe(base.x + 100);
    expect(anchor.sprite.y).toBe(base.y + 36 + 120);
    stage.onPointerUp(event(600, 620));
    expect(stage.zoneCardDragState.isDragging).toBe(false);
    expect(stage.camera.resumeDrag).toHaveBeenCalled();
    const cards = required(stage.canvasAreas[0]).cards;
    expect(required(cards[0]).x).toBe(required(cards[1]).x);
    expect(required(cards[0]).y).toBe(required(cards[1]).y);
    expect(stage.emitCanvasAreasChange).toHaveBeenCalledOnce();
  });

  it('snaps from the base position and preserves offsets across a selected cluster', () => {
    stage.selectedZoneCardKeys.add('zone:c');
    stage.startZoneCardDrag(anchor, { x: 500, y: 500 });
    stage.updateZoneCardDrag({ x: 722, y: 627 });
    stage.endZoneCardDrag({ x: 722, y: 627 });
    const [a, b, c, d] = required(stage.canvasAreas[0]).cards;
    const snapped = snapCardCenter(base.x + CARD_SIZE.PORTRAIT.width / 2 + 222, base.y + CARD_SIZE.PORTRAIT.height / 2 + 127, false);
    expect(required(a).x).toBe(snapped.x - CARD_SIZE.PORTRAIT.width / 2);
    expect(required(a).y).toBe(snapped.y - CARD_SIZE.PORTRAIT.height / 2);
    expect({ x: required(a).x, y: required(a).y }).toEqual({ x: required(b).x, y: required(b).y });
    expect(required(c).x - required(a).x).toBe(660);
    expect(required(d).x).toBe(base.x + 1320);
    expect(stage.syncDeckVariantForBoardChange).not.toHaveBeenCalled();
    expect(stage.reconcileCanvasAreaBounds).toHaveBeenCalledWith('zone');
  });

  it('moves only a drilled-down card and leaves the rest of its stack in place', () => {
    stage.selectedZoneCardKeys = new Set(['zone:b']);
    stage.startZoneCardDrag(anchor, { x: 0, y: 0 });
    stage.endZoneCardDrag({ x: 300, y: 200 });
    const [a, b] = required(stage.canvasAreas[0]).cards;
    expect(required(a).x).toBe(base.x);
    expect(required(b).x).not.toBe(base.x);
  });

  it('discards temporary sprite movement on cancellation', () => {
    const before = structuredClone(stage.canvasAreas);
    stage.startZoneCardDrag(anchor, { x: 0, y: 0 });
    stage.updateZoneCardDrag({ x: 300, y: 200 });
    stage.cancelDesktopInteraction();
    expect(stage.canvasAreas).toEqual(before);
    expect(stage.zoneCardDragState.isDragging).toBe(false);
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
    expect(stage.rebuildZoneVisuals).toHaveBeenCalled();
    expect(stage.camera.resumeDrag).toHaveBeenCalled();
  });

  it.each([1, 2])('uses mouse button %i for panning without selecting or dragging cards', (button) => {
    stage.onPointerDown(event(500, 500, button));
    expect(stage.getZoneCardAtPosition).not.toHaveBeenCalled();
    expect(stage.camera.pauseDrag).not.toHaveBeenCalled();
    // Resuming here would reset pixi-viewport's pointer-down position.
    expect(stage.camera.resumeDrag).not.toHaveBeenCalled();
    stage.onPointerUp(event(650, 620, button));
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
  });

  it('uses Space and left-drag for panning on a mouse without extra buttons', () => {
    stage.spacePanHeld = true;
    stage.onPointerDown(event(500, 500));
    expect(stage.getZoneCardAtPosition).not.toHaveBeenCalled();
    stage.onPointerUp(event(650, 620));
    expect(stage.emitCanvasAreasChange).not.toHaveBeenCalled();
  });

  it('starts a selection rectangle on empty canvas with an ordinary left drag', () => {
    stage.getZoneCardAtPosition = vi.fn(() => null);
    stage.onPointerDown(event(10, 10));
    expect(stage.selectionBox).toMatchObject({ isActive: true, startWorldPos: { x: 10, y: 10 } });
    expect(stage.camera.pauseDrag).toHaveBeenCalled();
    stage.onPointerUp(event(20, 20));
    expect(stage.camera.resumeDrag).toHaveBeenCalled();
  });

  it('marquee-selects zone cards and extends the selection with Shift', () => {
    stage.selectionBox = { isActive: true, additive: true, startWorldPos: { x: base.x + 650, y: base.y - 1 }, graphics: null };
    stage.endSelectionBox({ x: base.x + 1000, y: base.y + 300 });
    expect([...stage.selectedZoneCardKeys]).toEqual(['zone:a', 'zone:b', 'zone:c']);
  });

  it('retains the selected stack when a Shift marquee ends on empty canvas', () => {
    stage.selectionBox = { isActive: true, additive: true, startWorldPos: { x: -1000, y: -1000 }, graphics: null };
    stage.endSelectionBox({ x: -500, y: -500 });
    expect([...stage.selectedZoneCardKeys]).toEqual(['zone:a', 'zone:b']);
  });
});

function addSecondArea() {
  const card:CanvasCardInstance={id:'second',cardName:'Spell',board:'mainboard',x:base.x+2200,y:base.y};
  const area:CanvasArea={id:'other',name:'Other',type:'deck',pinned:true,cards:[card],bounds:{x:base.x+2100,y:base.y-100,width:500,height:500}};
  stage.canvasAreas.push(area);
  const key='other:second';
  const data:SpriteData={key,zoneId:area.id,instanceId:card.id,cardName:card.cardName,cardType:'Minion',
    sprite:{x:card.x,y:card.y,zIndex:1,visible:true,setSelected:vi.fn(),setSelectionOutline:vi.fn(),getWorldBounds() { return { left: this.x, top: this.y, right: this.x + CARD_SIZE.PORTRAIT.width, bottom: this.y + CARD_SIZE.PORTRAIT.height }; }},
    bounds:{left:card.x,top:card.y,right:card.x+100,bottom:card.y+140},displaySize:CARD_SIZE.PORTRAIT};
  stage.zoneCardSprites.set(key,data);
  return data;
}

describe('selection spanning deck areas', () => {
  it('marquee selects all touched deck areas, ignoring catalogue sprites underneath', () => {
    const second=addSecondArea();
    const catalogueSelect=vi.fn();
    stage.cardSprites=new Map([['catalogue',{sprite:{visible:true,setSelected:catalogueSelect},bounds:second.bounds}]]);
    stage.selectionBox={isActive:true,additive:false,startWorldPos:{x:base.x-1,y:base.y-50},graphics:null};
    stage.endSelectionBox({x:base.x+2400,y:base.y+200});
    expect([...stage.selectedZoneCardKeys]).toEqual(['zone:a','zone:b','zone:c','zone:d','other:second']);
    expect(stage.selectedCards).toEqual(new Set());
    stage.syncZoneSelectionVisuals();
    expect(stage.selectedZoneCardKeys.has('other:second')).toBe(true);
    expect(stage.selectedZoneCardKeys.has('zone:a')).toBe(true);
  });

  it('Shift adds a card in another area and dragging keeps the complete selection', () => {
    const second=addSecondArea();
    stage.selectZoneCardForPointer(second.key,true);
    expect([...stage.selectedZoneCardKeys]).toEqual(['zone:a','zone:b','other:second']);
    stage.selectZoneCardForPointer(anchor.key,false,false,true);
    expect([...stage.selectedZoneCardKeys]).toEqual(['zone:a','zone:b','other:second']);
    const dx = SNAP_GRID.width * 2;
    const end = { x: 500 + dx, y: 500 };
    const expected = second.sprite.x + dx;
    stage.startZoneCardDrag(anchor,{x:500,y:500});
    stage.updateZoneCardDrag(end);
    expect(second.sprite.x).toBe(expected);
    stage.endZoneCardDrag(end);
    expect(stage.canvasAreas[1]?.cards[0]?.x).toBe(expected);
  });
});
