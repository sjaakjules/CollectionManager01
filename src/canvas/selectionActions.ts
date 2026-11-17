import { createSelectionLayout } from '@/data/catalogueLayout';
import type { Card, CanvasLabel } from '@/data/dataModels';
import type { CanvasArea } from './canvasAreas';
import { deckSelectionPartition, getSelectedDeckStacks, getSortableDeckStacks, sortDeckSelection } from './cardStacks';
import { arrangeDeckSelection, type SelectionTitleSize } from './selectionLayout';

export const DECK_QUICK_SORT_FIELDS = ['name', 'type', 'cost', 'power', 'element', 'threshold', 'rarity', 'set'] as const;
export type DeckQuickSortField = typeof DECK_QUICK_SORT_FIELDS[number];

function getCleanUpGroups(areaId: string, stacks: ReturnType<typeof getSelectedDeckStacks>, selected: ReadonlySet<string>,
  isLandscape: (name: string) => boolean) {
  const groups = new Map<string, { keys: string[]; positions: Set<number> }>();
  for (const [position, stack] of stacks.entries()) {
    for (const card of stack.cards) {
      const key = `${areaId}:${card.id}`;
      if (!selected.has(key)) continue;
      const partition = deckSelectionPartition(card, isLandscape);
      const group = groups.get(partition) ?? { keys: [], positions: new Set<number>() };
      group.keys.push(key);
      group.positions.add(position);
      groups.set(partition, group);
    }
  }
  return [...groups.values()].filter((group) => group.positions.size > 1);
}

export function getDeckSelectionActions(areas: readonly CanvasArea[], selected: ReadonlySet<string>, metadata: readonly Card[]): {
  canLayout: boolean; canQuickSort: boolean; canCleanUp: boolean;
} {
  const byName = new Map(metadata.map((card) => [card.name, card]));
  const isLandscape = (name: string) => byName.get(name)?.guardian.type === 'Site';
  let positions = 0;
  let canQuickSort = false;
  let canCleanUp = false;
  for (const area of areas) {
    if (area.type !== 'deck') continue;
    const stacks = getSelectedDeckStacks(area, selected, isLandscape);
    positions += stacks.length;
    canQuickSort ||= getSortableDeckStacks(stacks, isLandscape).length > 0;
    canCleanUp ||= stacks.length > 1 && getCleanUpGroups(area.id, stacks, selected, isLandscape).length > 0;
  }
  return { canLayout: positions > 1, canQuickSort, canCleanUp };
}

export function quickSortDeckSelection(areas: CanvasArea[], labels: CanvasLabel[], selected: ReadonlySet<string>,
  metadata: readonly Card[], field: DeckQuickSortField): { areas: CanvasArea[]; labels: CanvasLabel[] } {
  return sortDeckSelection(areas, labels, selected, metadata, [{ field, mode: 'sort', direction: 'asc', axis: 'vertical' }]);
}

export function cleanUpDeckSelection(areas: CanvasArea[], labels: CanvasLabel[], selected: ReadonlySet<string>,
  metadata: readonly Card[], viewportAspect: number, titleSize?: SelectionTitleSize): { areas: CanvasArea[]; labels: CanvasLabel[] } {
  const byName = new Map(metadata.map((card) => [card.name, card]));
  const isLandscape = (name: string) => byName.get(name)?.guardian.type === 'Site';
  const keys = new Set(areas.flatMap((area) => {
    if (area.type !== 'deck') return [];
    const stacks = getSelectedDeckStacks(area, selected, isLandscape);
    return getCleanUpGroups(area.id, stacks, selected, isLandscape).flatMap((group) => group.keys);
  }));
  if (!keys.size) return { areas, labels };
  return arrangeDeckSelection(areas, labels, keys, metadata, { ...createSelectionLayout(), clean: true }, viewportAspect, titleSize);
}
