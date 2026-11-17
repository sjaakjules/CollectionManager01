import type { CanvasLabel } from '@/data/dataModels';
import type { CanvasArea, CanvasCardInstance, DeckLayoutProfile, DeckRegionBounds } from './canvasAreas';
import { normalizeDeckBoard } from './deckBoardLayout';
import { readCanvasPositions } from './deckLayoutProfiles';
import { getLabelFamily } from './labelRegions';
import { createDefaultCatalogueLayout, createSpellbookLayout, ensureCatalogueLayout, type CatalogueLayoutConfig } from '@/data/catalogueLayout';

export const DECK_LAYOUT_SECTIONS = ['spellbook', 'atlas'] as const;
export type DeckLayoutSection = (typeof DECK_LAYOUT_SECTIONS)[number];
export type SpellbookPreset = 'cost' | 'threshold';
export type CanvasPoint = { x: number; y: number };
export interface DeckSectionLayoutRef { section: DeckLayoutSection; id: string }

interface SectionPositions {
  cards: Record<string, CanvasPoint>;
  labels: Record<string, CanvasPoint>;
}

interface SectionPositionProfiles {
  source: DeckLayoutProfile;
  desktop?: SectionPositions;
  phone?: SectionPositions;
}

export interface DeckSectionLayoutTab {
  id: string;
  name: string;
  mode?: 'automatic' | 'custom';
  layout?: CatalogueLayoutConfig;
  positions?: SectionPositionProfiles;
  /** Label assignments belong to the tab and are shared between devices. */
  cardLabels?: Record<string, string>;
}

export function getDeckSectionTabMode(tab: DeckSectionLayoutTab): 'automatic' | 'custom' {
  return tab.mode ?? (tab.id === 'cost' || tab.id === 'threshold' ? 'automatic' : 'custom');
}

export function getDeckSectionTabLayout(tab: DeckSectionLayoutTab): CatalogueLayoutConfig {
  return tab.layout ?? (tab.id === 'cost' || tab.id === 'threshold'
    ? createSpellbookLayout(tab.id) : createDefaultCatalogueLayout());
}

interface DeckSectionLayoutSet {
  activeId: string;
  tabs: DeckSectionLayoutTab[];
}

export type DeckSectionLayouts = Partial<Record<DeckLayoutSection, DeckSectionLayoutSet>>;
const DEFAULT_ID = 'default';
export const SECTION_LAYOUT_NAME_LIMIT = 48;
const devices = ['phone', 'desktop'] as const;

type IsLandscape = (name: string) => boolean;

function defaultTabs(section: DeckLayoutSection): DeckSectionLayoutTab[] {
  const tabs = [{ id: DEFAULT_ID, name: 'Default' }];
  if (section === 'spellbook') tabs.push({ id: 'cost', name: 'Cost' }, { id: 'threshold', name: 'Threshold' });
  return tabs;
}

export function getDeckSectionTabs(area: CanvasArea, section: DeckLayoutSection): DeckSectionLayoutSet {
  return area.sectionLayouts?.[section] ?? { activeId: DEFAULT_ID, tabs: defaultTabs(section) };
}

export function ensureDeckSectionTabs(area: CanvasArea, section: DeckLayoutSection): DeckSectionLayoutSet {
  area.sectionLayouts ??= {};
  return area.sectionLayouts[section] ??= getDeckSectionTabs(area, section);
}

export function normalizeSectionLayoutName(value: unknown): string {
  return typeof value === 'string' ? Array.from(value.trim()).slice(0, SECTION_LAYOUT_NAME_LIMIT).join('').trimEnd() : '';
}

