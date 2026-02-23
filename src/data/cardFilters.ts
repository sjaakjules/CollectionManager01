import type { Card } from "./dataModels";

export type ThresholdFilterMode = "inclusive" | "exclusive";

export interface CardFilterCriteria {
  searchText: string;
  sets: string[];
  types: string[];
  rarities: string[];
  subType: string;
  artist: string;
  thresholds: string[];
  thresholdMode: ThresholdFilterMode;
  costMin: number | null;
  costMax: number | null;
  attackMin: number | null;
  attackMax: number | null;
  defenceMin: number | null;
  defenceMax: number | null;
}

export interface CardFilterClause {
  criteria: CardFilterCriteria;
  enabled: boolean;
}

export interface CardFilterState {
  draft: CardFilterCriteria;
  clauses: CardFilterClause[];
}

export function createEmptyCardFilterCriteria(): CardFilterCriteria {
  return {
    searchText: "",
    sets: [],
    types: [],
    rarities: [],
    subType: "",
    artist: "",
    thresholds: [],
    thresholdMode: "inclusive",
    costMin: null,
    costMax: null,
    attackMin: null,
    attackMax: null,
    defenceMin: null,
    defenceMax: null,
  };
}

export function createDefaultCardFilters(): CardFilterState {
  return {
    draft: createEmptyCardFilterCriteria(),
    clauses: [],
  };
}

export const defaultCardFilters = createDefaultCardFilters();

function parseString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseNumberOrNull(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isFinite(value) ? value : null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseCsvToArray(value: unknown): string[] {
  const raw = parseString(value);
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function legacyLike(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  return (
    "setQuery" in value ||
    "typeQuery" in value ||
    "subTypeQuery" in value ||
    "rarityQuery" in value ||
    "artistQuery" in value
  );
}

function parseCriteria(input: unknown): CardFilterCriteria {
  if (!input || typeof input !== "object") {
    return createEmptyCardFilterCriteria();
  }

  const data = input as Record<string, unknown>;

  const sets = parseStringArray(data.sets);
  const types = parseStringArray(data.types);
  const rarities = parseStringArray(data.rarities);

  const criteria: CardFilterCriteria = {
    searchText: parseString(data.searchText),
    sets: sets.length > 0 ? sets : parseCsvToArray(data.setQuery),
    types: types.length > 0 ? types : parseCsvToArray(data.typeQuery),
    rarities: rarities.length > 0 ? rarities : parseCsvToArray(data.rarityQuery),
    subType: parseString(data.subType) || parseString(data.subTypeQuery),
    artist: parseString(data.artist) || parseString(data.artistQuery),
    thresholds: parseStringArray(data.thresholds),
    thresholdMode:
      data.thresholdMode === "exclusive" ? "exclusive" : "inclusive",
    costMin: parseNumberOrNull(data.costMin),
    costMax: parseNumberOrNull(data.costMax),
    attackMin: parseNumberOrNull(data.attackMin),
    attackMax: parseNumberOrNull(data.attackMax),
    defenceMin: parseNumberOrNull(data.defenceMin),
    defenceMax: parseNumberOrNull(data.defenceMax),
  };

  return normalizeFilterCriteria(criteria);
}

function parseClause(input: unknown): CardFilterClause {
  if (!input || typeof input !== "object") {
    return {
      criteria: createEmptyCardFilterCriteria(),
      enabled: true,
    };
  }

  const data = input as Record<string, unknown>;

  if ("criteria" in data || "enabled" in data) {
    return {
      criteria: parseCriteria(data.criteria),
      enabled: data.enabled !== false,
    };
  }

  // Backward compatibility for older clause arrays that were plain criteria objects.
  return {
    criteria: parseCriteria(data),
    enabled: true,
  };
}

export function ensureCardFilterState(value: unknown): CardFilterState {
  if (!value || typeof value !== "object") {
    return createDefaultCardFilters();
  }

  const data = value as Record<string, unknown>;
  if ("draft" in data || "clauses" in data) {
    const draft = parseCriteria(data.draft);
    const clausesRaw = Array.isArray(data.clauses) ? data.clauses : [];
    const clauses = clausesRaw.map((entry) => parseClause(entry));
    return { draft, clauses };
  }

  if (legacyLike(data)) {
    // Legacy single-filter shape is mapped into draft so users can re-apply
    // with Add Filter without unexpectedly filtering everything out.
    return {
      draft: parseCriteria(data),
      clauses: [],
    };
  }

  return createDefaultCardFilters();
}

function normalizeTokens(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)),
  );
}

