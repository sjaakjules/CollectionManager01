import type { Card, CanvasLabel } from '@/data/dataModels';
import type { CatalogueLayoutConfig, CatalogueLayoutField, CatalogueLayoutStep } from '@/data/catalogueLayout';
import { getCardPixelSize, SNAP_GRID, type GridPosition } from '@/rendering/Grid';
import { packOrderedGroups } from '@/rendering/orderedPacking';
import { required } from '@/utils/required';
import type { CanvasArea, CanvasAreaBounds, CanvasCardInstance } from './canvasAreas';
import { arrangeCardsByLayout } from './cardLayoutPipeline';
import { deckSelectionPartition, deckStackPositionKey, getDeckStackPosition, sortDeckSelection } from './cardStacks';
import { normalizeDeckBoard } from './deckBoardLayout';
import { getDeckCardSection, visibleDeckLayoutLabels } from './deckSectionLayouts';
import { cardBounds, getLabelFamily, getLabelHeadingBounds, repositionLabelsAfterCardLayout } from './labelRegions';

type IsLandscape = (name: string) => boolean;
export type SelectionTitleSize = (id: string) => { width: number; height: number };

interface SelectionPlacement {
  original: CanvasCardInstance[];
  arranged: CanvasCardInstance[];
}

function enclosingBounds(rects: CanvasAreaBounds[]): CanvasAreaBounds {
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x, y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  };
}

function overlapArea(a: CanvasAreaBounds, b: CanvasAreaBounds, x: number, y: number): number {
  const width = Math.min(a.x + x + a.width, b.x + b.width) - Math.max(a.x + x, b.x);
  const height = Math.min(a.y + y + a.height, b.y + b.height) - Math.max(a.y + y, b.y);
  return Math.max(0, width) * Math.max(0, height);
}

/** Find space at the old selection's center, with at most one card of adjustment. */
function nearbyTranslation(placed: CanvasCardInstance[], occupied: CanvasCardInstance[], old: CanvasAreaBounds,
  isLandscape: IsLandscape, headings: CanvasAreaBounds[], stationaryHeadings: CanvasAreaBounds[]): GridPosition | undefined {
  const rendered = [...cardBounds(placed, isLandscape).values()];
  const next = enclosingBounds(rendered);
  const centerX = Math.round((old.x + old.width / 2 - next.x - next.width / 2) / SNAP_GRID.width);
  const centerY = Math.round((old.y + old.height / 2 - next.y - next.height / 2) / SNAP_GRID.height);
  const sizes = placed.map((card) => getCardPixelSize(isLandscape(card.cardName)));
  const radiusX = Math.ceil(Math.max(...sizes.map((size) => size.width)) / SNAP_GRID.width);
  const radiusY = Math.ceil(Math.max(...sizes.map((size) => size.height)) / SNAP_GRID.height);
  const offsets: GridPosition[] = [];
  for (let y = -radiusY; y <= radiusY; y++) for (let x = -radiusX; x <= radiusX; x++) offsets.push({x, y});
  offsets.sort((left, right) => Math.hypot(left.x * SNAP_GRID.width, left.y * SNAP_GRID.height)
    - Math.hypot(right.x * SNAP_GRID.width, right.y * SNAP_GRID.height));

  const slots = placed.map((card) => getDeckStackPosition(card, isLandscape));
  const reserved = new Set(occupied.map((card) => deckStackPositionKey(getDeckStackPosition(card, isLandscape))));
  const movingRects = [...rendered, ...headings];
  const obstacles = [...cardBounds(occupied, isLandscape).values(), ...stationaryHeadings];
  let closest: GridPosition | undefined;
  let leastOverlap = Infinity;
  for (const offset of offsets) {
    const x = centerX + offset.x;
    const y = centerY + offset.y;
    if (slots.some((slot) => reserved.has(deckStackPositionKey(slot, x, y)))) continue;
    const dx = x * SNAP_GRID.width;
    const dy = y * SNAP_GRID.height;
    let overlap = 0;
    for (const rect of movingRects) for (const obstacle of obstacles) overlap += overlapArea(rect, obstacle, dx, dy);
    if (overlap === 0) return { x: dx, y: dy };
    if (overlap < leastOverlap) {
      closest = { x: dx, y: dy };
      leastOverlap = overlap;
    }
  }
  return closest;
}

