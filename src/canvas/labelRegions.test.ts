import { describe, expect, it } from 'vitest';
import {
  cardBounds, clampLabelHeadingPosition, getLabelCards, getLabelFamily, getLabelHeadingBands, getLabelHeadingBounds,
  getLabelHeadingLayout, getLabelRegionBounds, placeCardsBelowLabel, LABEL_CARD_GAP, LABEL_HEADING_INSET_X,
  LABEL_HEADING_INSET_Y, LABEL_HEADING_RESERVED_BOTTOM, ShakeDetector,
} from './labelRegions';
import type { CanvasLabel } from '@/data/dataModels';
import type { CanvasArea, CanvasCardInstance } from './canvasAreas';
import { CARD_CELL_SPACING, CARD_SIZE, DRAWN_GRID, SNAP_GRID, getStackFan, snapCardCenter, snapCardToGrid } from '@/rendering/Grid';

function required<T>(value: T | undefined | null): T { if (value == null) throw new Error('Missing fixture'); return value; }

const labels: CanvasLabel[] = [
  { id: 'parent', text: 'Engine', x: 100, y: 100, areaId: 'deck', board: 'mainboard' },
  { id: 'child', text: 'Draw', x: 200, y: 200, areaId: 'deck', board: 'mainboard', parentLabelId: 'parent' },
  { id: 'empty', text: 'Loose', x: -5000, y: -5000, areaId: 'deck' },
];
const areas: CanvasArea[] = [{ id: 'deck', name: 'Deck', type: 'deck', pinned: true, bounds: { x: 0, y: 0, width: 1000, height: 1000 }, cards: [
  { id: 'a', cardName: 'Draw card', x: 250, y: 300, board: 'mainboard', labelId: 'child' },
  { id: 'b', cardName: 'Unrelated', x: 260, y: 310, board: 'mainboard' },
] }];

describe('explicit label membership', () => {
  it('includes nested members without capturing unrelated overlapping cards', () => {
    expect([...getLabelFamily(labels, 'parent')]).toEqual(['parent', 'child']);
    expect(getLabelCards(labels, 'parent', areas).map(card => card.id)).toEqual(['a']);
  });
  it('reserves separate rows for nested headings and keeps loose labels outside the group outline', () => {
    const parent = required(labels[0]);
    const looseChild = { ...required(labels[2]), parentLabelId: parent.id };
    const family = [parent, required(labels[1]), looseChild];
    const titleSize = () => ({ width: 500, height: 36 });
    const { headings, bands } = getLabelHeadingLayout(family, areas, () => false, titleSize);
    const parentBand = required(bands.get(parent.id));
    const childBand = required(bands.get('child'));
    const parentHeading = required(headings.get(parent.id));
    const childHeading = required(headings.get('child'));
    const bounds = getLabelRegionBounds(family, parent, areas, () => false, titleSize, headings, undefined, bands);
    expect(childBand.y + childBand.height).toBe(4 * DRAWN_GRID.height);
    expect(parentBand.y + parentBand.height).toBe(childBand.y);
    expect(bounds).toMatchObject({ x: parentBand.x, y: parentBand.y, width: parentBand.width });
    expect(parentBand.width).toBe(2 * DRAWN_GRID.width);
    expect(parentHeading.x).toBe(parentBand.x + LABEL_HEADING_INSET_X);
    expect(parentHeading.x + parentHeading.width).toBe(parentBand.x + parentBand.width - LABEL_HEADING_INSET_X);
    expect(parentHeading.y + parentHeading.height).toBeLessThan(childHeading.y);
    expect(headings.get('empty')).toMatchObject({ x: -5000, y: -5000 });
    expect(bands.has('empty')).toBe(false);
    expect(getLabelRegionBounds(family, looseChild, areas, () => false, titleSize)).toBeNull();
    expect(getLabelRegionBounds(labels, parent, [{ ...required(areas[0]), cards: [] }], () => false, () => ({ width: 200, height: 36 }))).toBeNull();
  });
  it('terminates safely if an old save contains a cyclic label relationship', () => {
    const cyclic = [{ ...required(labels[0]), parentLabelId: 'child' }, required(labels[1])];
    expect([...getLabelFamily(cyclic, 'parent')]).toEqual(['parent', 'child']);
    expect(getLabelHeadingBounds(cyclic, areas, () => false, () => ({ width: 50, height: 12 })).size).toBe(2);
  });

  it('ignores a stale child link and card label reference from another deck', () => {
    const parent = required(labels[0]);
    const child = { ...required(labels[1]), areaId: 'other' };
    const other = { ...required(areas[0]), id: 'other', cards: [
      { id: 'child-card', cardName: 'Spell', x: 200, y: 870, labelId: child.id },
      { id: 'foreign', cardName: 'Spell', x: 200, y: -5000, labelId: parent.id },
    ] };
    const owned = [...areas, other];
    const linked = [parent, child];
    const titleSize = () => ({ width: 100, height: 20 });
    const headings = getLabelHeadingBounds(linked, owned, () => false, titleSize);
    expect([...getLabelFamily(linked, parent.id)]).toEqual([parent.id]);
    expect(getLabelCards(linked, parent.id, owned)).toEqual([]);
    expect(headings.get(parent.id)).toEqual({ x: parent.x, y: parent.y, ...titleSize() });
    expect(required(headings.get(child.id)).y).toBeGreaterThan(300);
    expect(getLabelRegionBounds(linked, parent, owned, () => false, titleSize, headings)).toBeNull();
  });
});

