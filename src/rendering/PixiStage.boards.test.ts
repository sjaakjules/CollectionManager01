import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PixiStage } from './PixiStage';
import { createDeckZone, cardNameToOrientationMap, type CanvasArea, type CanvasCardInstance } from '@/canvas/canvasAreas';
import { DECK_COLLECTION_WIDTH, type DeckZoneBoard } from '@/canvas/deckBoardLayout';
import type { Card, Deck } from '@/data/dataModels';
import { CARD_SIZE } from './Grid';

interface BoardStage {
  canvasAreas: CanvasArea[];
  fitDeckSections(zone: CanvasArea): boolean;
  sortZoneCards(id: string): void;
  reconcileCanvasAreaBounds(id: string): void;
  endZoneCardDrag(point: {x:number;y:number}): void;
  computeCanvasAreaBoundsFromCards(zone: CanvasArea, cards: CanvasCardInstance[]): CanvasArea["bounds"];
  getDeckBoardRects(bounds: CanvasArea['bounds'], zone: CanvasArea): Record<DeckZoneBoard, CanvasArea['bounds']>;
  getDeckBoardForPosition(zone: CanvasArea, point: { x: number; y: number }): DeckZoneBoard | null;
  planZoneCardAdditions(zone: CanvasArea, names: string[], point: { x: number; y: number }): { additions: CanvasCardInstance[] };
  syncDeckVariantForBoardChange(zone: CanvasArea, id: string, board: DeckZoneBoard): void;
  requestZoneLayoutReset(id: string): void;
  resetDeckLayout(id: string): void;
}

let stage: BoardStage;
let zone: CanvasArea;

beforeEach(() => {
  const names = ['Main', 'Maybe', ...Array.from({ length: 12 }, (_, i) => `Collection ${String(i).padStart(2, '0')}`)];
  const cards: Card[] = names.map((name) => ({
    name, elements: '', subTypes: '', sets: [],
    guardian: { type: 'Magic', rarity: 'Ordinary', rulesText: '', cost: 0,
      attack: null, defence: null, life: null, thresholds: { air: 0, earth: 0, fire: 0, water: 0 } },
  }));
  const deck: Deck = {
    id: 'deck', name: 'Board test', createdAt: '', updatedAt: '',
    boards: { avatar: [], mainboard: [{ name: 'Main', quantity: 2 }],
      collection: names.slice(2).map((name) => ({ name, quantity: 1 })),
      maybeboard: [{ name: 'Maybe', quantity: 1 }] },
  };
  zone = createDeckZone(deck, cardNameToOrientationMap(cards), 0);
  stage = Object.assign(Object.create(PixiStage.prototype) as BoardStage, {
    cards, canvasAreas: [zone], rebuildZoneVisuals: vi.fn(), emitCanvasAreasChange: vi.fn(),
    fitLabelRegionBounds: vi.fn(() => false), getPopulatedLabelBounds: vi.fn(() => []),
    applyLabelDrop: vi.fn(), clearZoneCardDragFeedback: vi.fn(), getZoneAtPosition: vi.fn(() => zone),
  });
});

function first(board: DeckZoneBoard): CanvasCardInstance {
  const card = zone.cards.find((entry) => entry.board === board);
  if (!card) throw new Error(`Missing ${board} fixture`);
  return card;
}

function expectSectionsContainCards() {
  const rects = stage.getDeckBoardRects(zone.bounds, zone);
  for (const card of zone.cards) {
    const rect = rects[card.board as DeckZoneBoard];
    expect(card.x).toBeGreaterThanOrEqual(rect.x);
    expect(card.x + CARD_SIZE.PORTRAIT.width).toBeLessThanOrEqual(rect.x + rect.width);
    expect(card.y).toBeGreaterThanOrEqual(rect.y);
    expect(card.y + CARD_SIZE.PORTRAIT.height).toBeLessThanOrEqual(rect.y + rect.height);
  }
  expect(zone.bounds.y + zone.bounds.height).toBeGreaterThanOrEqual(rects.maybeboard.y + rects.maybeboard.height);
}