function cleanUpSteps(cards: CanvasCardInstance[], isLandscape: IsLandscape): CatalogueLayoutStep[] {
  const fields: CatalogueLayoutField[] = cards.every((card) => isLandscape(card.cardName)) ? ['element']
    : cards.every((card) => !isLandscape(card.cardName)) ? ['cost'] : ['family', 'cost', 'element'];
  return fields.map((field) => ({ field, mode: 'sort', direction: 'asc', axis: 'vertical' }));
}

function packSelectionBlocks(plans: SelectionPlacement[], boundsFor: (plan: SelectionPlacement) => CanvasAreaBounds,
  aspect: number): SelectionPlacement {
  if (plans.length === 1) return required(plans[0]);
  const blocks = plans.map((plan) => ({ plan, bounds: boundsFor(plan) }));
  const { width, height } = SNAP_GRID;
  // An extra cell lets each block align to its own snap offset inside the packed box.
  const boxes = packOrderedGroups(blocks.map(({ bounds }) => ({
    width: Math.ceil(bounds.width / width) + 1, height: Math.ceil(bounds.height / height) + 1,
  })), aspect * height / width, 1);
  const start = enclosingBounds(blocks.map((block) => block.bounds));
  return {
    original: blocks.flatMap(({ plan }) => plan.original),
    arranged: blocks.flatMap(({ plan, bounds }, index) => {
      const box = required(boxes[index]);
      const dx = Math.ceil((start.x + box.x * width - bounds.x) / width) * width;
      const dy = Math.ceil((start.y + box.y * height - bounds.y) / height) * height;
      return plan.arranged.map((card) => ({ ...card, x: card.x + dx, y: card.y + dy }));
    }),
  };
}