export function getSpellbookPreset(section: DeckLayoutSection, id: string): SpellbookPreset | undefined {
  return section === 'spellbook' && (id === 'cost' || id === 'threshold') ? id : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeDeckSectionLayouts(value: unknown): DeckSectionLayouts | undefined {
  const input = readRecord(value);
  const result: DeckSectionLayouts = {};
  for (const section of DECK_LAYOUT_SECTIONS) {
    const set = readRecord(input[section]);
    if (!Array.isArray(set.tabs)) continue;
    const tabs = new Map(defaultTabs(section).map(tab => [tab.id, tab]));
    for (const raw of set.tabs) {
      const record = readRecord(raw);
      const { id } = record;
      const name = normalizeSectionLayoutName(record.name);
      if (typeof id !== 'string' || !id || !name) continue;
      const tab: DeckSectionLayoutTab = { id, name };
      if (record.mode === 'automatic' || record.mode === 'custom') tab.mode = record.mode;
      if (record.layout && typeof record.layout === 'object') tab.layout = ensureCatalogueLayout(record.layout);
      const positions = readRecord(record.positions);
      const source = positions.source;
      if (source === 'desktop' || source === 'phone') {
        const profiles: SectionPositionProfiles = { source };
        for (const device of devices) {
          if (!positions[device]) continue;
          const snapshot = readRecord(positions[device]);
          profiles[device] = { cards: readCanvasPositions(snapshot.cards), labels: readCanvasPositions(snapshot.labels) };
        }
        if (profiles[source]) tab.positions = profiles;
      }
      const cardLabels = Object.fromEntries(Object.entries(readRecord(record.cardLabels))
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
      if (Object.keys(cardLabels).length) tab.cardLabels = cardLabels;
      tabs.set(id, tab);
    }
    const selected = set.activeId;
    result[section] = { activeId: typeof selected === 'string' && tabs.has(selected) ? selected : DEFAULT_ID, tabs: [...tabs.values()] };
  }
  return Object.keys(result).length ? result : undefined;
}

export function getDeckCardSection(card: CanvasCardInstance, isLandscape: IsLandscape): DeckLayoutSection | null {
  if (card.board === 'avatar' || normalizeDeckBoard(card.board) !== 'mainboard') return null;
  return isLandscape(card.cardName) ? 'atlas' : 'spellbook';
}

export function visibleDeckLayoutLabels(labels: CanvasLabel[], areas: CanvasArea[]): CanvasLabel[] {
  if (!labels.some(label => label.deckSectionLayout)) return labels;
  const byId = new Map(areas.map(area => [area.id, area]));
  return labels.filter(label => {
    const ref = label.deckSectionLayout;
    const area = label.areaId ? byId.get(label.areaId) : undefined;
    return !ref || !area || (area.sectionLayouts?.[ref.section]?.activeId ?? DEFAULT_ID) === ref.id;
  });
}

function belongsToTab(label: CanvasLabel, area: CanvasArea, ref: DeckSectionLayoutRef): boolean {
  return label.areaId === area.id && label.deckSectionLayout?.section === ref.section && label.deckSectionLayout.id === ref.id;
}

function getPositions(tab: DeckSectionLayoutTab | undefined, device: DeckLayoutProfile): SectionPositions | undefined {
  const profiles = tab?.positions;
  return profiles && (profiles[device] ?? profiles[profiles.source]);
}

function setPositions(tab: DeckSectionLayoutTab, device: DeckLayoutProfile, positions: SectionPositions): void {
  tab.positions ??= { source: device };
  tab.positions[device] = positions;
}

/** The Default tab keeps any device-specific work saved before tabs existed. */
export function seedDefaultSectionPositions(area: CanvasArea, section: DeckLayoutSection, labels: CanvasLabel[],
  device: DeckLayoutProfile, isLandscape: IsLandscape): void {
  const tab = ensureDeckSectionTabs(area, section).tabs.find(entry => entry.id === DEFAULT_ID);
  const previous = area.layoutProfiles;
  if (!tab || tab.positions || !previous) return;
  const cards = area.cards.filter(card => getDeckCardSection(card, isLandscape) === section);
  const owned = labels.filter(label => belongsToTab(label, area, { section, id: DEFAULT_ID }));
  for (const key of devices) {
    const snapshot = previous[key];
    if (!snapshot || key === device) continue;
    setPositions(tab, key, {
      cards: Object.fromEntries(cards.map(card => [card.id, snapshot.cards[card.id] ?? { x: card.x, y: card.y }])),
      labels: Object.fromEntries(owned.map(label => [label.id, snapshot.labels[label.id] ?? { x: label.x, y: label.y }])),
    });
  }
}

function samePositions(a: Record<string, CanvasPoint>, b: Record<string, CanvasPoint>): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([id, point]) =>
    Object.hasOwn(b, id) && b[id]?.x === point.x && b[id]?.y === point.y);
}

