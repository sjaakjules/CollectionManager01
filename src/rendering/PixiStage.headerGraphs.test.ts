// @vitest-environment jsdom
import { CanvasTextMetrics, Container, Graphics, Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZONE_DECK_HEADER_HEIGHT, type CanvasArea } from '@/canvas/canvasAreas';
import type { Card } from '@/data/dataModels';
import { required } from '@/utils/required';
import { PixiStage } from './PixiStage';

interface HeaderStage {
  drawZoneFrame(zone: CanvasArea, index: number): { title: Text; subzoneLabels: Container[] };
  zoneHeaderBounds: Map<string, {
    closeBounds: { left: number };
    variantTabBounds: Array<{ bounds: { top: number } }>;
    graphHoverRegions: Array<{
      series: Array<{ label: string; values: number[] }>;
    }>;
  }>;
}

const card: Card = {
  name: 'Fire Minion', sets: [], elements: 'Fire', subTypes: '',
  guardian: {
    type: 'Minion', rarity: 'Ordinary', cost: 2, rulesText: '', attack: null, life: null, defence: null,
    thresholds: { air: 0, earth: 0, fire: 1, water: 0 },
  },
};

describe('deck header graphs', () => {
  let zoneContainer: Container;

  beforeEach(() => {
    // jsdom has no canvas text metrics. Allow for the line height of Arial.
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation((text, style) => {
      const fontSize = Number(style.fontSize);
      const width = text.length * fontSize * 0.52;
      const height = Math.ceil(fontSize * 1.2);
      return new CanvasTextMetrics(text, style, width, height, [text], [width], height, width,
        { ascent: fontSize, descent: height - fontSize, fontSize });
    });
    zoneContainer = new Container({ sortableChildren: true });
  });

  afterEach(() => {
    zoneContainer.destroy({ children: true });
    vi.restoreAllMocks();
  });

  it.each([
    { description: 'a rearranged deck with an avatar and an author', width: 1500,
      name: 'Saved deck', avatarCardName: 'Avatar', deckAuthor: 'An Author with a Particularly Long Display Name Across the Header' },
    { description: 'a deck with a centered title', width: 1500,
      name: 'Saved deck', avatarCardName: undefined, deckAuthor: undefined },
    { description: 'a compact deck with a long name and author', width: 550,
      name: 'A Compact Deck with a Long Display Name', avatarCardName: 'Avatar', deckAuthor: 'An Author with a Long Display Name' },
  ])('draws and positions both curves for $description', ({ width, name, avatarCardName, deckAuthor }) => {
    const compact = width === 550;
    const zone: CanvasArea = {
      id: 'deck', type: 'deck', name, pinned: true, avatarCardName, deckAuthor,
      bounds: { x: 200, y: -400, width, height: 1420 },
      deckRegionBounds: compact ? {
        maybeboard: { x: 222, y: -162, width: 260, height: 260 },
        mainboard: { x: 222, y: 120, width: 506, height: 590 },
        collection: { x: 222, y: 732, width: 378, height: 260 },
      } : {
        maybeboard: { x: 222, y: -162, width: 260, height: 260 },
        mainboard: { x: 500, y: -162, width: 780, height: 590 },
        collection: { x: 1300, y: -162, width: 378, height: 260 },
      },
      cards: [{ id: 'active', cardName: card.name, board: 'mainboard', x: compact ? 280 : 580, y: compact ? 280 : -20 }],
      deckVariants: [{ id: 'main', name: 'Main', activeCardIds: ['active'] }],
      activeDeckVariantId: 'main',
    };
    const stage = Object.assign(Object.create(PixiStage.prototype) as HeaderStage, {
      zoneContainer, zoneHeaderBounds: new Map(), deckRegionHitRects: new Map(),
      cards: [card], canvasAreas: [zone], canvasLabels: [],
      addDeckStatisticColumns: vi.fn(),
    });

    const { title, subzoneLabels } = stage.drawZoneFrame(zone, 0);
    const header = required(stage.zoneHeaderBounds.get(zone.id));
    expect(header.graphHoverRegions.map(region => region.series[0])).toMatchObject([
      { label: 'Total', values: [0, 0, 1] },
      { label: 'All', values: [0, 0, 1] },
    ]);
    const author = subzoneLabels.find((label): label is Text => label instanceof Text && label.text.startsWith('by '));
    expect(title.text).toEqual(compact ? expect.stringMatching(/^[^…].*…$/) : name);
    if (deckAuthor) expect(author?.text).toEqual(compact ? expect.stringMatching(/…$/) : `by ${deckAuthor}`);
    expect(zone.name).toBe(name);
    expect(zone.deckAuthor).toBe(deckAuthor);

    const panels = subzoneLabels.filter((label): label is Graphics => label instanceof Graphics);
    expect(panels).toHaveLength(2);
    const left = required(panels[0]).getLocalBounds();
    const right = required(panels[1]).getLocalBounds();
    const identityRight = Math.max(title.x + title.width, author ? author.x + author.width : -Infinity);
    const tabTop = Math.min(zone.bounds.y + ZONE_DECK_HEADER_HEIGHT, ...header.variantTabBounds.map(tab => tab.bounds.top));
    expect(left.minX).toBeGreaterThan(identityRight);
    expect(left.maxX).toBeLessThan(right.minX);
    expect(left.width).toBeCloseTo(right.width);
    expect(right.maxX).toBeLessThan(header.closeBounds.left);
    expect(left.minY).toBeLessThan(title.y);
    expect(left.maxY).toBeLessThan(tabTop);
  });
});
