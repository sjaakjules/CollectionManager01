import { describe, expect, it } from 'vitest';
import { getDeckAreaBounds, getDeckBoardRects, getMainDeckSectionLayout, getMainDeckSectionRects, fitDeckBoardSections, placeNewDeckCards, normalizeDeckBoard, DECK_COMPACT_BOARD_WIDTH, DECK_COLLECTION_WIDTH, DECK_REGION_TITLE_HEIGHT, DECK_SECTION_HEADER_HEIGHT, DECK_SECTION_MIN_WIDTH, DECK_BOARD_INNER_PADDING, DECK_BOARD_BOTTOM_PADDING, DECK_BOARD_GAP, DECK_BOARD_PADDING } from './deckBoardLayout';
import { createEmptyZone, ZONE_DECK_HEADER_HEIGHT, type CanvasCardInstance, type DeckRegionBounds } from './canvasAreas';
import { CARD_CELL_SPACING, CARD_SIZE, DRAWN_GRID, getStackFan, snapCardToGrid } from '@/rendering/Grid';
import type { CanvasLabel } from '@/data/dataModels';
import { getLabelHeadingLayout, getLabelRegionBounds } from './labelRegions';

function required<T>(value:T | undefined):T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}

const landscape = (name: string) => name.includes('Site');
const card = (id: string, board: CanvasCardInstance['board'], x: number, y: number, cardName = id): CanvasCardInstance => ({id, cardName, board, x, y});
const spellPitchX = CARD_CELL_SPACING.PORTRAIT.x * DRAWN_GRID.width;

