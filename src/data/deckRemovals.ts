/** Shared guest/account deletion markers prevent startup or login restoring a removed deck. */
import type { CanvasLabel } from './dataModels';

/** Removing a deck leaves its annotations available as ordinary canvas labels. */
export function detachLabelsFromAreas(labels: CanvasLabel[], removedAreaIds: Set<string>): CanvasLabel[] {
  return labels.map((label) => {
    if (!label.areaId || !removedAreaIds.has(label.areaId)) return label;
    const detached = { ...label };
    delete detached.areaId;
    delete detached.board;
    delete detached.parentLabelId;
    delete detached.deckSectionLayout;
    return detached;
  });
}

export function normalizeDeckRemovals(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, date]) =>
    id.trim() && typeof date === 'string' && Number.isFinite(Date.parse(date))));
}

export function mergeDeckRemovals(...values: unknown[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values) {
    for (const [id, date] of Object.entries(normalizeDeckRemovals(value))) {
      if (!result[id] || Date.parse(date) > Date.parse(result[id])) result[id] = date;
    }
  }
  return result;
}
