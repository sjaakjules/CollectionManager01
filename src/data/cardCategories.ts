import type { Card } from "@/data/dataModels";
import { isBlockedTokenCardName } from "@/data/tokenCards";

export interface CardCategoryDefinition {
  id: string;
  name: string;
  tooltip: string;
  description: string;
  base: boolean;
  hidden?: boolean;
}

export type CardCategoryScores = Record<string, Record<string, number>>;

export interface CardCategoryData {
  version: string;
  categories: CardCategoryDefinition[];
  scores: CardCategoryScores;
}

interface TaxonomyCategoryEntry {
  tooltip?: unknown;
  description?: unknown;
}

interface TaxonomyPayload {
  version?: unknown;
  cardCategories?: Record<string, TaxonomyCategoryEntry>;
  displayOrder?: {
    cardCategories?: unknown;
  };
}

export interface CardCategorySeed {
  version: string;
  categories: CardCategoryDefinition[];
  scores: CardCategoryScores;
}

const TAXONOMY_ASSET_PATH = "/assets/sorcery_taxonomy_tooltips.json";
const CATEGORY_SCORES_ASSET_PATH = "/assets/sorcery_card_category_scores.json";

let seedCache: CardCategorySeed | null = null;
let seedPromise: Promise<CardCategorySeed> | null = null;