describe('deck Collection and Maybe sections', () => {
  it('requests confirmation without changing a layout, then resets positions while retaining cards and variants', () => {
    const request = vi.fn();
    Object.assign(stage, { onDeckLayoutResetRequest: request });
    first('mainboard').x += 1000;
    first('mainboard').y += 1000;
    zone.bounds.width = 3000;
    zone.bounds.height = 4000;
    const saved = structuredClone(zone);
    stage.requestZoneLayoutReset(zone.id);
    expect(request).toHaveBeenCalledWith(zone.id);
    expect(zone).toEqual(saved);
    stage.resetDeckLayout(zone.id);
    expect(zone.cards.map(({ id, cardName, board }) => ({ id, cardName, board })))
      .toEqual(saved.cards.map(({ id, cardName, board }) => ({ id, cardName, board })));
    expect(zone.deckVariants).toEqual(saved.deckVariants);
    expect(zone.bounds.width).toBeLessThan(saved.bounds.width);
    expect(zone.bounds.height).toBeLessThan(saved.bounds.height);
    expectSectionsContainCards();
    const reset = structuredClone(zone);
    stage.resetDeckLayout(zone.id);
    expect(zone).toEqual(reset);
  });
  it('fits moved boards without wrapping cards or changing their saved positions', () => {
    first('maybeboard').y = first('mainboard').y;
    zone.cards.filter((entry) => entry.board === 'collection').forEach((card, index) => {
      card.x += index * 110;
    });
    const savedCards = structuredClone(zone.cards);
    stage.fitDeckSections(zone);
    expect(zone.cards).toEqual(savedCards);
    expectSectionsContainCards();
    const stored = JSON.parse(JSON.stringify(zone)) as CanvasArea;
    expect(stage.fitDeckSections(stored)).toBe(false);
    expect(stored).toEqual(zone);
  });

  it('sorts all three boards independently and keeps ten Collection columns even if the deck frame is wider', () => {
    zone.bounds.width = 2500;
    stage.sortZoneCards(zone.id);
    const rects = stage.getDeckBoardRects(zone.bounds, zone);
    expect(rects.collection.width).toBeLessThanOrEqual(DECK_COLLECTION_WIDTH);
    const collection = zone.cards.filter((entry) => entry.board === 'collection');
    const top = Math.min(...collection.map((card) => card.y));
    expect(collection.filter((card) => card.y === top)).toHaveLength(10);
    expect(first('maybeboard').board).toBe('maybeboard');
    expect(first('maybeboard').y).toBeGreaterThan(rects.collection.y + rects.collection.height);
    expectSectionsContainCards();
  });

  it('routes drops into Maybe and excludes those cards from active main-deck variants', () => {
    const rect = stage.getDeckBoardRects(zone.bounds, zone).maybeboard;
    const point = { x: rect.x + 100, y: rect.y + 100 };
    expect(stage.getDeckBoardForPosition(zone, point)).toBe('maybeboard');
    const plan = stage.planZoneCardAdditions(zone, ['Main'], point);
    expect(plan.additions[0]?.board).toBe('maybeboard');
    const moved = first('mainboard');
    moved.board = 'maybeboard';
    stage.syncDeckVariantForBoardChange(zone, moved.id, 'maybeboard');
    expect(zone.deckVariants?.[0]?.activeCardIds).not.toContain(moved.id);
    moved.board = 'mainboard';
    stage.syncDeckVariantForBoardChange(zone, moved.id, 'mainboard');
    expect(zone.deckVariants?.[0]?.activeCardIds).toContain(moved.id);
  });

  it('does not drift Collection-only decks downward during repeated bounds updates and reloads', () => {
    zone.cards = zone.cards.filter((card) => card.board === 'collection');
    stage.reconcileCanvasAreaBounds(zone.id);
    const saved = structuredClone(zone);
    for (let i = 0; i < 3; i++) {
      stage.reconcileCanvasAreaBounds(zone.id);
      stage.fitDeckSections(zone);
    }
    expect(zone).toEqual(saved);
    expectSectionsContainCards();
  });
});

function required<T>(value:T | undefined):T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}

function armDrag(cards: CanvasCardInstance[]) {
  const anchor = required(cards[0]);
  const source = required(stage.canvasAreas.find((area) => area.cards.some((card) => card.id === anchor.id)));
  const entries = new Map(cards.map((card) => {
    const area = required(stage.canvasAreas.find((candidate) => candidate.cards.some((entry) => entry.id === card.id)));
    return [`${area.id}:${card.id}`, { zoneId: area.id, instanceId: card.id, x: card.x, y: card.y, spriteX: card.x, spriteY: card.y }];
  }));
  const point = { x: anchor.x + CARD_SIZE.PORTRAIT.width / 2, y: anchor.y + CARD_SIZE.PORTRAIT.height / 2 };
  Object.assign(stage, {
    zoneCardDragState: { isDragging: true, key: `${source.id}:${anchor.id}`, zoneId: source.id,
      instanceId: anchor.id, startCardPos: {x:anchor.x,y:anchor.y}, startWorldPos: point, cards:entries },
    zoneCardSprites: new Map([[`${source.id}:${anchor.id}`, {displaySize:CARD_SIZE.PORTRAIT,cardType:'Magic'}]]),
  });
  return point;
}

