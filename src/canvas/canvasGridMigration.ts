import type { Card, UserData } from '@/data/dataModels';
import { CANVAS_GRID_VERSION } from '@/data/canvasGridVersion';
import { getCardPixelSize, SNAP_GRID, type GridPosition } from '@/rendering/Grid';
import type { CanvasArea, CanvasAreaBounds, DeckRegionBounds } from './canvasAreas';
import { normalizeDeckRegionBounds } from './deckBoardLayout';
import { normalizeDeckLayoutProfiles } from './deckLayoutProfiles';
import { DECK_LAYOUT_SECTIONS, normalizeDeckSectionLayouts } from './deckSectionLayouts';

export { CANVAS_GRID_VERSION };
const LEGACY_GRID = 55;
const PREVIOUS_GRID_SIZES: Readonly<Partial<Record<number, number>>> = { 2: 75, 3: 65 };
const devices = ['phone', 'desktop'] as const;

function scale(value: number, from: number, to: number, centerOffset = 0): number {
  return Number.isFinite(value) ? (value + centerOffset) / from * to - centerOffset : value;
}

function mapPoint(point: GridPosition, from: number): GridPosition {
  return { x: scale(point.x, from, SNAP_GRID.width), y: scale(point.y, from, SNAP_GRID.height) };
}

function mapBounds(bounds: CanvasAreaBounds, from: number): CanvasAreaBounds {
  return { ...mapPoint(bounds, from), width: scale(bounds.width, from, SNAP_GRID.width), height: scale(bounds.height, from, SNAP_GRID.height) };
}

function mapRegions(regions: DeckRegionBounds, from: number): DeckRegionBounds {
  return Object.fromEntries(Object.entries(regions).map(([key, rect]) => [key, mapBounds(rect, from)]));
}

function mapPositions(positions: Record<string, GridPosition>, map: (point: GridPosition, id: string) => GridPosition) {
  return Object.fromEntries(Object.entries(positions).map(([id, point]) => [id, map(point, id)]));
}

function distanceToSourceLattice(point: GridPosition, landscape: boolean, from: number): number {
  const size = getCardPixelSize(landscape);
  const x = point.x + size.width / 2 - (landscape ? from / 2 : 0);
  const y = point.y + size.height / 2 - (landscape ? 0 : from / 2);
  const dx = x - Math.round(x / from) * from;
  const dy = y - Math.round(y / from) * from;
  return dx * dx + dy * dy;
}

function preferLandscape(point: GridPosition, from: number): boolean {
  return distanceToSourceLattice(point, true, from) < distanceToSourceLattice(point, false, from);
}

function mapCard(point: GridPosition, landscape: boolean, from: number): GridPosition {
  const size = getCardPixelSize(landscape);
  // Position snapshots store top-left coordinates, while the snap grid uses centers.
  return { x: scale(point.x, from, SNAP_GRID.width, size.width / 2), y: scale(point.y, from, SNAP_GRID.height, size.height / 2) };
}

function mapArea(area: CanvasArea, orientation: Map<string, boolean>, from: number): CanvasArea {
  const cards = Array.isArray(area.cards) ? area.cards : [];
  const landscapeById = new Map(cards.map(card => [card.id, card.board === 'avatar' ? false
    : orientation.get(card.cardName) ?? preferLandscape(card, from)]));
  const cardPosition = (point: GridPosition, id: string) => mapCard(point, landscapeById.get(id) ?? preferLandscape(point, from), from);
  const labelPosition = (point: GridPosition) => mapPoint(point, from);
  const regions = normalizeDeckRegionBounds(area.deckRegionBounds);
  const profiles = normalizeDeckLayoutProfiles(area.layoutProfiles);
  const sections = normalizeDeckSectionLayouts(area.sectionLayouts);
  for (const device of devices) {
    const profile = profiles?.[device];
    if (profile) {
      profile.bounds = mapBounds(profile.bounds, from);
      profile.regions = mapRegions(profile.regions, from);
      profile.cards = mapPositions(profile.cards, cardPosition);
      profile.labels = mapPositions(profile.labels, labelPosition);
    }
  }
  for (const section of DECK_LAYOUT_SECTIONS) for (const tab of sections?.[section]?.tabs ?? []) {
    for (const device of devices) {
      const snapshot = tab.positions?.[device];
      if (!snapshot) continue;
      snapshot.cards = mapPositions(snapshot.cards, point => mapCard(point, section === 'atlas', from));
      snapshot.labels = mapPositions(snapshot.labels, labelPosition);
    }
  }
  return { ...area,
    ...(area.bounds ? { bounds: mapBounds(area.bounds, from) } : {}),
    ...(regions ? { deckRegionBounds: mapRegions(regions, from) } : {}),
    ...(profiles ? { layoutProfiles: profiles } : {}),
    ...(sections ? { sectionLayouts: sections } : {}),
    cards: cards.map(card => ({ ...card, ...cardPosition(card, card.id) })),
  };
}

/** Remap versioned canvas positions around card centers while preserving deck contents. */
export function migrateCanvasGrid(data: UserData, metadata: readonly Card[] = []): UserData {
  if (Number.isInteger(data.gridVersion) && (data.gridVersion ?? 0) >= CANVAS_GRID_VERSION) return data;

  const from = PREVIOUS_GRID_SIZES[data.gridVersion ?? 0] ?? LEGACY_GRID;
  const orientation = new Map(metadata.map(card => [card.name, card.guardian.type === 'Site']));
  // Startup may load saves before the catalogue. Identify the old lattice from
  // its distinct top-left offsets and use that orientation across all snapshots.
  const latticeScores = new Map<string, number>();
  for (const area of data.canvasAreas ?? []) for (const card of Array.isArray(area.cards) ? area.cards : []) {
    if (card.board === 'avatar' || orientation.has(card.cardName) || !Number.isFinite(card.x) || !Number.isFinite(card.y)) continue;
    const delta = distanceToSourceLattice(card, false, from) - distanceToSourceLattice(card, true, from);
    latticeScores.set(card.cardName, (latticeScores.get(card.cardName) ?? 0) + delta);
  }
  for (const [name, score] of latticeScores) orientation.set(name, score > 0);
  return { ...data, gridVersion: CANVAS_GRID_VERSION,
    ...(data.canvasAreas ? { canvasAreas: data.canvasAreas.map(area => mapArea(area, orientation, from)) } : {}),
    ...(data.canvasLabels ? { canvasLabels: data.canvasLabels.map(label => ({ ...label, ...mapPoint(label, from) })) } : {}),
  };
}