describe('headings above full stack slots', () => {
  const isLandscape = (name: string) => name === 'Site';
  const titleSize = () => ({ width: 80, height: 18 });

  it.each([false, true])('keeps the same grid alignment for one through four copies (landscape %s)', (landscape) => {
    const names = landscape ? ['Site', 'Site', 'Site', 'Site'] : ['Spell', 'Other Spell', 'Spell', 'Other Spell'];
    const size = landscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const cells = landscape ? CARD_CELL_SPACING.LANDSCAPE : CARD_CELL_SPACING.PORTRAIT;
    const top = 6 * SNAP_GRID.height;
    const cardY = top + (cells.y * SNAP_GRID.height - size.height) / 2;
    const inset = (cells.x * SNAP_GRID.width - size.width) / 2;
    const first: CanvasLabel = { id: 'spirits', text: 'Spirits', x: -110, y: 108, areaId: 'deck' };
    const second: CanvasLabel = { id: 'beasts', text: 'Beasts', x: 1000, y: cardY + 4, areaId: 'deck' };
    const groupLabels = [first, second];
    const before = structuredClone(groupLabels);
    const landscapeByName = () => landscape;
    for (let count = 1; count <= 4; count++) {
      const cards: CanvasCardInstance[] = names.slice(0, count).map((cardName, i) => ({
        id: String(i), cardName, x: 2 * DRAWN_GRID.width + inset, y: cardY, labelId: first.id,
      }));
      cards.push({ id: 'beast', cardName: required(names[0]), x: 7 * DRAWN_GRID.width + inset, y: cardY, labelId: second.id });
      const zone = { ...required(areas[0]), cards };
      const { headings, bands } = getLabelHeadingLayout(groupLabels, [zone], landscapeByName, titleSize);
      for (const [label, column] of [[first, 2], [second, 7]] as const) {
        const x = column * DRAWN_GRID.width;
        const y = top - DRAWN_GRID.height;
        expect(bands.get(label.id)).toEqual({ x, y, width: cells.x * DRAWN_GRID.width, height: DRAWN_GRID.height });
        expect(headings.get(label.id)).toEqual({ x: x + LABEL_HEADING_INSET_X, y: y + LABEL_HEADING_INSET_Y, ...titleSize() });
      }
      expect(Math.min(...[...cardBounds(cards, landscapeByName).values()].map(rect => rect.y))).toBeGreaterThanOrEqual(top);
      expect(zone.cards.every(card => card.y === cardY)).toBe(true);
    }
    expect(groupLabels).toEqual(before);
  });

  it('aligns mixed-group headings to the earliest and leftmost full slots', () => {
    const label = { ...required(labels[0]), x: -31, y: 410 };
    const loose = { ...required(labels[2]), areaId: undefined };
    const spellInset = (CARD_CELL_SPACING.PORTRAIT.y * SNAP_GRID.height - CARD_SIZE.PORTRAIT.height) / 2;
    const siteInset = (CARD_CELL_SPACING.LANDSCAPE.y * SNAP_GRID.height - CARD_SIZE.LANDSCAPE.height) / 2;
    const cards = [
      { id: 'spell', cardName: 'Spell', x: 190, y: SNAP_GRID.height * 3 + spellInset - 0.5, labelId: label.id },
      { id: 'site', cardName: 'Site', x: 20, y: SNAP_GRID.height * 4 + siteInset, labelId: label.id },
    ];
    const { bands, headings } = getLabelHeadingLayout([label, loose], [{ ...required(areas[0]), cards }], isLandscape, titleSize);
    expect(bands.get(label.id)).toEqual({ x: 0, y: DRAWN_GRID.height, width: 5 * DRAWN_GRID.width, height: DRAWN_GRID.height });
    expect(headings.get(label.id)).toEqual({ x: LABEL_HEADING_INSET_X, y: DRAWN_GRID.height + LABEL_HEADING_INSET_Y, ...titleSize() });
    expect(headings.get(loose.id)).toEqual({ x: loose.x, y: loose.y, ...titleSize() });
  });

  it('pins a populated title to the top-left even when an older save moved it within the band', () => {
    const label = required(labels[1]);
    const band = required(getLabelHeadingBands([label], areas, isLandscape).get(label.id));
    const point = { x: band.x + LABEL_HEADING_INSET_X + 6, y: band.y + LABEL_HEADING_INSET_Y + 5 };
    const edited = { ...label, ...point };
    const { headings, bands } = getLabelHeadingLayout([edited], areas, isLandscape, titleSize);
    expect(headings.get(label.id)).toEqual({
      x: band.x + LABEL_HEADING_INSET_X, y: band.y + LABEL_HEADING_INSET_Y, ...titleSize(),
    });
    expect(bands.get(label.id)).toEqual(band);
    expect(edited).toMatchObject(point);
    const edge = clampLabelHeadingPosition(band, { x: point.x + 1000, y: point.y + 1000 }, titleSize());
    expect(edge.x + edge.width).toBe(band.x + band.width - LABEL_HEADING_INSET_X);
    expect(edge.y + edge.height).toBe(band.y + band.height - LABEL_HEADING_RESERVED_BOTTOM);
  });
});

