import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PixiStage } from './PixiStage';

type Point = { x: number; y: number };
const pending = { cardKey: 'card-key', startScreenPos: { x: 120, y: 130 }, startWorldPos: { x: 600, y: 650 }, shiftKey: false };
const target = { kind: 'card' as const, key: 'card:card-key', cardKey: 'card-key', cardName: 'Cloud Spirit', cardType: 'Minion' as const };
type PendingClick = typeof pending;
type CardTarget = typeof target;
interface Harness {
  handlePendingCardClick(pending: PendingClick, world: Point): void;
  handleTouchTap(target: CardTarget, world: Point, screen: Point, double: boolean): void;
}

describe('catalogue destination gestures', () => {
  let stage: Harness;
  const requestMenu = vi.fn(), directAdd = vi.fn(), select = vi.fn(), score = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    stage = Object.assign(Object.create(PixiStage.prototype) as Harness, {
      app: { canvas: { getBoundingClientRect: () => ({ left: 10, top: 20 }) } },
      onCatalogueCardMenuRequest: requestMenu, onAddToDeck: directAdd,
      lastClickTime: 0, lastClickedCard: null,
      getSpriteData: () => ({ layout: { name: 'Cloud Spirit' } }),
      setHoveredCard: vi.fn(), clearZoneSelection: vi.fn(), clearSelection: vi.fn(),
      selectMainCardForPointer: select, selectCard: select, emitSelectionChange: vi.fn(),
      cancelSelectionBox: vi.fn(), updateHoveredFromWorldPos: vi.fn(), handleTouchControlTap: () => false,
      handleCardCategoryDoubleClick: score,
    });
  });

  it('selects once, opens the menu on double-click, and never adds a card before choosing', () => {
    stage.handlePendingCardClick(pending, pending.startWorldPos);
    expect(select).toHaveBeenCalledOnce();
    expect(requestMenu).not.toHaveBeenCalled();
    stage.handlePendingCardClick(pending, pending.startWorldPos);
    expect(requestMenu).toHaveBeenCalledExactlyOnceWith({ cardName: 'Cloud Spirit', clientX: 130, clientY: 150 });
    expect(directAdd).not.toHaveBeenCalled();
    // A third click starts a new pair instead of immediately reopening the menu.
    stage.handlePendingCardClick(pending, pending.startWorldPos);
    expect(requestMenu).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('opens the same destination menu on a touch double-tap', () => {
    stage.handleTouchTap(target, pending.startWorldPos, { x: 80, y: 90 }, false);
    expect(requestMenu).not.toHaveBeenCalled();
    stage.handleTouchTap(target, pending.startWorldPos, { x: 80, y: 90 }, true);
    expect(requestMenu).toHaveBeenCalledExactlyOnceWith({ cardName: 'Cloud Spirit', clientX: 90, clientY: 110 });
    expect(directAdd).not.toHaveBeenCalled();
  });

  it.each(['mouse', 'touch'])('preserves explicit category scoring on %s', pointer => {
    Object.assign(stage, { selectedCardCategoryId: 'category', cardCategoryData: {} });
    if (pointer === 'mouse') {
      stage.handlePendingCardClick(pending, pending.startWorldPos);
      stage.handlePendingCardClick(pending, pending.startWorldPos);
    } else stage.handleTouchTap(target, pending.startWorldPos, pending.startScreenPos, true);
    expect(score).toHaveBeenCalledOnce();
    expect(requestMenu).not.toHaveBeenCalled();
    expect(directAdd).not.toHaveBeenCalled();
  });
});
