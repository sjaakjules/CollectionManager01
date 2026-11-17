import { buildCatalogueGroups, getCatalogueLayoutCard, getLayoutLeafAxis, type CatalogueLayoutStep } from '@/data/catalogueLayout';
import type { ActiveBoard, Card, CanvasLabel } from '@/data/dataModels';
import { getCardPixelSize, pixelsToSnapGrid, type GridPosition } from '@/rendering/Grid';
import { required } from '@/utils/required';
import type { CanvasArea, CanvasCardInstance } from './canvasAreas';
import { normalizeDeckBoard } from './deckBoardLayout';
import { getDeckCardSection } from './deckSectionLayouts';

type IsLandscape = (name: string) => boolean;

interface DeckStackPosition extends GridPosition {
  board: ActiveBoard;
  landscape: boolean;
}

interface PhysicalStack {
  position: DeckStackPosition;
  cards: CanvasCardInstance[];
}

interface SelectedStack extends PhysicalStack {
  selectedCount: number;
}

export function getDeckStackPosition(card: CanvasCardInstance, isLandscape: IsLandscape): DeckStackPosition {
  const landscape = isLandscape(card.cardName);
  const size = getCardPixelSize(landscape);
  return {
    board: card.board === 'avatar' ? 'avatar' : normalizeDeckBoard(card.board), landscape,
    ...pixelsToSnapGrid(card.x + size.width / 2, card.y + size.height / 2, landscape),
  };
}

export function deckStackPositionKey(slot: DeckStackPosition, dx = 0, dy = 0): string {
  return `${slot.board}:${slot.landscape}:${slot.x + dx},${slot.y + dy}`;
}

export function deckSelectionPartition(card: CanvasCardInstance, isLandscape: IsLandscape): string {
  return JSON.stringify([getDeckCardSection(card, isLandscape) ?? normalizeDeckBoard(card.board), card.labelId]);
}

export function groupPhysicalCardStacks(cards: readonly CanvasCardInstance[], isLandscape: IsLandscape): PhysicalStack[] {
  const stacks = new Map<string, PhysicalStack>();
  for (const card of cards) {
    const position = getDeckStackPosition(card, isLandscape);
    const key = deckStackPositionKey(position);
    const stack = stacks.get(key) ?? { position, cards: [] };
    stack.cards.push(card);
    stacks.set(key, stack);
  }
  return [...stacks.values()];
}

export function getTopStackCard(cards: readonly CanvasCardInstance[], activeIds?: ReadonlySet<string>): CanvasCardInstance {
  const active = activeIds && cards.filter((card) => activeIds.has(card.id)).at(-1);
  return required(active ?? cards.at(-1));
}

export function getSelectedDeckStacks(area: CanvasArea, selected: ReadonlySet<string>, isLandscape: IsLandscape): SelectedStack[] {
  const physicalStacks = groupPhysicalCardStacks(area.cards.filter((card) => card.board !== 'avatar'), isLandscape);
  return physicalStacks.flatMap((stack) => {
    const selectedCount = stack.cards.filter((card) => selected.has(`${area.id}:${card.id}`)).length;
    return selectedCount ? [{ ...stack, selectedCount }] : [];
  });
}

export function getSortableDeckStacks(stacks: SelectedStack[], isLandscape: IsLandscape): SelectedStack[][] {
  const partitions = new Map<string, SelectedStack[]>();
  for (const stack of stacks) {
    const first = required(stack.cards[0]);
    // A slot permutation needs the whole pile under one label.
    if (stack.selectedCount !== stack.cards.length || stack.cards.some((card) => card.labelId !== first.labelId)) continue;
    const key = `${deckSelectionPartition(first, isLandscape)}:${stack.position.landscape}`;
    const partition = partitions.get(key) ?? [];
    partition.push(stack);
    partitions.set(key, partition);
  }
  return [...partitions.values()].filter((partition) => partition.length > 1);
}

/** Apply sort keys in order to complete stacks, reusing their exact existing anchors. */
export function sortDeckSelection(areas: CanvasArea[], labels: CanvasLabel[], selected: ReadonlySet<string>,
  metadata: readonly Card[], steps: CatalogueLayoutStep[]): { areas: CanvasArea[]; labels: CanvasLabel[] } {
  const byName = new Map(metadata.map((card) => [card.name, card]));
  const isLandscape = (name: string) => byName.get(name)?.guardian.type === 'Site';
  const layout = { columns: 1, steps };
  const axis = getLayoutLeafAxis(layout);
  const nextAreas = areas.map((area) => {
    if (area.type !== 'deck') return area;
    const groups = getSortableDeckStacks(getSelectedDeckStacks(area, selected, isLandscape), isLandscape);
    if (!groups.length) return area;
    const variant = area.deckVariants?.find((entry) => entry.id === area.activeDeckVariantId) ?? area.deckVariants?.[0];
    const activeIds = new Set(variant?.activeCardIds);
    const moved = new Map<string, CanvasCardInstance>();
    for (const group of groups) {
      const slots = [...group].sort(({ position: left }, { position: right }) => axis !== 'horizontal'
        ? left.y - right.y || left.x - right.x : left.x - right.x || left.y - right.y);
      const entries = group.map((stack) => {
        const top = getTopStackCard(stack.cards, activeIds);
        return { stack, ...getCatalogueLayoutCard(top.cardName, byName.get(top.cardName)) };
      });
      const translated = buildCatalogueGroups(entries, layout).cards.map(({ stack }, index) => {
        const target = required(slots[index]);
        const anchor = required(stack.cards[0]);
        const destination = required(target.cards[0]);
        const dx = destination.x - anchor.x;
        const dy = destination.y - anchor.y;
        return {
          key: deckStackPositionKey(target.position),
          cards: dx || dy ? stack.cards.map((card) => ({ ...card, x: card.x + dx, y: card.y + dy })) : [],
        };
      });
      // Legacy stacks may straddle a snap boundary at an exact target anchor.
      if (translated.some(({ key, cards }) => cards.some((card) => deckStackPositionKey(getDeckStackPosition(card, isLandscape)) !== key))) continue;
      for (const { cards } of translated) for (const card of cards) moved.set(card.id, card);
    }
    return moved.size ? { ...area, cards: area.cards.map((card) => moved.get(card.id) ?? card) } : area;
  });
  return { areas: nextAreas, labels };
}