describe('content-driven deck boards', () => {
  it('keeps custom headings inside Spellbook/Atlas and below their parent titles', () => {
    const zone = createEmptyZone('deck', 'Label headings', 0);
    zone.cards = [card('spell', 'mainboard', 200, 300), card('site', 'mainboard', 200, 800, 'Site')];
    const labels = {
      spellbook: [{ x: 180, y: 250, width: 170, height: 210 }],
      atlas: [{ x: 180, y: 750, width: 210, height: 190 }],
    };
    const before = structuredClone(zone.cards);
    const sections = getMainDeckSectionRects(zone.cards, landscape, {}, labels);
    const main = getDeckBoardRects(zone.bounds, zone.cards, ZONE_DECK_HEADER_HEIGHT, landscape, {}, labels).mainboard;
    for (const key of ['spellbook', 'atlas'] as const) {
      const section = required(sections[key]);
      const label = required(labels[key][0]);
      expect(label.y - section.y).toBeGreaterThan(DECK_REGION_TITLE_HEIGHT);
      expect(label.x).toBeGreaterThan(section.x);
      expect(label.x + label.width).toBeLessThan(section.x + section.width);
      expect(section.y - main.y).toBeGreaterThan(DECK_REGION_TITLE_HEIGHT);
      expect(section.x + section.width).toBeLessThan(main.x + main.width);
    }
    expect(zone.cards).toEqual(before);
    // Removing a label allows derived frames to contract again.
    expect(required(getMainDeckSectionRects(zone.cards, landscape).spellbook).y)
      .toBeGreaterThan(required(sections.spellbook).y);
  });

  it.each([1, 2, 3, 4, 5, 6])('reserves readable nested titles around stacks of %s portrait and landscape cards', count => {
    const zone = createEmptyZone('deck', 'Nested titles', 0);
    zone.cards = [false, true].flatMap(site => Array.from({length: count}, (_, i) =>
      card(`${site}-${i}`, 'mainboard', 5, site ? 190 : 0, site ? 'Site' : 'Spell')));
    fitDeckBoardSections(zone, ZONE_DECK_HEADER_HEIGHT, landscape);
    const children = getMainDeckSectionRects(zone.cards, landscape);
    const boards = getDeckBoardRects(zone.bounds, zone.cards, ZONE_DECK_HEADER_HEIGHT, landscape);
    for (const [key, site] of [['spellbook', false], ['atlas', true]] as const) {
      const rect = required(children[key]);
      const first = required(zone.cards.find(card => landscape(card.cardName) === site));
      expect(first.y - getStackFan(count, site).overhang - rect.y).toBeGreaterThan(DECK_REGION_TITLE_HEIGHT);
      expect(rect.x - boards.mainboard.x).toBeGreaterThanOrEqual(18);
      expect(rect.y - boards.mainboard.y).toBeGreaterThan(DECK_REGION_TITLE_HEIGHT);
    }
    expect(required(children.atlas).y - required(children.spellbook).y - required(children.spellbook).height).toBeGreaterThanOrEqual(DECK_BOARD_GAP);
    const fitted = structuredClone(zone);
    fitDeckBoardSections(zone, ZONE_DECK_HEADER_HEIGHT, landscape);
    expect(zone).toEqual(fitted);
  });

  it.each([true, false])('keeps a tight existing Spellbook/Atlas layout in place (saved section frames: %s)', hasSavedFrames => {
    const zone = createEmptyZone('deck', 'Tight headers', 0);
    zone.cards = [false, true].flatMap(site => Array.from({ length: 4 }, (_, i) =>
      card(`${site}-${i}`, 'mainboard', site ? 20 : 10, site ? 310 : 20, site ? 'Site' : 'Spell')));
    const olderFrames: DeckRegionBounds = {
      spellbook: { x: -8, y: -60, width: 210, height: 258 },
      atlas: { x: 2, y: 240, width: 210, height: 198 },
    };
    if (hasSavedFrames) zone.deckRegionBounds = olderFrames;
    const before = structuredClone(zone.cards);
    fitDeckBoardSections(zone, ZONE_DECK_HEADER_HEIGHT, landscape);
    const { rects, headers } = getMainDeckSectionLayout(zone.cards, landscape, zone.deckRegionBounds);
    const spellbook = required(rects.spellbook);
    const atlasHeader = required(headers.atlas);
    const spellBottom = 20 + CARD_SIZE.PORTRAIT.height + getStackFan(4, false).overhang;
    const siteTop = 310 - getStackFan(4, true).overhang;
    expect(zone.cards).toEqual(before);
    expect(required(headers.spellbook).height).toBe(DECK_SECTION_HEADER_HEIGHT);
    expect(atlasHeader.y).toBeGreaterThanOrEqual(spellBottom + DECK_BOARD_BOTTOM_PADDING + DECK_BOARD_GAP);
    expect(atlasHeader.y).toBeGreaterThanOrEqual(spellbook.y + spellbook.height + DECK_BOARD_GAP);
    expect(atlasHeader.y + atlasHeader.height).toBe(siteTop);
    expect(atlasHeader.height).toBe(DRAWN_GRID.height);
    if (hasSavedFrames) expect(rects).toEqual(olderFrames);
    const fitted = structuredClone(zone);
    fitDeckBoardSections(zone, ZONE_DECK_HEADER_HEIGHT, landscape);
    expect(zone).toEqual(fitted);
  });

  it('keeps nested label bands and section headers clear of each other', () => {
    const zone = createEmptyZone('deck', 'Nested heading clearance', 0);
    const canvasLabels: CanvasLabel[] = [];
    for (const key of ['spellbook', 'atlas'] as const) {
      const site = key === 'atlas';
      canvasLabels.push({ id: key, areaId: zone.id, text: 'Parent', x: 10, y: -500 },
        { id: `${key}-child`, parentLabelId: key, areaId: zone.id, text: 'Child', x: 10, y: -500 });
      for (let i = 0; i < 4; i++) zone.cards.push({
        ...card(`${key}-${i}`, 'mainboard', site ? 20 : 10, site ? 430 : 20, site ? 'Site' : 'Spell'), labelId: `${key}-child`,
      });
    }
    const size = () => ({ width: 52, height: 18 });
    const { bands, headings } = getLabelHeadingLayout(canvasLabels, [zone], landscape, size);
    const labelBounds = (id: string) => required(getLabelRegionBounds(canvasLabels,
      required(canvasLabels.find(label => label.id === id)), [zone], landscape, size, headings, undefined, bands) ?? undefined);
    const spellbook = labelBounds('spellbook');
    const atlas = labelBounds('atlas');
    const { headers } = getMainDeckSectionLayout(zone.cards, landscape, {}, { spellbook: [spellbook], atlas: [atlas] });
    const spellHeader = required(headers.spellbook);
    const header = required(headers.atlas);
    expect(spellHeader.y + spellHeader.height).toBe(spellbook.y);
    expect(spellHeader.height).toBe(DRAWN_GRID.height);
    expect(header.y).toBeGreaterThanOrEqual(spellbook.y + spellbook.height + DECK_BOARD_BOTTOM_PADDING + DECK_BOARD_GAP);
    expect(header.y + header.height).toBe(atlas.y);
    expect(header.height).toBe(DRAWN_GRID.height);
  });

  it('fits headers above mixed label bands and nearby loose headings without moving cards', () => {
    const cards = [card('spell', 'mainboard', 10, 240), card('site', 'mainboard', 700, 240, 'Site')];
    const originalCards = structuredClone(cards);
    const baseline = getMainDeckSectionLayout(cards, landscape);
    const sharedBand = { x: 0, y: 180, width: 850, height: 60 };
    const looseHeading = { x: 720, y: 160, width: 60, height: 18 };
    const distantHeading = { ...looseHeading, y: -200 };
    const labels = { shared: [sharedBand, looseHeading, distantHeading] };
    const { rects, headers } = getMainDeckSectionLayout(cards, landscape, {}, labels);
    const spellbook = required(headers.spellbook);
    const atlas = required(headers.atlas);
    expect(spellbook.height).toBe(DRAWN_GRID.height);
    expect(atlas.height).toBe(DRAWN_GRID.height);
    expect(spellbook.y + spellbook.height).toBe(sharedBand.y);
    expect(atlas.y + atlas.height).toBe(looseHeading.y);
    for (const key of ['spellbook', 'atlas'] as const) {
      const before = required(baseline.rects[key]);
      const rect = required(rects[key]);
      expect(rect).toMatchObject({ x: before.x, width: before.width, y: required(headers[key]).y });
      expect(rect.y + rect.height).toBe(before.y + before.height);
    }
    expect(cards).toEqual(originalCards);
    expect(getMainDeckSectionLayout(cards, landscape, rects, labels)).toEqual({ rects, headers });
  });

  it('keeps a blocked header from crossing another card section to find a free row', () => {
    const cards = [card('spell', 'mainboard', 10, 75), card('site', 'mainboard', 20, 300, 'Site')];
    const baseline = getMainDeckSectionLayout(cards, landscape);
    const shared = [{ x: 0, y: 240, width: 200, height: DRAWN_GRID.height }];
    const { rects, headers } = getMainDeckSectionLayout(cards, landscape, {}, { shared });
    expect(rects).toEqual(baseline.rects);
    expect(headers.spellbook).toEqual(baseline.headers.spellbook);
    expect(headers.atlas?.height).toBe(0);
  });

  it('clips headers around occupied space while respecting saved frame positions', () => {
    const saved: DeckRegionBounds = { atlas: { x: 0, y: 60, width: 210, height: 300 } };
    const cards = [card('spell', 'mainboard', 10, 20), card('site', 'mainboard', 20, 310, 'Site')];
    const { rects, headers } = getMainDeckSectionLayout(cards, landscape, saved);
    expect(required(rects.atlas).y).toBe(required(saved.atlas).y);
    expect(required(headers.atlas).y).toBeGreaterThanOrEqual(20 + CARD_SIZE.PORTRAIT.height);
    expect(required(headers.atlas).height).toBeGreaterThanOrEqual(DECK_REGION_TITLE_HEIGHT);

    const empty = getMainDeckSectionLayout([], landscape, {}, {}, { x: 0, y: 0 });
    expect(empty.headers.spellbook).toEqual({ ...empty.rects.spellbook, height: DRAWN_GRID.height });
    expect(empty.headers.atlas).toEqual({ ...empty.rects.atlas, height: DRAWN_GRID.height });
    expect(required(empty.headers.atlas).y).toBeGreaterThan(required(empty.headers.spellbook).height + required(empty.headers.spellbook).y);
  });

  it('uses the available space when two saved sections cannot fit a complete header between them', () => {
    const cards = [card('spell', 'mainboard', 10, 20), card('site', 'mainboard', 20, 205, 'Site')];
    const saved: DeckRegionBounds = { atlas: { x: 0, y: 60, width: 210, height: 300 } };
    const { rects, headers } = getMainDeckSectionLayout(cards, landscape, saved);
    const header = required(headers.atlas);
    expect(rects.atlas).toEqual(saved.atlas);
    expect(header.height).toBe(DECK_REGION_TITLE_HEIGHT);
    expect(header.y).toBeGreaterThanOrEqual(20 + CARD_SIZE.PORTRAIT.height);
    expect(header.y + header.height).toBe(205);
  });

  it('widens headers and their frames in a deck with one stack per section', () => {
    const zone = createEmptyZone('deck', 'Compact stats', 0);
    zone.cards = [card('spell', 'mainboard', 120, 120), card('site', 'mainboard', 120, 420, 'Site')];
    const before = structuredClone(zone.cards);
    const mainOrigin = { x: 0, y: 0 };
    const { rects, headers } = getMainDeckSectionLayout(zone.cards, landscape, {}, {}, mainOrigin);
    const main = getDeckBoardRects(zone.bounds, zone.cards, ZONE_DECK_HEADER_HEIGHT, landscape).mainboard;
    for (const key of ['spellbook', 'atlas'] as const) {
      const rect = required(rects[key]);
      expect(rect.x).toBe(120 - DECK_BOARD_INNER_PADDING);
      expect(rect.width).toBe(DECK_SECTION_MIN_WIDTH);
      expect(required(headers[key])).toMatchObject({ x: rect.x, width: rect.width });
      expect(main.x + main.width).toBeGreaterThanOrEqual(rect.x + rect.width);
    }
    expect(zone.cards).toEqual(before);
  });

  it('widens away from a neighbouring section only when the additional space is clear', () => {
    const main = [card('spell', 'mainboard', 100, 240), card('site', 'mainboard', 335, 240, 'Site')];
    const origin = { x: 0, y: 0 };
    const { rects, headers } = getMainDeckSectionLayout(main, landscape, {}, {}, origin);
    const spellbook = required(rects.spellbook);
    const atlas = required(rects.atlas);
    expect(spellbook.width).toBe(DECK_SECTION_MIN_WIDTH);
    expect(spellbook.x).toBeLessThan(100 - DECK_BOARD_INNER_PADDING);
    expect(spellbook.x + spellbook.width).toBeLessThanOrEqual(atlas.x);
    expect(atlas.x).toBe(335 - DECK_BOARD_INNER_PADDING);
    expect(atlas.width).toBe(DECK_SECTION_MIN_WIDTH);
    expect(headers.spellbook?.x).toBe(spellbook.x);

    const cards = [...main, card('collection', 'collection', -50, 240)];
    const before = structuredClone(cards);
    const blocked = getMainDeckSectionLayout(cards, landscape, {}, {}, origin);
    expect(blocked.rects.spellbook).toMatchObject({ x: 100 - DECK_BOARD_INNER_PADDING, width: 210 });
    expect(blocked.rects.atlas).toEqual(atlas);
    expect(cards).toEqual(before);
  });

  it('keeps a saved section wider than the space reserved for its statistics', () => {
    const cards = [card('spell', 'mainboard', 100, 240), card('site', 'mainboard', 100, 600, 'Site')];
    const saved = { spellbook: { x: 80, y: 175, width: 420, height: 225 } };
    const { rects, headers } = getMainDeckSectionLayout(cards, landscape, saved, {}, { x: 0, y: 0 });
    expect(rects.spellbook).toEqual(saved.spellbook);
    expect(headers.spellbook?.width).toBe(saved.spellbook.width);
  });

  it('accepts legacy Collection membership without exposing the legacy board internally', () => {
    expect(normalizeDeckBoard('sideboard')).toBe('collection');
  });

  it.each(['mainboard', 'collection', 'maybeboard'] as const)('keeps a single %s card near the right edge compact', (board) => {
    const zone=createEmptyZone('deck','Compact region',0);
    const shiftedX = 2 * DECK_COLLECTION_WIDTH;
    zone.cards=[card('anchor','mainboard',0,0),card('shifted',board,shiftedX,350)];
    if (board==='mainboard') zone.cards=[card('anchor','collection',0,350),card('shifted',board,shiftedX,0)];
    const next=getDeckAreaBounds(zone,ZONE_DECK_HEADER_HEIGHT,landscape);
    const rects=getDeckBoardRects(next,zone.cards,ZONE_DECK_HEADER_HEIGHT,landscape);
    const width = board === 'mainboard' ? DECK_SECTION_MIN_WIDTH + DECK_BOARD_INNER_PADDING * 2 : DECK_COMPACT_BOARD_WIDTH;
    expect(rects[board].width).toBe(width);
    expect(next.x+next.width).toBe(rects[board].x + rects[board].width + DECK_BOARD_PADDING);
    expect(zone.cards[1]?.x).toBe(shiftedX);
  });

  it('retains a ten-column empty Collection drop target without giving Main or Maybe that width', () => {
    const zone=createEmptyZone('deck','Empty targets',0);
    const rects=getDeckBoardRects(zone.bounds,[],ZONE_DECK_HEADER_HEIGHT,landscape);
    expect(rects.collection.width).toBe(DECK_COLLECTION_WIDTH);
    expect(rects.mainboard.width).toBe(DECK_SECTION_MIN_WIDTH + DECK_BOARD_INNER_PADDING * 2);
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
    const { x, y } = snapCardToGrid(0, 100, false);
    zone.cards = [card('A', 'mainboard', x, y),card('B','mainboard',x + 2 * spellPitchX,y),card('C','collection',x,400)];
    const before=structuredClone(zone.cards);
    const additions=[card('new','mainboard',0,0),card('duplicate','mainboard',0,0,'A')];
    placeNewDeckCards(zone,additions,landscape);
    expect(zone.cards).toEqual(before);
    expect(additions[0]?.x).toBe(x + spellPitchX);
    expect(additions[0]?.y).toBe(y);
    expect(additions[1]?.x).toBe(x);
    expect(additions[1]?.y).toBe(y);
    expect(additions.every((entry) => entry.board==='mainboard')).toBe(true);
  });

  it('extends a full row to the right rather than pushing Collection or rearranging Main', () => {
    const zone=createEmptyZone('deck','Full row',0);
    const { x, y } = snapCardToGrid(0, 100, false);
    zone.cards=Array.from({length:12},(_,index)=>card(`main-${index}`,'mainboard',x+index*spellPitchX,y));
    zone.cards.push(card('collection','collection',x,320));
    const before=structuredClone(zone.cards);
    const additions=[card('fresh','mainboard',0,0)];
    placeNewDeckCards(zone,additions,landscape);
    expect(zone.cards).toEqual(before);
    expect(additions[0]?.x).toBe(x+12*spellPitchX);
    expect(additions[0]?.y).toBe(y);
  });

  it('fills Main spell vacancies only within Spellbook rows when Atlas is far below', () => {
    const zone=createEmptyZone('deck','Separate Main sections',0);
    zone.cards=[card('spell','mainboard',5,122.5),card('site','mainboard',12.5,610,'Site A')];
    const before=structuredClone(zone.cards);
    const additions=[card('new-spell-1','mainboard',0,0),card('new-spell-2','mainboard',0,0)];
    placeNewDeckCards(zone,additions,landscape);
    expect(additions.map((entry) => entry.y)).toEqual([122.5,122.5]);
    expect(additions.map((entry) => entry.x)).toEqual([5 + spellPitchX, 5 + 2 * spellPitchX]);
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
