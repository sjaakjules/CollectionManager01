import { describe, expect, it } from 'vitest';
import { LAYOUT_DIRECTIONS, getCatalogueLayoutCard, type CatalogueLayoutConfig } from '@/data/catalogueLayout';
import type { Card } from '@/data/dataModels';
import { calculateCardLayout, snapCardToGrid } from '@/rendering/Grid';
import { required } from '@/utils/required';
import type { CanvasArea, CanvasCardInstance } from './canvasAreas';
import { arrangeCardsByLayout } from './cardLayoutPipeline';
import { arrangeDeckSelection } from './selectionLayout';
import { quickSortDeckSelection } from './selectionActions';

const region = { x: 0, y: 0, width: 900, height: 900 };
const arrows = ['↓', '↑', '→', '←'] as const;
type Arrow = typeof arrows[number];
type PlacedCard = { name: string; x: number; y: number };

function metadata(name: string, cost: number, landscape = false, set = 'Alpha'): Card {
  const guardian: Card['guardian'] = {
    type: landscape ? 'Site' : 'Minion', cost, rarity: 'Ordinary', rulesText: '', attack: null,
    defence: null, life: null, thresholds: { air: 1, earth: 0, fire: 0, water: 0 },
  };
  return { name, elements: '', subTypes: '', guardian,
    sets: [{ name: set, releasedAt: '', variants: [], metadata: guardian }] };
}

function layout(arrow: Arrow, field: 'name' | 'cost' | 'set' = 'name'): CatalogueLayoutConfig {
  const { axis, direction } = required(LAYOUT_DIRECTIONS.find(option => option.arrow === arrow));
  return { columns: 4, steps: [
    { field: 'type', mode: 'group', axis: 'vertical', direction: 'asc' },
    { field, mode: 'sort', axis, direction },
  ] };
}

function instances(cards: Card[]): CanvasCardInstance[] {
  return [...cards].reverse().map((card, index) => ({
    id: card.name, cardName: card.name, board: 'mainboard',
    ...snapCardToGrid(120 + (index % 4) * 240, 360 + Math.floor(index / 4) * 240, card.guardian.type === 'Site'),
  }));
}

function area(cards: CanvasCardInstance[]): CanvasArea {
  return { id: 'deck', name: 'Deck', type: 'deck', pinned: true, bounds: region, cards };
}

function catalogue(cards: Card[], config: CatalogueLayoutConfig): PlacedCard[] {
  return calculateCardLayout({ cards: [...cards].reverse().map(card => ({
    ...getCatalogueLayoutCard(card.name, card), isLandscape: card.guardian.type === 'Site',
  })), catalogueLayout: config }).cards.map(card => ({ name: card.name, ...card.position }));
}

function packed(cards: Card[], config: CatalogueLayoutConfig): PlacedCard[] {
  const source = instances(cards);
  const positions = arrangeCardsByLayout(source, name => cards.find(card => card.name === name), config, { region, aspectRatio: 2 });
  return source.map(card => ({ name: card.cardName, ...required(positions.get(card.id)) }));
}

function readingOrder(cards: PlacedCard[], arrow: Arrow): string[] {
  const vertical = arrow === '↑' || arrow === '↓';
  return [...cards].sort((a, b) => vertical ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y).map(card => card.name);
}

describe('layout arrows point toward increasing values', () => {
  for (const landscape of [false, true]) {
    for (const field of ['name', 'cost'] as const) {
      it.each(arrows)(`orders ${landscape ? 'sites' : 'spells'} by ${field} in the %s direction across every layout surface`, arrow => {
        const cards = [...'ABCDEFGZ'].map((name, index) => metadata(name, index + 1, landscape));
        const config = layout(arrow, field);
        const expected = cards.map(card => card.name);
        if (arrow === '↑' || arrow === '←') expected.reverse();
        const source = instances(cards);
        const saved = structuredClone(source);
        const selected = new Set(source.map(card => `deck:${card.id}`));
        // A sort-only selection must use the same reading direction, reusing exact slots.
        const selection = required(arrangeDeckSelection([area(source)], [], selected, cards,
          { ...config, steps: config.steps.filter(step => step.mode === 'sort') }).areas[0]).cards;
        const points = (entries: CanvasCardInstance[]) => entries.map(({ x, y }) => `${x},${y}`).sort();
        expect(points(selection)).toEqual(points(source));
        expect(source).toEqual(saved);
        for (const result of [catalogue(cards, config), packed(cards, config),
          selection.map(card => ({ name: card.cardName, x: card.x, y: card.y }))]) {
          expect(readingOrder(result, arrow)).toEqual(expected);
          expect(new Set(result.map(card => card.x)).size).toBeGreaterThan(1);
          expect(new Set(result.map(card => card.y)).size).toBeGreaterThan(1);
        }
      });
    }
  }

  it.each(arrows)('advances entire set bands in the %s direction', arrow => {
    const cards = [...'ABCDEFGZ'].map((name, index) => metadata(name, 1, false,
      index < 4 ? 'Alpha' : "Baldassare's Travels"));
    const config = layout(arrow, 'set');
    for (const result of [catalogue(cards, config), packed(cards, config)]) {
      const coordinate = (card: PlacedCard) => arrow === '↑' || arrow === '↓' ? card.y : card.x;
      const older = result.filter(card => 'ABCD'.includes(card.name)).map(coordinate);
      const newer = result.filter(card => 'EFGZ'.includes(card.name)).map(coordinate);
      if (arrow === '↓' || arrow === '→') expect(Math.max(...older)).toBeLessThan(Math.min(...newer));
      else expect(Math.max(...newer)).toBeLessThan(Math.min(...older));
    }
  });

  it.each(['↑', '↓'] as const)('keeps sparse %s sorts vertical even in a wide group', arrow => {
    const cards = [metadata('Alpha', 1), metadata('Zulu', 2)];
    const config = { ...layout(arrow), columns: 16 };
    for (const result of [catalogue(cards, config), packed(cards, config)]) {
      const first = required(result.find(card => card.name === 'Alpha'));
      const last = required(result.find(card => card.name === 'Zulu'));
      expect(first.x).toBe(last.x);
      if (arrow === '↓') expect(first.y).toBeLessThan(last.y);
      else expect(first.y).toBeGreaterThan(last.y);
    }
  });

  it('keeps arrowless Quick Sort in ordinary row reading order', () => {
    const cards = [...'ABCDEFGZ'].map((name, index) => metadata(name, index));
    const source = instances(cards);
    const result = required(quickSortDeckSelection([area(source)], [], new Set(source.map(card => `deck:${card.id}`)), cards, 'name').areas[0]);
    expect(readingOrder(result.cards.map(card => ({ name: card.cardName, x: card.x, y: card.y })), '↓')).toEqual([...'ABCDEFGZ']);
  });
});