/** Arrange compatible cards around their original selection, keeping other cards stationary. */
export function arrangeDeckSelection(areas: CanvasArea[], labels: CanvasLabel[], selected: ReadonlySet<string>,
  metadata: readonly Card[], layout: CatalogueLayoutConfig, viewportAspect = 16 / 9,
  titleSize?: SelectionTitleSize): { areas: CanvasArea[]; labels: CanvasLabel[] } {
  if (!layout.clean && !layout.steps.length) return { areas, labels };
  if (!layout.clean && layout.steps.every((step) => step.mode === 'sort')) {
    return sortDeckSelection(areas, labels, selected, metadata, layout.steps);
  }
  const byName = new Map(metadata.map((card) => [card.name, card]));
  const resolveCard = (name: string) => byName.get(name);
  const isLandscape = (name: string) => resolveCard(name)?.guardian.type === 'Site';
  const visibleLabels = visibleDeckLayoutLabels(labels, areas);
  let nextLabels = labels;
  const nextAreas = areas.map((area) => {
    if (area.type !== 'deck') return area;
    const groups = new Map<string, CanvasCardInstance[]>();
    for (const card of area.cards) {
      if (!selected.has(`${area.id}:${card.id}`) || card.board === 'avatar') continue;
      const key = deckSelectionPartition(card, isLandscape);
      const group = groups.get(key) ?? [];
      group.push(card);
      groups.set(key, group);
    }
    if (!groups.size) return area;
    const originalBounds = cardBounds(area.cards, isLandscape);
    const areaLabels = visibleLabels.filter((label) => label.areaId === area.id);
    const labelsById = new Map(areaLabels.map((label) => [label.id, label]));
    const families = new Map(areaLabels.map((label) => [label.id, getLabelFamily(areaLabels, label.id)]));
    const members = new Map([...families].map(([id, family]) => [id, area.cards.filter((card) => card.labelId && family.has(card.labelId))]));
    const variant = area.deckVariants?.find((entry) => entry.id === area.activeDeckVariantId) ?? area.deckVariants?.[0];
    const activeCardIds = new Set(variant?.activeCardIds);
    const planned = new Map<string, CanvasCardInstance>();
    const movedLabels = new Map<string, CanvasLabel>();

    const originalFor = (cards: CanvasCardInstance[]) => enclosingBounds(cards.map((card) => required(originalBounds.get(card.id))));
    const measureTitle: SelectionTitleSize = (id) => titleSize?.(id) ?? {
      width: Math.max(20, (labelsById.get(id)?.text.length ?? 0) * 10), height: 20,
    };
    const headingBounds = (headings: CanvasLabel[], cards: CanvasCardInstance[]) =>
      [...getLabelHeadingBounds(headings, [{ ...area, cards }], isLandscape, measureTitle).values()];

    function arrangedLabels(plan: SelectionPlacement): CanvasLabel[] {
      const moving = new Set(plan.original.map((card) => card.id));
      return repositionLabelsAfterCardLayout(areaLabels, area.id, plan.original, plan.arranged)
        .filter((label) => {
          const familyCards = members.get(label.id) ?? [];
          return familyCards.length && familyCards.every((card) => moving.has(card.id));
        });
    }

    function blockBounds(plan: SelectionPlacement): CanvasAreaBounds {
      return enclosingBounds([...cardBounds(plan.arranged, isLandscape).values(),
        ...headingBounds(arrangedLabels(plan), plan.arranged)]);
    }

    function place(plan: SelectionPlacement): boolean {
      const moving = new Set(plan.original.map((card) => card.id));
      const occupied = area.cards.filter((card) => !moving.has(card.id)).map((card) => planned.get(card.id) ?? card);
      const labelsToMove = arrangedLabels(plan);
      const movingLabels = new Set(labelsToMove.map((label) => label.id));
      const stationary = areaLabels.filter((label) => !movingLabels.has(label.id)).map((label) => movedLabels.get(label.id) ?? label);
      const offset = nearbyTranslation(plan.arranged, occupied, originalFor(plan.original), isLandscape,
        headingBounds(labelsToMove, plan.arranged), headingBounds(stationary, occupied));
      if (!offset) return false;
      for (const [index, card] of plan.arranged.entries()) {
        const x = card.x + offset.x;
        const y = card.y + offset.y;
        const before = required(plan.original[index]);
        if (x !== before.x || y !== before.y) planned.set(card.id, { ...card, x, y });
      }
      for (const label of labelsToMove) {
        const x = label.x + offset.x;
        const y = label.y + offset.y;
        const before = required(labelsById.get(label.id));
        if (x !== before.x || y !== before.y) movedLabels.set(label.id, { ...label, x, y });
      }
      return true;
    }

    const local: SelectionPlacement[] = [];
    const sections = new Map<string, Map<string, SelectionPlacement[]>>();
    for (const group of groups.values()) {
      const first = required(group[0]);
      const section = getDeckCardSection(first, isLandscape) ?? normalizeDeckBoard(first.board);
      const config = layout.steps.length ? layout : { ...layout, steps: cleanUpSteps(group, isLandscape) };
      const positions = group.length > 1 ? arrangeCardsByLayout(group, resolveCard, config, {
        region: area.bounds, origin: originalFor(group), aspectRatio: viewportAspect,
        stackMode: layout.clean ? 'copies' : 'existing', activeCardIds,
      }) : null;
      const plan = { original: group, arranged: positions ? group.map((card) => ({ ...card, ...required(positions.get(card.id)) })) : group };
      let root = first.labelId;
      const visited = new Set<string>();
      while (root && !visited.has(root)) {
        visited.add(root);
        const parent = labelsById.get(root)?.parentLabelId;
        if (!parent || !labelsById.has(parent)) break;
        root = parent;
      }
      const selectedFamily = !root || (members.get(root) ?? group).every((card) => selected.has(`${area.id}:${card.id}`));
      if (!selectedFamily) { local.push(plan); continue; }
      const families = sections.get(section) ?? new Map<string, SelectionPlacement[]>();
      const family = families.get(root ?? '') ?? [];
      family.push(plan);
      families.set(root ?? '', family);
      sections.set(section, families);
    }
    const byOriginalPosition = (a: SelectionPlacement, b: SelectionPlacement) => {
      const left = originalFor(a.original);
      const right = originalFor(b.original);
      return left.y - right.y || left.x - right.x;
    };
    const pack = (plans: SelectionPlacement[]) => packSelectionBlocks(plans.sort(byOriginalPosition), blockBounds, viewportAspect);
    for (const families of sections.values()) {
      const members = [...families.values()];
      const plans = members.flat();
      if (plans.length === 1) { local.push(required(plans[0])); continue; }
      if (!place(pack(members.map(pack)))) local.push(...plans);
    }
    for (const plan of local) if (plan.original.length > 1) place(plan);
    if (movedLabels.size) nextLabels = nextLabels.map((label) => movedLabels.get(label.id) ?? label);
    if (!planned.size) return area;
    const cards = area.cards.map((card) => planned.get(card.id) ?? card);
    return { ...area, cards };
  });
  return { areas: nextAreas, labels: nextLabels };
}