export function canonicalizeCategoryId(name: string): string {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/['’`]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function clampCategoryScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

export function formatCategoryScore(value: number): string {
  return clampCategoryScore(value).toFixed(2);
}

export async function loadCardCategorySeed(): Promise<CardCategorySeed> {
  if (seedCache) return seedCache;
  if (seedPromise) return seedPromise;

  seedPromise = Promise.all([
    fetch(TAXONOMY_ASSET_PATH, { cache: "no-store" }),
    fetch(CATEGORY_SCORES_ASSET_PATH, { cache: "no-store" }),
  ]).then(async ([taxonomyResponse, scoresResponse]) => {
    if (!taxonomyResponse.ok) {
      throw new Error(`Failed to load taxonomy: ${taxonomyResponse.status}`);
    }
    if (!scoresResponse.ok) {
      throw new Error(`Failed to load category scores: ${scoresResponse.status}`);
    }

    const taxonomy = (await taxonomyResponse.json()) as TaxonomyPayload;
    const rawScores = (await scoresResponse.json()) as Record<
      string,
      Record<string, number>
    >;
    seedCache = buildCardCategorySeed(taxonomy, rawScores);
    return seedCache;
  });

  return seedPromise;
}

export function buildCardCategorySeed(
  taxonomy: TaxonomyPayload,
  rawScores: Record<string, Record<string, number>>,
): CardCategorySeed {
  const taxonomyCategories = taxonomy.cardCategories ?? {};
  const order = Array.isArray(taxonomy.displayOrder?.cardCategories)
    ? taxonomy.displayOrder.cardCategories.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : Object.keys(taxonomyCategories);
  const orderedNames = [
    ...order,
    ...Object.keys(taxonomyCategories).filter((name) => !order.includes(name)),
  ];

  const categories = orderedNames.map((name) => {
    const entry = taxonomyCategories[name] ?? {};
    const tooltip =
      typeof entry.tooltip === "string" ? entry.tooltip : String(entry.description ?? "");
    const description =
      typeof entry.description === "string" ? entry.description : tooltip;
    return {
      id: canonicalizeCategoryId(name),
      name,
      tooltip,
      description,
      base: true,
    };
  });
  const idByName = new Map(categories.map((category) => [category.name, category.id]));
  const scores: CardCategoryScores = {};

  for (const [cardName, cardScores] of Object.entries(rawScores)) {
    if (isBlockedTokenCardName(cardName)) continue;
    const normalized: Record<string, number> = {};
    for (const [categoryName, score] of Object.entries(cardScores)) {
      const categoryId = idByName.get(categoryName) ?? canonicalizeCategoryId(categoryName);
      const clamped = clampCategoryScore(score);
      if (clamped > 0) normalized[categoryId] = clamped;
    }
    if (Object.keys(normalized).length > 0) {
      scores[cardName] = normalized;
    }
  }

  return {
    version:
      typeof taxonomy.version === "string"
        ? taxonomy.version
        : "sorcery-card-categories-v1",
    categories,
    scores,
  };
}

export function normalizeCardCategoryData(
  value: CardCategoryData | null | undefined,
  seed: CardCategorySeed,
): CardCategoryData {
  if (!value) {
    return cloneCategoryData({
      version: seed.version,
      categories: seed.categories,
      scores: seed.scores,
    });
  }

  const seedById = new Map(seed.categories.map((category) => [category.id, category]));
  const inputCategories = Array.isArray(value.categories) ? value.categories : [];
  const categories: CardCategoryDefinition[] = [];
  const seen = new Set<string>();

  for (const category of inputCategories) {
    if (!category || typeof category.id !== "string") continue;
    const id = category.id.trim();
    if (!id || seen.has(id)) continue;
    const seedCategory = seedById.get(id);
    categories.push({
      id,
      name:
        typeof category.name === "string" && category.name.trim()
          ? category.name.trim()
          : seedCategory?.name ?? id,
      tooltip:
        typeof category.tooltip === "string"
          ? category.tooltip
          : seedCategory?.tooltip ?? "",
      description:
        typeof category.description === "string"
          ? category.description
          : seedCategory?.description ?? "",
      base: category.base === true || !!seedCategory,
      hidden: category.hidden === true,
    });
    seen.add(id);
  }

  for (const seedCategory of seed.categories) {
    if (!seen.has(seedCategory.id)) {
      categories.push({ ...seedCategory });
      seen.add(seedCategory.id);
    }
  }

  const inputExistingCategoryIds = new Set(inputCategories.map((entry) => entry?.id));
  const scores: CardCategoryScores = {};
  for (const [cardName, cardScores] of Object.entries(value.scores ?? {})) {
    if (isBlockedTokenCardName(cardName)) continue;
    const normalized: Record<string, number> = {};
    for (const [categoryId, score] of Object.entries(cardScores)) {
      if (!seen.has(categoryId)) continue;
      const clamped = clampCategoryScore(score);
      if (clamped > 0) normalized[categoryId] = clamped;
    }
    if (Object.keys(normalized).length > 0) scores[cardName] = normalized;
  }

  for (const seedCategory of seed.categories) {
    if (inputExistingCategoryIds.has(seedCategory.id)) continue;
    for (const [cardName, cardScores] of Object.entries(seed.scores)) {
      if (isBlockedTokenCardName(cardName)) continue;
      const score = cardScores[seedCategory.id];
      if (!score || score <= 0) continue;
      if (!scores[cardName]) scores[cardName] = {};
      scores[cardName][seedCategory.id] = score;
    }
  }

  return {
    version: typeof value.version === "string" ? value.version : seed.version,
    categories,
    scores,
  };
}

export function cloneCategoryData(data: CardCategoryData): CardCategoryData {
  return {
    version: data.version,
    categories: data.categories.map((category) => ({ ...category })),
    scores: Object.fromEntries(
      Object.entries(data.scores).map(([cardName, scores]) => [
        cardName,
        { ...scores },
      ]),
    ),
  };
}

export function getVisibleCardCategories(data: CardCategoryData | null): CardCategoryDefinition[] {
  return (data?.categories ?? []).filter((category) => !category.hidden);
}

export function getHiddenBaseCardCategories(
  data: CardCategoryData | null,
): CardCategoryDefinition[] {
  return (data?.categories ?? []).filter((category) => category.base && category.hidden);
}

export function getCategoryScore(
  data: CardCategoryData | null,
  cardName: string,
  categoryId: string | null,
): number {
  if (!data || !categoryId) return 0;
  return clampCategoryScore(data.scores[cardName]?.[categoryId] ?? 0);
}

export function setCategoryScore(
  data: CardCategoryData,
  cardName: string,
  categoryId: string,
  value: number,
): CardCategoryData {
  const next = cloneCategoryData(data);
  if (isBlockedTokenCardName(cardName)) return next;
  const score = clampCategoryScore(value);
  if (score <= 0) {
    if (next.scores[cardName]) {
      Reflect.deleteProperty(next.scores[cardName], categoryId);
      if (Object.keys(next.scores[cardName]).length === 0) {
        Reflect.deleteProperty(next.scores, cardName);
      }
    }
    return next;
  }

  next.scores[cardName] = {
    ...(next.scores[cardName] ?? {}),
    [categoryId]: score,
  };
  return next;
}

export function addCustomCategory(
  data: CardCategoryData,
  name: string,
  description: string,
): CardCategoryData {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Category name is required");
  const next = cloneCategoryData(data);
  const existingIds = new Set(next.categories.map((category) => category.id));
  let id = canonicalizeCategoryId(trimmed);
  if (!id) throw new Error("Category name is invalid");
  if (existingIds.has(id)) {
    let suffix = 2;
    while (existingIds.has(`${id}-${suffix}`)) suffix += 1;
    id = `${id}-${suffix}`;
  }
  next.categories.push({
    id,
    name: trimmed,
    tooltip: description.trim(),
    description: description.trim(),
    base: false,
  });
  return next;
}

export function updateCategoryDefinition(
  data: CardCategoryData,
  categoryId: string,
  updates: { name: string; description: string },
): CardCategoryData {
  const next = cloneCategoryData(data);
  const category = next.categories.find((entry) => entry.id === categoryId);
  if (!category) throw new Error("Category not found");
  const name = updates.name.trim();
  if (!name) throw new Error("Category name is required");
  category.name = name;
  category.description = updates.description.trim();
  category.tooltip = updates.description.trim();
  return next;
}

export function setCategoryHidden(
  data: CardCategoryData,
  categoryId: string,
  hidden: boolean,
): CardCategoryData {
  const next = cloneCategoryData(data);
  const category = next.categories.find((entry) => entry.id === categoryId);
  if (!category) throw new Error("Category not found");
  category.hidden = hidden;
  return next;
}

export function restoreBaseCategory(
  data: CardCategoryData,
  categoryId: string,
): CardCategoryData {
  return setCategoryHidden(data, categoryId, false);
}

export function removeCategory(data: CardCategoryData, categoryId: string): CardCategoryData {
  const category = data.categories.find((entry) => entry.id === categoryId);
  if (!category) throw new Error("Category not found");
  if (category.base) return setCategoryHidden(data, categoryId, true);

  const next = cloneCategoryData(data);
  next.categories = next.categories.filter((entry) => entry.id !== categoryId);
  for (const [cardName, scores] of Object.entries(next.scores)) {
    if (categoryId in scores) {
      Reflect.deleteProperty(scores, categoryId);
      if (Object.keys(scores).length === 0) Reflect.deleteProperty(next.scores, cardName);
    }
  }
  return next;
}

export function getCategoryShelfCards(
  data: CardCategoryData | null,
  cards: Card[],
  categoryId: string | null,
): Array<{ card: Card; score: number }> {
  if (!data || !categoryId) return [];
  return cards
    .filter((card) => !isBlockedTokenCardName(card.name))
    .map((card) => ({ card, score: getCategoryScore(data, card.name, categoryId) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.card.name.localeCompare(right.card.name);
    });
}
