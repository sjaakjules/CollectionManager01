import { getThresholdGroup, type Card, type CardSet, type ThresholdGroup, type Thresholds } from './dataModels';

export const CATALOGUE_LAYOUT_FIELDS = ['element', 'family', 'type', 'band', 'cost', 'power', 'threshold', 'rarity', 'set', 'name'] as const;
export type CatalogueLayoutField = typeof CATALOGUE_LAYOUT_FIELDS[number];
export type LayoutAxis = 'vertical' | 'horizontal';
export interface CatalogueLayoutStep {
  field: CatalogueLayoutField;
  mode: 'group' | 'sort';
  direction: 'asc' | 'desc';
  axis?: LayoutAxis;
}
export interface CatalogueLayoutConfig {
  steps: CatalogueLayoutStep[];
  columns: number;
  columnMode?: 'auto' | 'limit';
  /** Stack matching copies before running any selection layout steps. */
  clean?: boolean;
}
export const LAYOUT_COLUMNS_MIN = 1;
export const LAYOUT_COLUMNS_MAX = 16;
export const CATALOGUE_FIELD_LABELS: Record<CatalogueLayoutField, string> = {
  element: 'Element', family: 'Spellbook / Atlas', type: 'Card type', band: 'Spellbook role',
  cost: 'Cost', power: 'Power', threshold: 'Threshold',
  rarity: 'Rarity', set: 'Set', name: 'Name',
};

export const LAYOUT_DIRECTIONS = [
  { arrow: '↑', axis: 'vertical', direction: 'desc', label: 'Values increase upward' },
  { arrow: '↓', axis: 'vertical', direction: 'asc', label: 'Values increase downward' },
  { arrow: '→', axis: 'horizontal', direction: 'asc', label: 'Values increase rightward' },
  { arrow: '←', axis: 'horizontal', direction: 'desc', label: 'Values increase leftward' },
] as const;

export function getLayoutStepAxis(step: CatalogueLayoutStep): LayoutAxis {
  return step.axis ?? (step.mode === 'sort' ? 'horizontal' : 'vertical');
}

/** Older layouts packed top-level groups horizontally, nested groups down and cards across. */
export function resolveLayoutSteps(steps: readonly CatalogueLayoutStep[]): CatalogueLayoutStep[] {
  let hasGroup = false;
  return steps.map((step) => {
    const firstGroup = step.mode === 'group' && !hasGroup;
    if (step.mode === 'group') hasGroup = true;
    return step.axis ? step : { ...step, axis: firstGroup ? 'horizontal' : getLayoutStepAxis(step) };
  });
}

export function getLayoutLeafAxis(config: CatalogueLayoutConfig): LayoutAxis | undefined {
  const primarySort = config.steps.find((step) => step.mode === 'sort');
  return primarySort ? getLayoutStepAxis(primarySort) : undefined;
}

/**
 * The sort axis is where values progress: vertical sorts advance through rows,
 * horizontal sorts through columns. Without a sort, retain ordinary row filling.
 */
export function getLayoutCell(index: number, count: number, columns: number, axis?: LayoutAxis): { column: number; row: number } {
  if (axis !== 'horizontal') {
    // A wide group must not flatten an explicit up/down sort into a single row.
    const perRow = axis === 'vertical' ? Math.min(columns, Math.ceil(count / 2)) : columns;
    return { column: index % perRow, row: Math.floor(index / perRow) };
  }
  // Distribute a ragged final band across every column. Filling only full-height
  // columns would silently shrink a lane and misalign spell/site group widths.
  const columnCount = Math.min(count, columns);
  const rows = Math.floor(count / columnCount);
  const tallerColumns = count % columnCount;
  const tallerCount = tallerColumns * (rows + 1);
  return index < tallerCount
    ? { column: Math.floor(index / (rows + 1)), row: index % (rows + 1) }
    : { column: tallerColumns + Math.floor((index - tallerCount) / rows), row: (index - tallerCount) % rows };
}

