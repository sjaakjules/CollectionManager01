import type { CanvasLabel } from '@/data/dataModels';
import type { CanvasArea, DeckLayoutProfile, DeckLayoutProfiles, DeckLayoutSnapshot } from './canvasAreas';
import { normalizeDeckRegionBounds } from './deckBoardLayout';

function readPositions(value: unknown): Record<string, {x: number; y: number}> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, point]) => {
    if (!point || typeof point !== 'object') return [];
    const {x, y} = point as Record<string, unknown>;
    return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
      ? [[id, {x, y}]] : [];
  }));
}

export function normalizeDeckLayoutProfiles(value: unknown): DeckLayoutProfiles | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  if (input.source !== 'phone' && input.source !== 'desktop') return undefined;
  const result: DeckLayoutProfiles = {source: input.source};
  for (const profile of ['phone', 'desktop'] as const) {
    const raw = input[profile];
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const bounds = normalizeDeckRegionBounds({mainboard: record.bounds})?.mainboard;
    if (!bounds) continue;
    result[profile] = {bounds, regions: normalizeDeckRegionBounds(record.regions) ?? {}, cards: readPositions(record.cards), labels: readPositions(record.labels)};
  }
  return result[result.source] ? result : undefined;
}

/** Only positions are profiled; deck contents, memberships and variants stay shared. */
export function captureDeckLayout(area: CanvasArea, labels: CanvasLabel[]): DeckLayoutSnapshot {
  return {bounds: {...area.bounds}, regions: normalizeDeckRegionBounds(area.deckRegionBounds) ?? {},
    cards: Object.fromEntries(area.cards.map(card => [card.id, {x: card.x, y: card.y}])),
    labels: Object.fromEntries(labels.filter(label => label.areaId === area.id).map(label => [label.id, {x: label.x, y: label.y}]))};
}

export function saveDeckLayoutProfile(area: CanvasArea, labels: CanvasLabel[], profile: DeckLayoutProfile): void {
  if (area.type !== 'deck') return;
  area.layoutProfiles ??= {source: profile};
  area.layoutProfiles[profile] = captureDeckLayout(area, labels);
}

/** Copies join their source stack in every existing layout, without forking one. */
export function inheritDeckLayoutPosition(area: CanvasArea, sourceId: string, copyId: string): void {
  for (const profile of ['phone', 'desktop'] as const) {
    const layout = area.layoutProfiles?.[profile];
    const position = layout?.cards[sourceId];
    if (layout && position) layout.cards[copyId] = {...position};
  }
}

/** Until a device type edits, it follows the first editor's shared arrangement. */
export function applyDeckLayoutProfile(area: CanvasArea, labels: CanvasLabel[], profile: DeckLayoutProfile): void {
  const profiles = area.layoutProfiles;
  const layout = profiles?.[profile] ?? (profiles && profiles[profiles.source]);
  if (!layout) return;
  area.bounds = {...layout.bounds};
  area.deckRegionBounds = normalizeDeckRegionBounds(layout.regions) ?? {};
  for (const card of area.cards) {
    const position = layout.cards[card.id];
    if (position) { card.x = position.x; card.y = position.y; }
  }
  applyDeckLabelProfile(area, labels, profile);
}

export function applyDeckLabelProfile(area: CanvasArea, labels: CanvasLabel[], profile: DeckLayoutProfile): void {
  const profiles = area.layoutProfiles;
  const layout = profiles?.[profile] ?? (profiles && profiles[profiles.source]);
  if (!layout) return;
  for (const label of labels) {
    if (label.areaId !== area.id) continue;
    const position = layout.labels[label.id];
    if (position) { label.x = position.x; label.y = position.y; }
  }
}