function keepReferences<T>(entries: Record<string, T>, keep: (id: string, value: T) => boolean): Record<string, T> {
  const all = Object.entries(entries);
  const valid = all.filter(([id, value]) => keep(id, value));
  return valid.length === all.length ? entries : Object.fromEntries(valid);
}

/** Legacy labels enter the tab with their whole group. Mixed groups continue to belong to Main. */
export function scopeDeckLayoutLabels(area: CanvasArea, labels: CanvasLabel[], regions: DeckRegionBounds, isLandscape: IsLandscape): boolean {
  const live = visibleDeckLayoutLabels(labels, [area]).filter(label => label.areaId === area.id);
  const main = live.filter(label => normalizeDeckBoard(label.board) === 'mainboard');
  const ids = new Set(main.map(label => label.id));
  const visited = new Set<string>();
  const roots = main.filter(label => !label.parentLabelId || !ids.has(label.parentLabelId));
  let changed = false;
  const assign = (label: CanvasLabel, ref?: DeckSectionLayoutRef) => {
    if (label.deckSectionLayout?.section === ref?.section && label.deckSectionLayout?.id === ref?.id) return;
    label.deckSectionLayout = ref;
    changed = true;
  };
  for (const label of live) if (!ids.has(label.id)) assign(label);
  for (const root of [...roots, ...main]) {
    if (visited.has(root.id)) continue;
    const family = getLabelFamily(main, root.id);
    const sections = new Set(area.cards.filter(card => card.labelId && family.has(card.labelId))
      .map(card => getDeckCardSection(card, isLandscape)).filter(section => section !== null));
    const section = sections.size > 1 ? undefined : sections.size === 1 ? [...sections][0]
      : root.deckSectionLayout?.section ?? DECK_LAYOUT_SECTIONS.find(key => {
        const rect = regions[key];
        return rect && root.x >= rect.x && root.x < rect.x + rect.width && root.y >= rect.y && root.y < rect.y + rect.height;
      });
    const set = section && area.sectionLayouts?.[section];
    const ref = section && set ? { section, id: set.activeId } : undefined;
    for (const label of main) if (family.has(label.id)) {
      assign(label, ref);
      visited.add(label.id);
    }
  }
  return changed;
}

/** Save only placement and label references. Card identities, boards and variants live on the deck. */
export function saveDeckSectionLayouts(area: CanvasArea, labels: CanvasLabel[], device: DeckLayoutProfile, isLandscape: IsLandscape): void {
  for (const section of DECK_LAYOUT_SECTIONS) {
    const set = area.sectionLayouts?.[section];
    if (!set) continue;
    const cards = area.cards.filter(card => getDeckCardSection(card, isLandscape) === section);
    const cardIds = new Set(cards.map(card => card.id));
    for (const tab of set.tabs) {
      const ownLabels = labels.filter(label => belongsToTab(label, area, { section, id: tab.id }));
      const labelIds = new Set(ownLabels.map(label => label.id));
      if (tab.positions) for (const key of devices) {
        const snapshot = tab.positions[key];
        if (!snapshot) continue;
        snapshot.cards = keepReferences(snapshot.cards, id => cardIds.has(id));
        snapshot.labels = keepReferences(snapshot.labels, id => labelIds.has(id));
      }
      if (tab.cardLabels) tab.cardLabels = keepReferences(tab.cardLabels, (cardId, labelId) => cardIds.has(cardId) && labelIds.has(labelId));
      if (tab.id !== set.activeId) continue;
      const current = getPositions(tab, device);
      const next = {
        cards: Object.fromEntries(cards.map(card => [card.id, { x: card.x, y: card.y }])),
        labels: Object.fromEntries(ownLabels.map(label => [label.id, { x: label.x, y: label.y }])),
      };
      if (!current || !samePositions(current.cards, next.cards) || !samePositions(current.labels, next.labels)) setPositions(tab, device, next);
      tab.cardLabels = Object.fromEntries(cards.flatMap(card => card.labelId && labelIds.has(card.labelId) ? [[card.id, card.labelId]] : []));
    }
  }
}

