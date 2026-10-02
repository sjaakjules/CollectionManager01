import { describe, expect, it } from 'vitest';
import { getDeckAreaBounds, getDeckBoardRects, getMainDeckSectionRects, placeNewDeckCards, normalizeDeckBoard, DECK_COMPACT_BOARD_WIDTH, DECK_COLLECTION_WIDTH } from './deckBoardLayout';
import { createEmptyZone, ZONE_DECK_HEADER_HEIGHT, type CanvasCardInstance } from './canvasAreas';
import { CARD_SIZE } from '@/rendering/Grid';

function required<T>(value:T | undefined):T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}

const landscape = (name: string) => name.includes('Site');
const card = (id: string, board: CanvasCardInstance['board'], x: number, y: number, cardName = id): CanvasCardInstance => ({id, cardName, board, x, y});

describe('content-driven deck boards', () => {
  it('accepts legacy Collection membership without exposing the legacy board internally', () => {
    expect(normalizeDeckBoard('sideboard')).toBe('collection');
  });

  it.each(['mainboard', 'collection', 'maybeboard'] as const)('keeps a single %s card near the right edge compact', (board) => {
    const zone=createEmptyZone('deck','Compact region',0);
    zone.cards=[card('anchor','mainboard',0,0),card('shifted',board,1000,350)];
    if (board==='mainboard') zone.cards=[card('anchor','collection',0,350),card('shifted',board,1000,0)];
    const next=getDeckAreaBounds(zone,ZONE_DECK_HEADER_HEIGHT,landscape);
    const rects=getDeckBoardRects(next,zone.cards,ZONE_DECK_HEADER_HEIGHT,landscape);
    expect(rects[board].width).toBe(DECK_COMPACT_BOARD_WIDTH);
    expect(next.x+next.width).toBeLessThan(1300);
    expect(zone.cards[1]?.x).toBe(1000);
  });

  it('retains a ten-column empty Collection drop target without giving Main or Maybe that width', () => {
    const zone=createEmptyZone('deck','Empty targets',0);
    const rects=getDeckBoardRects(zone.bounds,[],ZONE_DECK_HEADER_HEIGHT,landscape);
    expect(rects.collection.width).toBe(DECK_COLLECTION_WIDTH);
    expect(rects.mainboard.width).toBe(DECK_COMPACT_BOARD_WIDTH);
    expect(rects.maybeboard.width).toBe(DECK_COMPACT_BOARD_WIDTH);
  });

  it('fits a Collection-only deck repeatedly without drifting or changing cards', () => {
    const zone = createEmptyZone('deck', 'Collection', 0);
    zone.cards = [card('A', 'collection', -100, -100)];
    zone.bounds = getDeckAreaBounds(zone, ZONE_DECK_HEADER_HEIGHT, landscape);
    const before = structuredClone(zone);
    for (let count=0; count<10; count++) zone.bounds=getDeckAreaBounds(zone, ZONE_DECK_HEADER_HEIGHT, landscape);
    expect(zone).toEqual(before);
    const rects=getDeckBoardRects(zone.bounds,zone.cards,ZONE_DECK_HEADER_HEIGHT,landscape);
    expect(rects.mainboard.y+rects.mainboard.height).toBeLessThan(rects.collection.y);
    expect(rects.collection.y+rects.collection.height).toBeLessThan(rects.maybeboard.y);
  });

  it('fills a free slot and stacks duplicate additions without moving existing cards', () => {
    const zone = createEmptyZone('deck', 'Addition', 0);
    zone.cards = [card('A', 'mainboard', 5, 97.5),card('B','mainboard',225,97.5),card('C','collection',5,400)];
    const before=structuredClone(zone.cards);
    const additions=[card('new','mainboard',0,0),card('duplicate','mainboard',0,0,'A')];
    placeNewDeckCards(zone,additions,landscape);
    expect(zone.cards).toEqual(before);
    expect(additions[0]?.x).toBe(115);
    expect(additions[0]?.y).toBe(97.5);
    expect(additions[1]?.x).toBe(5);
    expect(additions[1]?.y).toBe(97.5);
    expect(additions.every((entry) => entry.board==='mainboard')).toBe(true);
  });

  it('extends a full row to the right rather than pushing Collection or rearranging Main', () => {
    const zone=createEmptyZone('deck','Full row',0);
    zone.cards=Array.from({length:12},(_,index)=>card(`main-${index}`,'mainboard',5+index*110,97.5));
    zone.cards.push(card('collection','collection',5,320));
    const before=structuredClone(zone.cards);
    const additions=[card('fresh','mainboard',0,0)];
    placeNewDeckCards(zone,additions,landscape);
    expect(zone.cards).toEqual(before);
    expect(additions[0]?.x).toBe(5+12*110);
    expect(additions[0]?.y).toBe(97.5);
  });

  it('fills Main spell vacancies only within Spellbook rows when Atlas is far below', () => {
    const zone=createEmptyZone('deck','Separate Main sections',0);
    zone.cards=[card('spell','mainboard',5,122.5),card('site','mainboard',12.5,610,'Site A')];
    const before=structuredClone(zone.cards);
    const additions=[card('new-spell-1','mainboard',0,0),card('new-spell-2','mainboard',0,0)];
    placeNewDeckCards(zone,additions,landscape);
    expect(additions.map((entry) => entry.y)).toEqual([122.5,122.5]);
    expect(additions.map((entry) => entry.x)).toEqual([115,225]);
    expect(zone.cards).toEqual(before);
    const rects=getMainDeckSectionRects([...zone.cards,...additions],landscape);
    expect(required(rects.spellbook).y+required(rects.spellbook).height).toBeLessThan(required(rects.atlas).y);
  });

  it.each([true,false])('creates a separate Main section without shifting existing cards (adding Site: %s)', (addingSite) => {
    const zone=createEmptyZone('deck','First orientation',0);
    zone.cards=[card('existing','mainboard',5,400,addingSite?'Existing spell':'Site existing')];
    const before=structuredClone(zone.cards);
    const additions=[card('new','mainboard',0,0,addingSite?'Site new':'New spell')];
    placeNewDeckCards(zone,additions,landscape);
    const rects=getMainDeckSectionRects([...zone.cards,...additions],landscape);
    expect(required(rects.spellbook).y+required(rects.spellbook).height).toBeLessThan(required(rects.atlas).y);
    expect(zone.cards).toEqual(before);
  });

  it('keeps new Sites with Atlas and finds an empty landscape slot', () => {
    const zone=createEmptyZone('deck','Atlas',0);
    zone.cards=[card('spell','mainboard',5,97.5),card('site','mainboard',12.5,390,'Site A')];
    const additions=[card('site-new','mainboard',0,0,'Site B')];
    placeNewDeckCards(zone,additions,landscape);
    expect(additions[0]?.y).toBe(390);
    expect(additions[0]?.x).toBeGreaterThan(required(zone.cards[1]).x+CARD_SIZE.LANDSCAPE.width);
    const rects=getMainDeckSectionRects([...zone.cards,...additions],landscape);
    expect(rects.spellbook).toBeDefined();
    expect(rects.atlas).toBeDefined();
    expect(required(rects.spellbook).y+required(rects.spellbook).height).toBeLessThan(required(rects.atlas).y);
  });
});