describe('dropping cards beneath a label heading', () => {
  const label: CanvasLabel = { id: 'heading', text: 'Keep together', x: 211, y: 187, areaId: 'deck', board: 'mainboard' };
  const titleSize = () => ({ width: 120, height: 21 });
  const isLandscape = (name: string) => name === 'Site';
  const area = (cards: CanvasCardInstance[]): CanvasArea => ({ ...required(areas[0]), cards });
  const spellPitch = CARD_CELL_SPACING.PORTRAIT.x * SNAP_GRID.width;

  it.each(['Spell', 'Site'])('reserves the title and gap above a six-card %s stack, including its upward fan', name => {
    const cards: CanvasCardInstance[] = Array.from({ length: 6 }, (_, index) => ({
      id: String(index), cardName: name, x: 160, y: 145, board: 'mainboard', labelId: label.id,
    }));
    placeCardsBelowLabel(cards, label, area(cards), [label], isLandscape, titleSize);
    const first = required(cards[0]);
    const { overhang } = getStackFan(cards.length, name === 'Site');
    expect(cards.every(card => card.x === first.x && card.y === first.y)).toBe(true);
    expect(first.y - overhang).toBeGreaterThanOrEqual(label.y + titleSize().height + LABEL_CARD_GAP);
    const size = name === 'Site' ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
    const center = { x: first.x + size.width / 2, y: first.y + size.height / 2 };
    expect(snapCardCenter(center.x, center.y, name === 'Site')).toEqual(center);
    const placed = [area(cards)];
    const { bands, headings } = getLabelHeadingLayout([label], placed, isLandscape, titleSize);
    const heading = required(headings.get(label.id));
    expect(heading.y + heading.height + LABEL_CARD_GAP).toBeLessThanOrEqual(first.y - overhang);
    const region = required(getLabelRegionBounds([label], label, placed, isLandscape, titleSize, headings));
    expect(region.y).toBe(bands.get(label.id)?.y);
    expect(region.y + region.height).toBeGreaterThan(first.y + size.height + overhang);
  });

  it('keeps a mixed selection and its offsets intact while clearing the heading', () => {
    const cards: CanvasCardInstance[] = [
      { id: 'spell', cardName: 'Spell', x: 10, y: 80, board: 'mainboard' },
      { id: 'site', cardName: 'Site', x: 300, y: 20, board: 'mainboard' },
    ];
    placeCardsBelowLabel(cards, label, area([]), [label], isLandscape, titleSize);
    const spell = required(cards[0]), site = required(cards[1]);
    expect(site.x - spell.x).toBe(290);
    expect(site.y - spell.y).toBe(-60);
    expect(Math.min(spell.y, site.y)).toBeGreaterThanOrEqual(label.y + titleSize().height + LABEL_CARD_GAP);
  });

  it('places a later drop near existing members without moving or covering them', () => {
    const heading = { ...label, x: 4 * SNAP_GRID.width - 16 };
    const first: CanvasCardInstance[] = Array.from({ length: 4 }, (_, i) => ({
      id: `old-${i}`, cardName: 'Site', ...snapCardToGrid(100, 100, true), board: 'mainboard', labelId: heading.id,
    }));
    const zone = area(first);
    placeCardsBelowLabel(first, heading, zone, [heading], isLandscape, titleSize);
    const before = structuredClone(first);
    heading.y += SNAP_GRID.height * 8;
    const rendered = required(getLabelHeadingBounds([heading], [zone], isLandscape, titleSize).get(heading.id));
    const next: CanvasCardInstance = { id: 'next', cardName: 'Spell', x: 170, y: 80, board: 'mainboard', labelId: heading.id };
    // Catalogue additions are already in the area when membership is applied.
    zone.cards.push(next);
    placeCardsBelowLabel([next], heading, zone, [heading], isLandscape, titleSize);
    expect(zone.cards.slice(0, 4)).toEqual(before);
    const existing = required(cardBounds(before, isLandscape).get('old-0'));
    expect(next.y).toBeGreaterThanOrEqual(existing.y + existing.height + 4);
    expect(next.y).toBeGreaterThanOrEqual(rendered.y + rendered.height + LABEL_CARD_GAP);
    expect(next.y - existing.y - existing.height).toBeLessThan(SNAP_GRID.height);
    const placed = { ...next };
    placeCardsBelowLabel([next], heading, zone, [heading], isLandscape, titleSize);
    expect(next).toEqual(placed);
  });

  it('keeps a nested label title clear when inserting into its parent', () => {
    const child: CanvasLabel = { ...label, id: 'child-heading', y: 230, parentLabelId: label.id };
    const card: CanvasCardInstance = { id: 'new', cardName: 'Spell', x: 200, y: 170 };
    placeCardsBelowLabel([card], label, area([]), [label, child], isLandscape, titleSize);
    expect(card.x >= child.x + titleSize().width + LABEL_CARD_GAP ||
      card.y >= child.y + titleSize().height + LABEL_CARD_GAP).toBe(true);
  });

  it('clears the displayed title of a populated child even when its saved position is elsewhere', () => {
    const parent: CanvasLabel = { ...label, x: 210 };
    const child: CanvasLabel = { ...parent, id: 'child-heading', y: -500, parentLabelId: parent.id };
    const cards: CanvasCardInstance[] = [
      { id: 'parent-member', cardName: 'Spell', ...snapCardToGrid(700, 287.5, false), labelId: parent.id },
      { id: 'child-member', cardName: 'Spell', ...snapCardToGrid(700, 352.5, false), labelId: child.id },
    ];
    const zone = area(cards);
    const headings = getLabelHeadingBounds([parent, child], [zone], isLandscape, titleSize);
    const childTitle = required(headings.get(child.id));
    const next: CanvasCardInstance = { id: 'next', cardName: 'Spell', x: 210, y: 30, labelId: parent.id };
    placeCardsBelowLabel([next], parent, zone, [parent, child], isLandscape, titleSize);
    const bounds = required(cardBounds([next], isLandscape).get(next.id));
    expect(bounds.y >= childTitle.y + childTitle.height + LABEL_CARD_GAP ||
      bounds.x >= childTitle.x + childTitle.width + LABEL_CARD_GAP).toBe(true);
    const after = getLabelHeadingBounds([parent, child], [area([...cards, next])], isLandscape, titleSize);
    expect(after.get(child.id)).toEqual(childTitle);
    expect(after.get(parent.id)).toMatchObject({ x: headings.get(parent.id)?.x, y: headings.get(parent.id)?.y });
  });

  it('uses a nearby clear row instead of extending a label across a busy deck', () => {
    const start = snapCardToGrid(label.x, 4 * SNAP_GRID.height + 27.5, false);
    const occupied: CanvasCardInstance[] = Array.from({ length: 10 }, (_, i) => ({
      id: `existing-${i}`, cardName: 'Spell', x: start.x + i * spellPitch, y: start.y, board: 'mainboard',
    }));
    const before = structuredClone(occupied);
    const card: CanvasCardInstance = { id: 'incoming', cardName: 'Spell', x: 100, y: 100, board: 'mainboard' };
    placeCardsBelowLabel([card], label, area(occupied), [label], isLandscape, titleSize);
    expect(Math.abs(card.x - label.x)).toBeLessThan(SNAP_GRID.width);
    expect(card.y).toBeGreaterThanOrEqual(start.y + CARD_SIZE.PORTRAIT.height + 4);
    expect(occupied).toEqual(before);
  });

  it('fills a normal deck-column vacancy instead of opening a new row', () => {
    const first = snapCardToGrid(0, SNAP_GRID.height, false);
    const stackPadding = (CARD_CELL_SPACING.PORTRAIT.y * SNAP_GRID.height - CARD_SIZE.PORTRAIT.height) / 2;
    const heading = { ...label, x: first.x, y: first.y - stackPadding - titleSize().height - LABEL_CARD_GAP };
    const occupied: CanvasCardInstance[] = [first.x, first.x + 2 * spellPitch].map((x, i) => ({
      id: `existing-${i}`, cardName: 'Spell', x, y: first.y, board: 'mainboard',
    }));
    const card: CanvasCardInstance = { id: 'incoming', cardName: 'Spell', x: 0, y: 0, board: 'mainboard' };
    placeCardsBelowLabel([card], heading, area(occupied), [heading], isLandscape, titleSize);
    expect(card).toMatchObject({ x: first.x + spellPitch, y: first.y });
  });
});

describe('shake to detach', () => {
  it('requires three substantial reversals within the gesture window', () => {
    const shake = new ShakeDetector();
    shake.reset({ x: 0, y: 0 }, 0);
    expect(shake.move({ x: 40, y: 0 }, 100)).toBe(false);
    expect(shake.move({ x: 0, y: 0 }, 200)).toBe(false);
    expect(shake.move({ x: 40, y: 0 }, 300)).toBe(false);
    expect(shake.move({ x: 0, y: 0 }, 400)).toBe(true);
  });
  it('ignores pointer noise and slow changes of direction', () => {
    const shake = new ShakeDetector();
    shake.reset({ x: 0, y: 0 }, 0);
    for (let i = 1; i <= 20; i++) expect(shake.move({ x: i % 2 ? 5 : -5, y: 0 }, i * 30)).toBe(false);
    expect(shake.move({ x: 100, y: 0 }, 1500)).toBe(false);
    expect(shake.move({ x: 0, y: 0 }, 2600)).toBe(false);
  });
});
