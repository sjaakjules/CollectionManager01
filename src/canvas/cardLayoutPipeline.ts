import {
  buildCatalogueGroups, getCatalogueLayoutCard, getLayoutCell, getLayoutLeafAxis, getLayoutStepAxis, LAYOUT_COLUMNS_MAX,
  type CatalogueGroup, type CatalogueLayoutCard, type CatalogueLayoutConfig, type LayoutAxis,
} from '@/data/catalogueLayout';
import { isSiteType, type Card } from '@/data/dataModels';
import {
  getCardCellSpacing, getCardPixelSize, getStackFan, SNAP_GRID, snapCardToGrid, snapGridToPixels, type GridPosition,
} from '@/rendering/Grid';
import { required } from '@/utils/required';
import type { CanvasAreaBounds, CanvasCardInstance } from './canvasAreas';
import { getTopStackCard, groupPhysicalCardStacks } from './cardStacks';
import { DECK_BOARD_INNER_PADDING, DECK_SECTION_HEADER_HEIGHT, normalizeDeckBoard } from './deckBoardLayout';

interface Footprint {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface LayoutStack extends CatalogueLayoutCard {
  cards: CanvasCardInstance[];
  landscape: boolean;
  footprint: Footprint;
  /** Snap position of an existing pile, relative to which all its offsets are kept. */
  reference?: GridPosition;
}

interface LayoutPlacement extends GridPosition {
  stack: LayoutStack;
}

interface LayoutBlock extends Footprint {
  placements: LayoutPlacement[];
}

interface CardBasis extends GridPosition {
  pitchX: number;
  pitchY: number;
}

interface CardLayoutOptions {
  region: CanvasAreaBounds;
  /** World position of the first content edge. Defaults to below the section header. */
  origin?: GridPosition;
  /** Keep the first snap row when regenerating an existing section. */
  preserveTopRow?: boolean;
  aspectRatio?: number;
  stackMode?: 'copies' | 'existing';
  activeCardIds?: ReadonlySet<string>;
}

function makeStack(cards: CanvasCardInstance[], resolveCard: (name: string) => Card | undefined,
  reference?: GridPosition, activeCardIds?: ReadonlySet<string>): LayoutStack {
  const top = getTopStackCard(cards, activeCardIds);
  const card = getCatalogueLayoutCard(top.cardName, resolveCard(top.cardName));
  const landscape = isSiteType(card.type);
  const { width, height } = getCardPixelSize(landscape);
  const { overhang } = getStackFan(cards.length, landscape);
  const xOffsets = reference ? cards.map((instance) => instance.x - reference.x) : [0];
  const yOffsets = reference ? cards.map((instance) => instance.y - reference.y) : [0];
  return {
    ...card, cards, landscape, reference, footprint: {
      left: Math.min(...xOffsets), right: Math.max(...xOffsets) + width,
      top: Math.min(...yOffsets) - overhang, bottom: Math.max(...yOffsets) + height + overhang,
    },
  };
}

function groupStacks(cards: readonly CanvasCardInstance[], resolveCard: (name: string) => Card | undefined,
  mode: CardLayoutOptions['stackMode'], activeCardIds?: ReadonlySet<string>): LayoutStack[] {
  if (mode === 'existing') {
    const isLandscape = (name: string) => resolveCard(name)?.guardian.type === 'Site';
    return groupPhysicalCardStacks(cards, isLandscape).map(({ position, cards }) => {
      const center = snapGridToPixels(position.x, position.y, position.landscape);
      const size = getCardPixelSize(position.landscape);
      const reference = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
      return makeStack(cards, resolveCard, reference, activeCardIds);
    });
  }
  const stacks = new Map<string, CanvasCardInstance[]>();
  for (const instance of cards) {
    const board = instance.board === 'avatar' ? 'avatar' : normalizeDeckBoard(instance.board);
    const key = JSON.stringify([instance.cardName, board, instance.labelId]);
    const stack = stacks.get(key) ?? [];
    stack.push(instance);
    stacks.set(key, stack);
  }
  return [...stacks.values()].map((stack) => makeStack(stack, resolveCard));
}

function roundUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function emptyFootprint(): Footprint {
  return { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
}

function extendFootprint(bounds: Footprint, item: Footprint, x: number, y: number): void {
  bounds.left = Math.min(bounds.left, x + item.left);
  bounds.top = Math.min(bounds.top, y + item.top);
  bounds.right = Math.max(bounds.right, x + item.right);
  bounds.bottom = Math.max(bounds.bottom, y + item.bottom);
}

function cardBasis(origin: GridPosition, landscape: boolean, footprint: Footprint): CardBasis {
  const x = origin.x - footprint.left;
  const y = origin.y - footprint.top;
  const snapped = snapCardToGrid(x, y, landscape);
  const spacing = getCardCellSpacing(landscape);
  return {
    x: snapped.x - origin.x + (snapped.x < x ? SNAP_GRID.width : 0),
    y: snapped.y - origin.y + (snapped.y < y ? SNAP_GRID.height : 0),
    pitchX: spacing.x * SNAP_GRID.width, pitchY: spacing.y * SNAP_GRID.height,
  };
}

function measureCards(stacks: LayoutStack[], bases: ReadonlyMap<boolean, CardBasis>, axis: LayoutAxis | undefined,
  pitchY: number, columns: number): LayoutBlock {
  const block: LayoutBlock = { ...emptyFootprint(), placements: [] };
  const cells = stacks.map((stack) => ({ stack, ...required(bases.get(stack.landscape)) }));
  const left = Math.min(...cells.map((cell) => cell.x + cell.stack.footprint.left));
  const right = Math.max(...cells.map((cell) => cell.x + cell.stack.footprint.right));
  const pitchX = Math.max(roundUp(right - left, SNAP_GRID.width), ...cells.map((cell) => cell.pitchX));
  for (const [index, cell] of cells.entries()) {
    const { column, row } = getLayoutCell(index, cells.length, columns, axis);
    const x = cell.x + column * pitchX;
    const y = cell.y + row * pitchY;
    extendFootprint(block, cell.stack.footprint, x, y);
    block.placements.push({ stack: cell.stack, x, y });
  }
  return block;
}

/** Flow siblings down or across, wrapping in the other direction at the candidate size. */
function packBlocks(children: LayoutBlock[], axis: LayoutAxis, limit: number): LayoutBlock {
  const block: LayoutBlock = { ...emptyFootprint(), placements: [] };
  const horizontal = axis === 'horizontal';
  const mainStep = horizontal ? SNAP_GRID.width : SNAP_GRID.height;
  const crossStep = horizontal ? SNAP_GRID.height : SNAP_GRID.width;
  const crossStart = Math.min(...children.map((child) => horizontal ? child.top : child.left));
  let lineStart = Infinity;
  let lineEnd = -Infinity;
  let crossEnd = -Infinity;
  let cross = 0;
  for (const child of children) {
    const start = horizontal ? child.left : child.top;
    const end = horizontal ? child.right : child.bottom;
    let main = lineEnd === -Infinity ? 0 : roundUp(lineEnd + mainStep - start, mainStep);
    if (main > 0 && main + end - lineStart > limit) {
      main = 0;
      cross = roundUp(crossEnd + crossStep - crossStart, crossStep);
      lineStart = Infinity;
      crossEnd = -Infinity;
    }
    lineStart = Math.min(lineStart, main + start);
    lineEnd = main + end;
    crossEnd = Math.max(crossEnd, cross + (horizontal ? child.bottom : child.right));
    const x = horizontal ? main : cross;
    const y = horizontal ? cross : main;
    extendFootprint(block, child, x, y);
    for (const point of child.placements) block.placements.push({ stack: point.stack, x: x + point.x, y: y + point.y });
  }
  return block;
}

function largestLeaf(group: CatalogueGroup<LayoutStack>): number {
  return group.step ? Math.max(...group.children.map(largestLeaf)) : group.cards.length;
}

function bestFit(hierarchy: CatalogueGroup<LayoutStack>, bases: ReadonlyMap<boolean, CardBasis>, layout: CatalogueLayoutConfig,
  aspect: number, pitchX: number, pitchY: number, count: number): LayoutBlock {
  const axis = getLayoutLeafAxis(layout);
  const maxColumns = Math.min(largestLeaf(hierarchy), layout.columnMode === 'auto' ? LAYOUT_COLUMNS_MAX : layout.columns);
  const scales = hierarchy.step ? [0.6, 0.8, 1, 1.3, 1.7, 2.2, Infinity] : [Infinity];
  // Leaf widths and shelf breaks vary independently. A limit on leaf columns never caps the whole board.
  const idealWidth = Math.sqrt(count * pitchX * pitchY * aspect);
  let best: LayoutBlock | undefined;
  let bestScore = Infinity;
  for (let columns = 1; columns <= maxColumns; columns++) {
    const leaves = new Map<CatalogueGroup<LayoutStack>, LayoutBlock>();
    function measure(group: CatalogueGroup<LayoutStack>, width: number, height: number): LayoutBlock {
      if (!group.step) {
        let leaf = leaves.get(group);
        if (!leaf) {
          leaf = measureCards(group.cards, bases, axis, pitchY, columns);
          leaves.set(group, leaf);
        }
        return leaf;
      }
      const direction = getLayoutStepAxis(group.step);
      const limit = direction === 'horizontal' ? width : group.step.field === 'band' ? Infinity : height;
      return packBlocks(group.children.map((child) => measure(child, width, height)), direction, limit);
    }
    for (const scale of scales) {
      const width = idealWidth * scale;
      const block = measure(hierarchy, width, width / aspect);
      const actualWidth = block.right - block.left;
      const actualHeight = block.bottom - block.top;
      const score = Math.max(actualWidth / aspect, actualHeight) + Math.sqrt(actualWidth * actualHeight) * 0.025;
      if (score < bestScore) {
        best = block;
        bestScore = score;
      }
    }
  }
  return required(best);
}

/** Compute snapped positions using real card footprints and the viewport shape. */
export function arrangeCardsByLayout(
  cards: readonly CanvasCardInstance[], resolveCard: (name: string) => Card | undefined, layout: CatalogueLayoutConfig,
  { region, origin, preserveTopRow, aspectRatio = 16 / 9, stackMode = 'copies', activeCardIds }: CardLayoutOptions,
): Map<string, GridPosition> {
  if (!cards.length) return new Map();
  const stacks = groupStacks(cards, resolveCard, stackMode, activeCardIds);
  const footprints = new Map<boolean, Footprint>();
  for (const stack of stacks) {
    const footprint = footprints.get(stack.landscape) ?? emptyFootprint();
    extendFootprint(footprint, stack.footprint, 0, 0);
    footprints.set(stack.landscape, footprint);
  }
  const edge = origin ?? (preserveTopRow ? {
    x: Math.min(...cards.map((card) => card.x)) + Math.min(...[...footprints.values()].map((shape) => shape.left)),
    y: Math.min(...cards.map((card) => card.y)) + Math.min(...[...footprints.values()].map((shape) => shape.top)),
  } : { x: region.x + DECK_BOARD_INNER_PADDING, y: region.y + DECK_SECTION_HEADER_HEIGHT });
  // Equal orientations share rows and reserve the full fan and offsets of their largest pile.
  const bases = new Map<boolean, CardBasis>();
  const occupied = emptyFootprint();
  for (const [landscape, footprint] of footprints) {
    const basis = cardBasis(edge, landscape, footprint);
    bases.set(landscape, basis);
    extendFootprint(occupied, footprint, basis.x, basis.y);
  }
  // A capped fan can fill the entire cell height. Only widen the pitch when
  // mixed orientations or existing off-grid offsets need the extra space.
  const pitchX = Math.max(roundUp(occupied.right - occupied.left, SNAP_GRID.width), ...[...bases.values()].map((basis) => basis.pitchX));
  const pitchY = Math.max(roundUp(occupied.bottom - occupied.top, SNAP_GRID.height), ...[...bases.values()].map((basis) => basis.pitchY));
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9;
  const block = bestFit(buildCatalogueGroups(stacks, layout), bases, layout, aspect, pitchX, pitchY, stacks.length);
  const result = new Map<string, GridPosition>();
  for (const { stack, x, y } of block.placements) {
    const point = { x: edge.x + x, y: edge.y + y };
    for (const card of stack.cards) result.set(card.id, stack.reference ? {
      x: point.x + card.x - stack.reference.x, y: point.y + card.y - stack.reference.y,
    } : point);
  }
  return result;
}
