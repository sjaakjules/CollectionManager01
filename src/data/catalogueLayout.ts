import type { ThresholdGroup } from './dataModels';

export const CATALOGUE_LAYOUT_FIELDS = ['element', 'family', 'type', 'cost', 'rarity', 'set', 'name'] as const;
export type CatalogueLayoutField = typeof CATALOGUE_LAYOUT_FIELDS[number];
export interface CatalogueLayoutStep {
  field: CatalogueLayoutField;
  mode: 'group' | 'sort';
  direction: 'asc' | 'desc';
}
export interface CatalogueLayoutConfig {
  steps: CatalogueLayoutStep[];
  columns: number;
}
export const CATALOGUE_FIELD_LABELS: Record<CatalogueLayoutField, string> = {
  element: 'Element', family: 'Spellbook / Atlas', type: 'Card type', cost: 'Cost',
  rarity: 'Rarity', set: 'Set', name: 'Name',
};

export function createDefaultCatalogueLayout(): CatalogueLayoutConfig {
  return { columns: 10, steps: [
    { field: 'element', mode: 'group', direction: 'asc' },
    { field: 'family', mode: 'group', direction: 'asc' },
    { field: 'type', mode: 'group', direction: 'asc' },
    { field: 'cost', mode: 'sort', direction: 'asc' },
    { field: 'name', mode: 'sort', direction: 'asc' },
  ] };
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
    });
  }
  const columns = typeof record.columns === 'number' && Number.isFinite(record.columns)
    ? Math.max(4, Math.min(16, Math.round(record.columns))) : 10;
  return { steps, columns };
}

/** Insert a palette field or move an existing step to an insertion point. */
export function insertCatalogueLayoutStep(config: CatalogueLayoutConfig, field: CatalogueLayoutField, insertionIndex: number): CatalogueLayoutConfig {
  const oldIndex = config.steps.findIndex((step) => step.field === field);
  const step = config.steps[oldIndex] ?? { field, mode: 'group', direction: 'asc' };
  const steps = config.steps.filter((entry) => entry.field !== field);
  const target = Math.max(0, Math.min(steps.length, insertionIndex - (oldIndex >= 0 && oldIndex < insertionIndex ? 1 : 0)));
  steps.splice(target, 0, step);
  return { ...config, steps };
}

export interface CatalogueLayoutCard {
  name: string;
  type: string;
  thresholdGroup: ThresholdGroup;
  cost: number | null;
  rarity?: string | null;
  primarySet?: string;
}
export interface CatalogueGroup<T> {
  label: string;
  cards: T[];
  children: CatalogueGroup<T>[];
}

const ELEMENT_ORDER = ['air', 'earth', 'fire', 'water', 'none', 'multiple'];
const FAMILY_ORDER = ['Avatars', 'Spellbook', 'Atlas'];
const TYPE_ORDER = ['Avatar', 'Minion', 'Magic', 'Aura', 'Artifact', 'Site'];
const RARITY_ORDER = ['None', 'Ordinary', 'Exceptional', 'Elite', 'Unique'];
const ELEMENT_LABELS: Record<ThresholdGroup, string> = {
  air: 'Air', earth: 'Earth', fire: 'Fire', water: 'Water', none: 'None', multiple: 'Multi',
};
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function fieldValue(card: CatalogueLayoutCard, field: CatalogueLayoutField): string | number {
  switch (field) {
    case 'element': return card.thresholdGroup;
    case 'family': return card.type === 'Site' ? 'Atlas' : card.type === 'Avatar' ? 'Avatars' : 'Spellbook';
    case 'type': return card.type;
    case 'cost': return card.cost ?? Number.POSITIVE_INFINITY;
    case 'rarity': return card.rarity ?? 'None';
    case 'set': return card.primarySet ?? 'Unknown set';
    case 'name': return card.name;
  }
}

function compareField(a: CatalogueLayoutCard, b: CatalogueLayoutCard, step: CatalogueLayoutStep): number {
  const left = fieldValue(a, step.field);
  const right = fieldValue(b, step.field);
  const order = step.field === 'element' ? ELEMENT_ORDER : step.field === 'family' ? FAMILY_ORDER
    : step.field === 'type' ? TYPE_ORDER : step.field === 'rarity' ? RARITY_ORDER : null;
  let compared = 0;
  if (left !== right) {
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
  return String(fieldValue(card, field));
}

/**
 * Group steps create nested regions. Sort steps rank cards within every region;
 * sorts before a group also rank that group's children by their leading card.
 * Names are a stable final tie-breaker, so filtering never randomizes a group.
 */
export function buildCatalogueGroups<T extends CatalogueLayoutCard>(cards: readonly T[], config: CatalogueLayoutConfig): CatalogueGroup<T> {
  const sortSteps = config.steps.filter((step) => step.mode === 'sort');
  const compare = (a: T, b: T, steps = sortSteps): number => {
    for (const step of steps) {
      const compared = compareField(a, b, step);
      if (compared) return compared;
    }
    return collator.compare(a.name, b.name);
  };
  function branch(entries: T[], start: number, label: string): CatalogueGroup<T> {
    const next = config.steps.findIndex((step, index) => index >= start && step.mode === 'group');
    const step = config.steps[next];
    if (!step) return { label, cards: entries.sort(compare), children: [] };
    const buckets = new Map<string | number, T[]>();
    for (const card of entries) {
      const key = fieldValue(card, step.field);
      const bucket = buckets.get(key) ?? [];
      bucket.push(card);
      buckets.set(key, bucket);
    }
    const precedingSorts = config.steps.slice(0, next).filter((entry) => entry.mode === 'sort');
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
    return { label, cards: [], children: groups.flatMap((bucket) => {
      const first = bucket[0];
      return first ? [branch(bucket, next + 1, groupLabel(first, step.field))] : [];
    }) };
  }
  return branch([...cards], 0, 'Cards');
}
