import {
  applyCardFilters,
  createEmptyCardFilterCriteria,
  type CardFilterClause,
} from "@/data/cardFilters";
import type { Card } from "@/data/dataModels";

export function countFilterClauseMatches(cards: Card[], clause: CardFilterClause): number {
  if (!clause.enabled) return 0;
  return applyCardFilters(cards, {
    draft: createEmptyCardFilterCriteria(),
    clauses: [clause],
  }).length;
}

export function shouldDeleteDraggedFilterChip(
  origin: { x: number; y: number },
  current: { x: number; y: number },
  thresholdPx = 42,
): boolean {
  return Math.hypot(current.x - origin.x, current.y - origin.y) >= thresholdPx;
}