describe('free deck arrangements', () => {
  it('contracts every edge after an outlying card is brought back without moving other cards', () => {
    const original = structuredClone(zone);
    const moved = first('mainboard');
    moved.x += 4000;
    moved.y += 3000;
    stage.reconcileCanvasAreaBounds(zone.id);
    const expanded = {...zone.bounds};
    zone.cards = structuredClone(original.cards);
    stage.reconcileCanvasAreaBounds(zone.id);
    expect(zone.bounds.width).toBeLessThan(expanded.width);
    expect(zone.bounds.height).toBeLessThan(expanded.height);
    expect(zone.cards).toEqual(original.cards);
    expectSectionsContainCards();
  });

  it('moves a mixed-board selection using one translation, preserving boards and expanding across the catalogue', () => {
    const main = first('mainboard');
    const collection = first('collection');
    main.isNew = true;
    const before = {dx:collection.x-main.x,dy:collection.y-main.y};
    const point = armDrag([main,collection]);
    Object.assign(stage, {getZoneAtPosition: vi.fn(() => null)});
    stage.endZoneCardDrag({x:point.x+5000,y:point.y});
    const nextMain = required(zone.cards.find((card) => card.id === main.id));
    const nextCollection = required(zone.cards.find((card) => card.id === collection.id));
    expect(nextMain.board).toBe('mainboard');
    expect(nextCollection.board).toBe('collection');
    expect(nextMain.isNew).toBe(false);
    expect(nextCollection.x-nextMain.x).toBe(before.dx);
    expect(nextCollection.y-nextMain.y).toBe(before.dy);
    expect(nextMain.x).toBeGreaterThan(0);
    expect(zone.bounds.x+zone.bounds.width).toBeGreaterThan(nextMain.x+CARD_SIZE.PORTRAIT.width);
  });

  it('changes a single-board selection together when dropped into Collection', () => {
    const main = zone.cards.filter((card) => card.board === 'mainboard');
    armDrag(main);
    const rect = stage.getDeckBoardRects(zone.bounds,zone).collection;
    stage.endZoneCardDrag({x:rect.x+60,y:rect.y+60});
    expect(zone.cards.filter((card) => main.some((entry) => entry.id === card.id)).every((card) => card.board === 'collection')).toBe(true);
    expect(zone.deckVariants?.[0]?.activeCardIds).not.toContain(main[0]?.id);
  });

  it('transfers a mixed selection into another deck without collapsing its boards', () => {
    const target:CanvasArea = {...structuredClone(zone),id:'target',cards:[],deckVariants:[{id:'variant',name:'Main',activeCardIds:[]}],activeDeckVariantId:'variant'};
    stage.canvasAreas.push(target);
    Object.assign(stage,{getZoneAtPosition:vi.fn(() => target)});
    const cards = [first('mainboard'),first('collection')];
    const point = armDrag(cards);
    stage.endZoneCardDrag({x:point.x+2000,y:point.y});
    expect(target.cards.map((card) => card.board)).toEqual(['mainboard','collection']);
    expect(zone.cards.some((card) => cards.some((entry) => entry.id === card.id))).toBe(false);
    expect(target.deckVariants?.[0]?.activeCardIds).toContain(cards[0]?.id);
    expect(target.deckVariants?.[0]?.activeCardIds).not.toContain(cards[1]?.id);
  });

  it('preserves source areas when moving a selection from multiple areas on empty canvas', () => {
    const second:CanvasArea = {...structuredClone(zone),id:'second'};
    second.cards = second.cards.map((card) => ({...card,id:`second-${card.id}`,x:card.x+2000}));
    stage.canvasAreas.push(second);
    Object.assign(stage,{getZoneAtPosition:vi.fn(() => null)});
    const firstCard=first('mainboard');
    const secondCard=required(second.cards[0]);
    const before={first:firstCard.x,second:secondCard.x};
    const point=armDrag([firstCard,secondCard]);
    stage.endZoneCardDrag({x:point.x+550,y:point.y});
    expect(zone.cards.find((card) => card.id===firstCard.id)?.x).toBe(before.first+550);
    expect(second.cards.find((card) => card.id===secondCard.id)?.x).toBe(before.second+550);
  });

  it('uses exactly the same frame for preview and completed placement', () => {
    const point={x:zone.bounds.x+zone.bounds.width-5,y:first('mainboard').y+70};
    const {additions}=stage.planZoneCardAdditions(zone,['Main'],point);
    const preview=stage.computeCanvasAreaBoundsFromCards(zone,[...zone.cards,...additions]);
    zone.cards.push(...additions);
    stage.reconcileCanvasAreaBounds(zone.id);
    expect(zone.bounds).toEqual(preview);
  });
});