function toLowerSafe(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.toLowerCase();
}

function withinRange(
  value: number | null,
  min: number | null,
  max: number | null,
): boolean {
  if (min === null && max === null) return true;
  if (value === null) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

export function isCardFilterCriteriaEmpty(criteria: CardFilterCriteria): boolean {
  return (
    criteria.searchText.trim().length === 0 &&
    criteria.sets.length === 0 &&
    criteria.types.length === 0 &&
    criteria.rarities.length === 0 &&
    criteria.subType.trim().length === 0 &&
    criteria.artist.trim().length === 0 &&
    criteria.thresholds.length === 0 &&
    criteria.costMin === null &&
    criteria.costMax === null &&
    criteria.attackMin === null &&
    criteria.attackMax === null &&
    criteria.defenceMin === null &&
    criteria.defenceMax === null
  );
}

export function isCardFilterActive(filters: CardFilterState): boolean {
  return ensureCardFilterState(filters).clauses.some(
    (clause) => clause.enabled && !isCardFilterCriteriaEmpty(clause.criteria),
  );
}

export function normalizeFilterCriteria(
  criteria: CardFilterCriteria,
): CardFilterCriteria {
  return {
    ...criteria,
    searchText: criteria.searchText.trim(),
    sets: normalizeTokens(criteria.sets),
    types: normalizeTokens(criteria.types),
    rarities: normalizeTokens(criteria.rarities),
    subType: criteria.subType.trim().toLowerCase(),
    artist: criteria.artist.trim().toLowerCase(),
    thresholds: normalizeTokens(criteria.thresholds),
  };
}

function matchesCriteria(card: Card, criteria: CardFilterCriteria): boolean {
  const normalized = normalizeFilterCriteria(criteria);

  if (normalized.searchText) {
    const haystack = JSON.stringify(card).toLowerCase();
    if (!haystack.includes(normalized.searchText)) return false;
  }

  if (normalized.sets.length > 0) {
    const cardSets = card.sets
      .map((setEntry) => toLowerSafe(setEntry?.name))
      .filter(Boolean);
    if (!normalized.sets.some((setName) => cardSets.includes(setName))) {
      return false;
    }
  }

  if (normalized.types.length > 0) {
    const cardType = toLowerSafe(card.guardian?.type);
    if (!normalized.types.includes(cardType)) {
      return false;
    }
  }

  if (normalized.rarities.length > 0) {
    const rarity = toLowerSafe(card.guardian?.rarity);
    if (!normalized.rarities.includes(rarity)) {
      return false;
    }
  }

  if (normalized.subType) {
    const subTypes = toLowerSafe(card.subTypes);
    if (!subTypes.includes(normalized.subType)) {
      return false;
    }
  }

  if (normalized.artist) {
    const artists = card.sets.flatMap((setEntry) =>
      setEntry.variants
        .map((variant) => toLowerSafe(variant?.artist))
        .filter(Boolean),
    );
    if (!artists.includes(normalized.artist)) {
      return false;
    }
  }

  if (normalized.thresholds.length > 0) {
    const selectedThresholds = new Set(normalized.thresholds);
    const thresholds = card.guardian?.thresholds;
    const activeElements = (["air", "earth", "fire", "water"] as const).filter(
      (element) => (thresholds?.[element] ?? 0) > 0,
    );

    if (normalized.thresholdMode === "inclusive") {
      for (const threshold of selectedThresholds) {
        if (!activeElements.includes(threshold as (typeof activeElements)[number])) {
          return false;
        }
      }
    } else {
      if (activeElements.length === 0) return false;
      for (const activeElement of activeElements) {
        if (!selectedThresholds.has(activeElement)) {
          return false;
        }
      }
    }
  }

  if (
    !withinRange(card.guardian.cost, normalized.costMin, normalized.costMax) ||
    !withinRange(card.guardian.attack, normalized.attackMin, normalized.attackMax) ||
    !withinRange(card.guardian.defence, normalized.defenceMin, normalized.defenceMax)
  ) {
    return false;
  }

  return true;
}

export function applyCardFilters(
  cards: Card[],
  filters: CardFilterState,
): Card[] {
  const safeFilters = ensureCardFilterState(filters);
  const activeClauses = safeFilters.clauses.filter(
    (clause) => clause.enabled && !isCardFilterCriteriaEmpty(clause.criteria),
  );

  if (activeClauses.length === 0) {
    return cards;
  }

  return cards.filter((card) =>
    activeClauses.some((clause) => matchesCriteria(card, clause.criteria)),
  );
}
