/**
 * The boundary between untrusted catalogs (API, IndexedDB, snapshots) and Card.
 * Supports the legacy guardian/sets feed and the engine/printings feed.
 * Optional preview fields get safe defaults; unfamiliar type names are retained.
 */
import type { Card, CardSet, CardStats, CardVariant } from './dataModels';

export interface CardCatalogIssue {
  cardName: string;
  reason: string;
  skipped: boolean;
}

export interface CardCatalogResult {
  cards: Card[];
  issues: CardCatalogIssue[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function tokens(value: unknown): string[] {
  const values = Array.isArray(value) ? value : text(value).split(/[,/|]+/u);
  return [...new Set(values.map(text).filter(Boolean))];
}

function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStats(value: unknown, engine = false): CardStats | null {
  const stats = record(value);
  const type = text(stats?.type);
  if (!stats || !type) return null;
  const thresholds = engine ? stats : record(stats.thresholds);
  return {
    type,
    rarity: text(stats.rarity) || null,
    rulesText: text(engine ? stats.rules : stats.rulesText),
    cost: number(stats.cost),
    attack: number(stats.attack),
    defence: number(engine ? stats.defense : stats.defence),
    life: number(stats.life),
    thresholds: {
      air: Math.max(0, number(thresholds?.air) ?? 0),
      earth: Math.max(0, number(thresholds?.earth) ?? 0),
      fire: Math.max(0, number(thresholds?.fire) ?? 0),
      water: Math.max(0, number(thresholds?.water) ?? 0),
    },
  };
}

function normalizeVariant(value: unknown): CardVariant | null {
  const variant = record(value);
  if (!variant) return null;
  return {
    slug: text(variant.slug),
    finish: text(variant.finish),
    product: text(variant.product),
    artist: text(variant.artist),
    flavorText: text(variant.flavorText),
    typeText: text(variant.typeText),
  };
}

function normalizeLegacySets(value: unknown, guardian: CardStats): CardSet[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const set = record(entry);
    const name = text(set?.name);
    if (!set || !name) return [];
    return [{
      name,
      releasedAt: text(set.releasedAt),
      metadata: normalizeStats(set.metadata) ?? guardian,
      variants: Array.isArray(set.variants)
        ? set.variants.map(normalizeVariant).filter((v): v is CardVariant => v !== null)
        : [],
    }];
  });
}

function normalizePrintings(value: unknown, guardian: CardStats): CardSet[] {
  if (!Array.isArray(value)) return [];
  const sets = new Map<string, CardSet>();
  for (const entry of value) {
    const printing = record(entry);
    const set = record(printing?.set);
    const name = text(set?.name);
    if (!printing || !set || !name) continue;
    const meta = record(printing.meta);
    let normalized = sets.get(name);
    if (!normalized) {
      normalized = {
        name,
        releasedAt: text(set.releasedAt),
        metadata: guardian,
        variants: [],
      };
      sets.set(name, normalized);
    }
    normalized.variants.push({
      slug: text(printing.slug),
      finish: text(meta?.finish),
      product: text(meta?.product),
      artist: text(record(meta?.artist)?.name) || text(meta?.artist),
      flavorText: text(meta?.flavor),
      typeText: text(meta?.typeline),
    });
  }
  // Feed order is not chronological; keep the original set first for layouts.
  return [...sets.values()].sort((a, b) =>
    (Date.parse(a.releasedAt) || 0) - (Date.parse(b.releasedAt) || 0),
  );
}

function latestSetStats(value: unknown): CardStats | null {
  if (!Array.isArray(value)) return null;
  const sets = value.map(record).filter((set): set is Record<string, unknown> => set !== null);
  sets.sort((a, b) => (Date.parse(text(b.releasedAt)) || 0) - (Date.parse(text(a.releasedAt)) || 0));
  for (const set of sets) {
    const stats = normalizeStats(set.metadata);
    if (stats) return stats;
  }
  return null;
}

export function normalizeCardCatalog(payload: unknown): CardCatalogResult {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('Card catalog must be a non-empty array');
  }
  const cards: Card[] = [];
  const issues: CardCatalogIssue[] = [];
  const seen = new Set<string>();

  for (const [index, value] of payload.entries()) {
    const raw = record(value);
    const name = text(raw?.name);
    if (!raw || !name) {
      issues.push({ cardName: `Record ${index + 1}`, reason: 'Missing card name', skipped: true });
      continue;
    }
    const engine = record(raw.engine);
    let guardian = normalizeStats(raw.guardian) ?? normalizeStats(engine, true);
    if (!guardian) {
      guardian = latestSetStats(raw.sets);
      if (guardian) {
        issues.push({ cardName: name, reason: 'Using latest set metadata; current rules unavailable', skipped: false });
      }
    }
    if (!guardian) {
      issues.push({ cardName: name, reason: 'Missing supported rules metadata or card type', skipped: true });
      continue;
    }
    if (seen.has(name.toLowerCase())) {
      issues.push({ cardName: name, reason: 'Duplicate card name', skipped: true });
      continue;
    }
    seen.add(name.toLowerCase());
    const back = normalizeStats(raw.back) ?? normalizeStats(engine?.back, true);
    cards.push({
      name,
      guardian,
      elements: tokens(raw.elements ?? engine?.elements).join(', '),
      subTypes: tokens(raw.subTypes ?? engine?.subtypes).join(', '),
      sets: Array.isArray(raw.sets)
        ? normalizeLegacySets(raw.sets, guardian)
        : normalizePrintings(raw.printings, guardian),
      keywords: tokens(raw.keywords ?? engine?.keywords),
      umbrellas: tokens(raw.umbrellas ?? engine?.umbrellas),
      ...(back ? { back } : {}),
    });
  }
  if (cards.length === 0) {
    throw new Error('Card catalog contains no supported card records');
  }
  return { cards, issues };
}