/** Selection is shared, so a device's previous active layout cannot overwrite this tab's geometry. */
export function restoreDeckSectionPositions(area: CanvasArea, labels: CanvasLabel[], device: DeckLayoutProfile,
  isLandscape?: IsLandscape, sections: readonly DeckLayoutSection[] = DECK_LAYOUT_SECTIONS): void {
  for (const section of sections) {
    const set = area.sectionLayouts?.[section];
    if (!set) continue;
    const snapshot = getPositions(set.tabs.find(tab => tab.id === set.activeId), device);
    if (!snapshot) continue;
    if (isLandscape) for (const card of area.cards) {
      if (getDeckCardSection(card, isLandscape) !== section || !Object.hasOwn(snapshot.cards, card.id)) continue;
      Object.assign(card, snapshot.cards[card.id]);
    }
    for (const label of labels) {
      if (!belongsToTab(label, area, { section, id: set.activeId }) || !Object.hasOwn(snapshot.labels, label.id)) continue;
      Object.assign(label, snapshot.labels[label.id]);
    }
  }
}

/** Restore the chosen tab and return any cards that arrived since it was last used. */
export function applyDeckSectionTab(area: CanvasArea, labels: CanvasLabel[], section: DeckLayoutSection,
  tab: DeckSectionLayoutTab, device: DeckLayoutProfile, isLandscape: IsLandscape): CanvasCardInstance[] {
  const byLabel = new Map(labels.filter(label => label.areaId === area.id).map(label => [label.id, label]));
  const snapshot = getPositions(tab, device);
  const unplaced: CanvasCardInstance[] = [];
  for (const card of area.cards) {
    if (getDeckCardSection(card, isLandscape) !== section) continue;
    const previous = card.labelId ? byLabel.get(card.labelId) : undefined;
    if (previous?.deckSectionLayout?.section === section) delete card.labelId;
    const labelId = tab.cardLabels && Object.hasOwn(tab.cardLabels, card.id) ? tab.cardLabels[card.id] : undefined;
    const label = labelId ? byLabel.get(labelId) : undefined;
    if (!card.labelId && label && belongsToTab(label, area, { section, id: tab.id })) card.labelId = label.id;
    if (!snapshot || !Object.hasOwn(snapshot.cards, card.id)) unplaced.push(card);
  }
  ensureDeckSectionTabs(area, section).activeId = tab.id;
  restoreDeckSectionPositions(area, labels, device, isLandscape, [section]);
  return unplaced;
}

/** Moving the section moves every saved arrangement with it on the current device. */
export function translateDeckSectionTabs(area: CanvasArea, section: DeckLayoutSection, device: DeckLayoutProfile, delta: CanvasPoint): void {
  if (!delta.x && !delta.y) return;
  const translate = (points: Record<string, CanvasPoint>) => Object.fromEntries(Object.entries(points)
    .map(([id, point]) => [id, { x: point.x + delta.x, y: point.y + delta.y }]));
  for (const tab of area.sectionLayouts?.[section]?.tabs ?? []) {
    const from = getPositions(tab, device);
    if (from) setPositions(tab, device, { cards: translate(from.cards), labels: translate(from.labels) });
  }
}

export function inheritDeckSectionTabPosition(area: CanvasArea, sourceId: string, copyId: string): void {
  for (const section of DECK_LAYOUT_SECTIONS) for (const tab of area.sectionLayouts?.[section]?.tabs ?? []) {
    for (const device of devices) {
      const snapshot = tab.positions?.[device];
      if (snapshot && Object.hasOwn(snapshot.cards, sourceId)) {
        const point = snapshot.cards[sourceId];
        if (point) snapshot.cards[copyId] = { ...point };
      }
    }
    if (tab.cardLabels && Object.hasOwn(tab.cardLabels, sourceId)) {
      const labelId = tab.cardLabels[sourceId];
      if (labelId) tab.cardLabels[copyId] = labelId;
    }
  }
}