export function createDefaultCatalogueLayout(): CatalogueLayoutConfig {
  return { columns: 10, columnMode: 'auto', steps: [
    { field: 'element', mode: 'group', direction: 'asc', axis: 'horizontal' },
    { field: 'family', mode: 'group', direction: 'asc', axis: 'vertical' },
    { field: 'type', mode: 'group', direction: 'asc', axis: 'vertical' },
    { field: 'cost', mode: 'sort', direction: 'asc', axis: 'horizontal' },
    { field: 'name', mode: 'sort', direction: 'asc', axis: 'horizontal' },
  ] };
}

export function createSpellbookLayout(preset: 'cost' | 'threshold'): CatalogueLayoutConfig {
  return { columns: 10, columnMode: 'auto', steps: [
    { field: 'band', mode: 'group', direction: 'asc', axis: 'vertical' },
    { field: preset, mode: 'group', direction: 'asc', axis: 'horizontal' },
    { field: 'name', mode: 'sort', direction: 'asc', axis: 'horizontal' },
  ] };
}

export function createSelectionLayout(): CatalogueLayoutConfig {
  return { steps: [], columns: LAYOUT_COLUMNS_MAX, columnMode: 'auto' };
}

/** Validate saved preferences without changing the shared guest/account contract. */
export function ensureCatalogueLayout(value: unknown): CatalogueLayoutConfig {
  if (!value || typeof value !== 'object') return createDefaultCatalogueLayout();
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.steps)) return createDefaultCatalogueLayout();
  const seen = new Set<string>();
  const steps: CatalogueLayoutStep[] = [];
  for (const raw of record.steps) {
    if (!raw || typeof raw !== 'object') continue;
    const step = raw as Record<string, unknown>;
    if (!CATALOGUE_LAYOUT_FIELDS.includes(step.field as CatalogueLayoutField) || seen.has(String(step.field))) continue;
    seen.add(String(step.field));
    steps.push({
      field: step.field as CatalogueLayoutField,
      mode: step.mode === 'sort' ? 'sort' : 'group',
      direction: step.direction === 'desc' ? 'desc' : 'asc',
      ...(step.axis === 'horizontal' || step.axis === 'vertical' ? { axis: step.axis } : {}),
    });
  }
  const columns = typeof record.columns === 'number' && Number.isFinite(record.columns)
    ? Math.max(LAYOUT_COLUMNS_MIN, Math.min(LAYOUT_COLUMNS_MAX, Math.round(record.columns))) : 10;
  return { steps: resolveLayoutSteps(steps), columns,
    columnMode: record.columnMode === 'auto' ? 'auto' : 'limit',
    ...(record.clean === true ? { clean: true } : {}),
  };
}

/** Insert a palette field or move an existing step to an insertion point. */
export function insertCatalogueLayoutStep(config: CatalogueLayoutConfig, field: CatalogueLayoutField, insertionIndex: number): CatalogueLayoutConfig {
  const resolved = resolveLayoutSteps(config.steps);
  const oldIndex = resolved.findIndex((step) => step.field === field);
  const step = resolved[oldIndex] ?? { field, mode: 'group', direction: 'asc', axis: 'vertical' };
  const steps = resolved.filter((entry) => entry.field !== field);
  const target = Math.max(0, Math.min(steps.length, insertionIndex - (oldIndex >= 0 && oldIndex < insertionIndex ? 1 : 0)));
  steps.splice(target, 0, step);
  return { ...config, steps };
}

export interface CatalogueLayoutCard {
  name: string;
  type: string;
  thresholdGroup: ThresholdGroup;
  thresholds?: Thresholds;
  cost: number | null;
  power?: number | null;
  rarity?: string | null;
  primarySet?: string;
}

export function getCatalogueLayoutCard(name: string, card: Card | undefined): CatalogueLayoutCard {
  const stats = card?.guardian;
  const thresholds = stats?.thresholds;
  return {
    name, type: stats?.type ?? 'Unknown', thresholds,
    thresholdGroup: thresholds ? getThresholdGroup(thresholds) : 'none',
    cost: stats?.cost ?? null, power: stats?.attack, rarity: stats?.rarity,
    primarySet: card?.sets[0]?.name,
  };
}

export interface CatalogueGroup<T> {
  label: string;
  cards: T[];
  children: CatalogueGroup<T>[];
  /** The grouping operation that split this node's children. */
  step?: CatalogueLayoutStep;
}

const ELEMENT_ORDER = ['air', 'earth', 'fire', 'water', 'none', 'multiple'];
const FAMILY_ORDER = ['Avatars', 'Spellbook', 'Atlas'];
const TYPE_ORDER = ['Avatar', 'Minion', 'Magic', 'Aura', 'Artifact', 'Site'];
const SPELLBOOK_BANDS = ['Minions', 'Magic / Auras', 'Artifacts', 'Other'];
const RARITY_ORDER = ['None', 'Ordinary', 'Exceptional', 'Elite', 'Unique'];
export const CATALOGUE_SET_ORDER = [
  'Alpha', 'Beta', 'Arthurian Legends', 'Dragonlord', 'Gothic', 'Frost Mage Vs. Lavamancer', "Baldassare's Travels",
] as const;
const ELEMENT_LABELS: Record<ThresholdGroup, string> = {
  air: 'Air', earth: 'Earth', fire: 'Fire', water: 'Water', none: 'None', multiple: 'Multi',
};
const THRESHOLD_ELEMENTS = ['air', 'earth', 'fire', 'water'] as const;
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function spellbookBand(type: string): string {
  if (type === 'Minion') return 'Minions';
  if (type === 'Magic' || type === 'Aura') return 'Magic / Auras';
  return type === 'Artifact' ? 'Artifacts' : 'Other';
}

function thresholdKey(thresholds: Thresholds | undefined): string {
  const pips = THRESHOLD_ELEMENTS.map((element) => thresholds?.[element] ?? 0);
  const active = pips.filter((value) => value > 0).length;
  const mask = pips.reduce((value, pip, index) => pip > 0 ? value | (1 << index) : value, 0);
  return [active === 1 ? 0 : active ? 1 : 2, mask, pips.reduce((sum, value) => sum + value, 0), ...pips].join(':');
}

export function getCatalogueSetRank(set: string): number {
  const key = set.toLowerCase().replace(/[^a-z]/g, '');
  if (key === 'frostdale' || key === 'frostmage') return CATALOGUE_SET_ORDER.indexOf('Frost Mage Vs. Lavamancer');
  if (key === 'baldassare' || key === 'baldassar') return CATALOGUE_SET_ORDER.indexOf("Baldassare's Travels");
  if (key === 'promo' || key === 'promotional') return CATALOGUE_SET_ORDER.length + 1;
  const index = CATALOGUE_SET_ORDER.findIndex((name) => name.toLowerCase().replace(/[^a-z]/g, '') === key);
  return index < 0 ? CATALOGUE_SET_ORDER.length : index;
}

export function getEarliestCardSet(sets: readonly CardSet[]): CardSet | undefined {
  const dated = sets.every((set) => Number.isFinite(Date.parse(set.releasedAt)));
  return [...sets].sort((left, right) => (
    (dated ? Date.parse(left.releasedAt) - Date.parse(right.releasedAt) : 0)
      || getCatalogueSetRank(left.name) - getCatalogueSetRank(right.name)
      || collator.compare(left.name, right.name)
  ))[0];
}

function fieldValue(card: CatalogueLayoutCard, field: CatalogueLayoutField): string | number {
  switch (field) {
    case 'element': return card.thresholdGroup;
    case 'family': return card.type === 'Site' ? 'Atlas' : card.type === 'Avatar' ? 'Avatars' : 'Spellbook';
    case 'type': return card.type;
    case 'band': return spellbookBand(card.type);
    case 'cost': return card.cost ?? Number.POSITIVE_INFINITY;
    case 'power': return card.power ?? Number.POSITIVE_INFINITY;
    case 'threshold': return thresholdKey(card.thresholds);
    case 'rarity': return card.rarity ?? 'None';
    case 'set': return card.primarySet ?? 'Unknown set';
    case 'name': return card.name;
  }
}

function compareField(a: CatalogueLayoutCard, b: CatalogueLayoutCard, step: CatalogueLayoutStep): number {
  const left = fieldValue(a, step.field);
  const right = fieldValue(b, step.field);
  const order = step.field === 'element' ? ELEMENT_ORDER : step.field === 'family' ? FAMILY_ORDER
    : step.field === 'type' ? TYPE_ORDER : step.field === 'band' ? SPELLBOOK_BANDS : step.field === 'rarity' ? RARITY_ORDER : null;
  let compared = 0;
  if (left !== right) {
    if (step.field === 'set') compared = getCatalogueSetRank(String(left)) - getCatalogueSetRank(String(right));
    if (order) {
      const li = order.indexOf(String(left));
      const ri = order.indexOf(String(right));
      compared = (li < 0 ? order.length : li) - (ri < 0 ? order.length : ri);
    }
    if (!compared) compared = typeof left === 'number' && typeof right === 'number'
      ? (left < right ? -1 : 1) : collator.compare(String(left), String(right));
  }
  return compared * (step.direction === 'desc' ? -1 : 1);
}

function groupLabel(card: CatalogueLayoutCard, field: CatalogueLayoutField): string {
  if (field === 'element') return ELEMENT_LABELS[card.thresholdGroup];
  if (field === 'cost') return card.cost === null ? 'No cost' : `Cost ${card.cost}`;
  if (field === 'power') return card.power == null ? 'No power' : `Power ${card.power}`;
  if (field === 'threshold') {
    const labels = THRESHOLD_ELEMENTS.flatMap((element) => {
      const pips = card.thresholds?.[element] ?? 0;
      return pips > 0 ? [`${ELEMENT_LABELS[element]} ${pips}`] : [];
    });
    return labels.join(' + ') || 'No threshold';
  }
  return String(fieldValue(card, field));
}

/**
 * Group steps create nested regions. Sort steps rank cards within every region;
 * sorts before a group also rank that group's children by their leading card.
 * Names are a stable final tie-breaker, so filtering never randomizes a group.
 */
export function buildCatalogueGroups<T extends CatalogueLayoutCard>(cards: readonly T[], config: CatalogueLayoutConfig): CatalogueGroup<T> {
  const steps = resolveLayoutSteps(config.steps);
  const sortSteps = steps.filter((step) => step.mode === 'sort');
  const compare = (a: T, b: T, steps = sortSteps): number => {
    for (const step of steps) {
      const compared = compareField(a, b, step);
      if (compared) return compared;
    }
    return collator.compare(a.name, b.name);
  };
  function branch(entries: T[], start: number, label: string): CatalogueGroup<T> {
    const next = steps.findIndex((step, index) => index >= start && step.mode === 'group');
    const step = steps[next];
    if (!step) return { label, cards: entries.sort(compare), children: [] };
    const buckets = new Map<string | number, T[]>();
    for (const card of entries) {
      const key = fieldValue(card, step.field);
      const bucket = buckets.get(key) ?? [];
      bucket.push(card);
      buckets.set(key, bucket);
    }
    const precedingSorts = steps.slice(0, next).filter((entry) => entry.mode === 'sort');
    const groups = [...buckets.values()].map((bucket) => bucket.sort((a, b) => compare(a, b, precedingSorts)));
    groups.sort((a, b) => {
      const first = a[0]; const second = b[0];
      if (!first || !second) return 0;
      for (const sorter of precedingSorts) {
        const result = compareField(first, second, sorter);
        if (result) return result;
      }
      return compareField(first, second, step);
    });
    return { label, cards: [], step, children: groups.flatMap((bucket) => {
      const first = bucket[0];
      return first ? [branch(bucket, next + 1, groupLabel(first, step.field))] : [];
    }) };
  }
  return branch([...cards], 0, 'Cards');
}
