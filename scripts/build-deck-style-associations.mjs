import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_STYLE_SCORE_PATH = "tmp/sorcery_deck_style_scores_with_substyles.json";
const DEFAULT_TAXONOMY_PATH = "tmp/sorcery_taxonomy_tooltips.json";
const DEFAULT_ARCHIVE_PATH = "offlineData/deckArchive.json";
const DEFAULT_CARD_DATA_PATH = "docs/Sorcery_CardInfo.json";
const DEFAULT_OUTPUT_PATH = "public/assets/sorcery_deck_style_associations.json";
const DEFAULT_ALPHA = 1;
const DEFAULT_STYLE_INFERENCE_NEIGHBORS = 8;
const STYLE_INFERENCE_METHOD = "tfidf-nearest-decks-v1";
const STYLE_VECTOR_BOARD_WEIGHTS = {
  avatar: 1.4,
  spellbook: 1,
  atlas: 0.3,
  collection: 0.45,
};
const ELEMENT_KEYS = ["air", "earth", "fire", "water"];

export const RARITY_LIMITS = {
  Ordinary: 4,
  Exceptional: 3,
  Elite: 2,
  Unique: 1,
};

function isBlockedTokenCardName(cardName) {
  const normalized = String(cardName ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "frog" || normalized === "skeleton") return true;
  return /^frog\s*\(/u.test(normalized) || /^foot soldiers?(?:\b|\s*\()/u.test(normalized);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseQuantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function canonicalizeId(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/['’`]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function copySaturation(quantity, rarityLimit) {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(rarityLimit) || rarityLimit <= 0) return 1;
  return Math.min(1, quantity / rarityLimit);
}

function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 10000) / 10000));
}

function displayScore(value) {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function sortedEntries(record) {
  if (!isRecord(record)) return [];
  return Object.entries(record)
    .map(([name, quantity]) => [name, parseQuantity(quantity)])
    .filter(([name, quantity]) => name.trim() && quantity > 0)
    .sort(([left], [right]) => left.localeCompare(right));
}

function boardEntries(record) {
  return sortedEntries(record)
    .filter(([name]) => !isBlockedTokenCardName(name))
    .map(([name, quantity]) => ({ name, quantity }));
}

function buildCardByName(cards) {
  const cardByName = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || typeof card.name !== "string") continue;
    if (isBlockedTokenCardName(card.name)) continue;
    cardByName.set(card.name, card);
  }
  return cardByName;
}

function buildRarityByCard(cards) {
  const rarityByCard = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || typeof card.name !== "string") continue;
    if (isBlockedTokenCardName(card.name)) continue;
    const guardian = isRecord(card.guardian) ? card.guardian : {};
    const setStats = Array.isArray(card.sets)
      ? card.sets.map((set) => set?.metadata).find((entry) => isRecord(entry))
      : null;
    const rarity =
      typeof guardian.rarity === "string" && guardian.rarity in RARITY_LIMITS
        ? guardian.rarity
        : typeof setStats?.rarity === "string" && setStats.rarity in RARITY_LIMITS
          ? setStats.rarity
          : null;
    rarityByCard.set(card.name, rarity);
  }
  return rarityByCard;
}

function deckElementsFromCards(cards, cardByName) {
  const present = new Set();
  const visit = (entry) => {
    const card = cardByName.get(entry.name);
    if (
      !card ||
      card?.guardian?.type === "Avatar" ||
      card?.guardian?.type === "Site"
    ) {
      return;
    }
    const thresholds = isRecord(card.guardian?.thresholds)
      ? card.guardian.thresholds
      : {};
    for (const element of ELEMENT_KEYS) {
      if (Number(thresholds[element] ?? 0) > 0) {
        present.add(element);
      }
    }
  };

  for (const board of cards) {
    for (const entry of board) visit(entry);
  }
  return ELEMENT_KEYS.filter((element) => present.has(element));
}

function archiveDeckToRuntimeDeck(deckId, archiveEntry, cardByName) {
  const deckinfo = archiveEntry?.deckinfo;
  if (!isRecord(deckinfo)) return null;

  const cards = isRecord(deckinfo.cards) ? deckinfo.cards : {};
  const avatarName =
    typeof deckinfo.avatar === "string" && deckinfo.avatar.trim()
      ? deckinfo.avatar.trim()
      : boardEntries(cards.avatar)[0]?.name ?? null;
  const avatar = avatarName && !isBlockedTokenCardName(avatarName)
    ? [{ name: avatarName, quantity: 1 }]
    : [];
  const boards = {
    mainboard: [...boardEntries(cards.spellbook), ...boardEntries(cards.atlas)],
    sideboard: boardEntries(cards.collection),
    avatar,
    maybeboard: boardEntries(cards.maybe),
  };

  const id =
    typeof deckinfo.id === "string" && deckinfo.id.trim()
      ? deckinfo.id.trim()
      : deckId;
  const name =
    typeof deckinfo.name === "string" && deckinfo.name.trim()
      ? deckinfo.name.trim()
      : `Deck ${id}`;
  const user = isRecord(deckinfo.user) ? deckinfo.user : {};
  const author =
    typeof user.username === "string" && user.username.trim()
      ? user.username.trim()
      : undefined;
  const createdAt =
    typeof deckinfo.createdAt === "string" && deckinfo.createdAt.trim()
      ? deckinfo.createdAt
      : new Date(0).toISOString();
  const updatedAt =
    typeof deckinfo.updatedAt === "string" && deckinfo.updatedAt.trim()
      ? deckinfo.updatedAt
      : createdAt;
  const format =
    typeof deckinfo.format === "string" && deckinfo.format.trim()
      ? deckinfo.format.trim()
      : "Unknown";
  const competitive = isRecord(deckinfo.competitive)
    ? deckinfo.competitive
    : undefined;

  return {
    id,
    name,
    ...(author ? { author } : {}),
    avatar: avatarName,
    format,
    elements: deckElementsFromCards(
      [boardEntries(cards.spellbook), boardEntries(cards.collection)],
      cardByName,
    ),
    boards,
    createdAt,
    updatedAt,
    ...(competitive ? { competitive } : {}),
  };
}

function rarityLimit(cardName, rarityByCard, quantity) {
  const rarity = rarityByCard.get(cardName);
  return rarity && rarity in RARITY_LIMITS ? RARITY_LIMITS[rarity] : Math.max(1, quantity);
}

function addCardContribution(target, cardName, contribution, deckName, deckWeight) {
  if (contribution <= 0) return;
  const existing = target.get(cardName) ?? {
    contribution: 0,
    deckIds: new Set(),
    weightedDecks: 0,
    examples: [],
  };
  existing.contribution += contribution;
  existing.weightedDecks += deckWeight;
  existing.deckIds.add(deckName);
  if (existing.examples.length < 5 && !existing.examples.includes(deckName)) {
    existing.examples.push(deckName);
  }
  target.set(cardName, existing);
}

function normalizeDeckCards(deckinfo, rarityByCard) {
  const cards = isRecord(deckinfo.cards) ? deckinfo.cards : {};
  const normalized = new Map();
  const addBoard = (boardName, board, kind = "card") => {
    for (const [name, quantity] of sortedEntries(board)) {
      if (isBlockedTokenCardName(name)) continue;
      const limit = kind === "avatar" ? 1 : rarityLimit(name, rarityByCard, quantity);
      const saturation = copySaturation(quantity, limit);
      normalized.set(name, Math.max(normalized.get(name) ?? 0, saturation));
    }
  };

  if (
    typeof deckinfo.avatar === "string" &&
    deckinfo.avatar.trim() &&
    !isBlockedTokenCardName(deckinfo.avatar)
  ) {
    normalized.set(deckinfo.avatar.trim(), 1);
  }
  addBoard("avatar", cards.avatar, "avatar");
  addBoard("spellbook", cards.spellbook);
  addBoard("atlas", cards.atlas);
  addBoard("collection", cards.collection);
  return normalized;
}

function setMaxVectorValue(vector, key, value) {
  if (!Number.isFinite(value) || value <= 0) return;
  vector.set(key, Math.max(vector.get(key) ?? 0, value));
}

function buildStyleInferenceVector(deckinfo, rarityByCard) {
  if (!isRecord(deckinfo)) return new Map();
  const cards = isRecord(deckinfo.cards) ? deckinfo.cards : {};
  const vector = new Map();

  const addBoard = (boardName, board, weight, kind = "card") => {
    for (const [name, quantity] of sortedEntries(board)) {
      if (isBlockedTokenCardName(name)) continue;
      const limit = kind === "avatar" ? 1 : rarityLimit(name, rarityByCard, quantity);
      setMaxVectorValue(
        vector,
        `${boardName}:${name}`,
        copySaturation(quantity, limit) * weight,
      );
    }
  };

  if (
    typeof deckinfo.avatar === "string" &&
    deckinfo.avatar.trim() &&
    !isBlockedTokenCardName(deckinfo.avatar)
  ) {
    setMaxVectorValue(
      vector,
      `avatar:${deckinfo.avatar.trim()}`,
      STYLE_VECTOR_BOARD_WEIGHTS.avatar,
    );
  }
  addBoard("avatar", cards.avatar, STYLE_VECTOR_BOARD_WEIGHTS.avatar, "avatar");
  addBoard("spellbook", cards.spellbook, STYLE_VECTOR_BOARD_WEIGHTS.spellbook);
  addBoard("atlas", cards.atlas, STYLE_VECTOR_BOARD_WEIGHTS.atlas);
  addBoard("collection", cards.collection, STYLE_VECTOR_BOARD_WEIGHTS.collection);
  return vector;
}

function buildInverseDocumentFrequency(vectors) {
  const documentFrequency = new Map();
  for (const vector of vectors.values()) {
    for (const key of vector.keys()) {
      documentFrequency.set(key, (documentFrequency.get(key) ?? 0) + 1);
    }
  }

  const documentCount = Math.max(1, vectors.size);
  return new Map(
    [...documentFrequency.entries()].map(([key, count]) => [
      key,
      Math.log((documentCount + 1) / (count + 1)) + 1,
    ]),
  );
}

function vectorNorm(vector, inverseDocumentFrequency) {
  let squared = 0;
  for (const [key, value] of vector) {
    const weighted = value * (inverseDocumentFrequency.get(key) ?? 1);
    squared += weighted * weighted;
  }
  return Math.sqrt(squared);
}

function vectorSimilarity(left, right, inverseDocumentFrequency, leftNorm, rightNorm) {
  if (leftNorm <= 0 || rightNorm <= 0) return 0;
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let dot = 0;
  for (const [key, value] of smaller) {
    const other = larger.get(key);
    if (!other) continue;
    const idf = inverseDocumentFrequency.get(key) ?? 1;
    dot += value * other * idf * idf;
  }
  return dot / (leftNorm * rightNorm);
}

function scoreValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampScore(parsed) : 0;
}

function styleScoreValue(score, styleName) {
  if (isRecord(score?.fractionalStyles)) {
    const fractional = scoreValue(score.fractionalStyles[styleName]);
    if (fractional > 0) return fractional;
  }
  return score?.style === styleName ? 1 : 0;
}

function subStyleScoreValue(score, styleName, subStyleName) {
  const styleScores = isRecord(score?.fractionalSubStyles?.[styleName])
    ? score.fractionalSubStyles[styleName]
    : {};
  const fractional = scoreValue(styleScores[subStyleName]);
  if (fractional > 0) return fractional;
  return score?.style === styleName && score?.subStyle === subStyleName ? 1 : 0;
}

function aggregateNeighborScore(neighbors, getScore) {
  let weightedScore = 0;
  let totalWeight = 0;
  for (const neighbor of neighbors) {
    const weight = neighbor.similarity ** 3;
    weightedScore += getScore(neighbor.score) * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? clampScore(weightedScore / totalWeight) : 0;
}

function inferDeckStyleScore(deckId, deckinfo, neighbors, styleDefinitions) {
  const fractionalStyles = Object.fromEntries(
    styleDefinitions.map((style) => [
      style.name,
      aggregateNeighborScore(neighbors, (score) => styleScoreValue(score, style.name)),
    ]),
  );
  const primaryStyle = styleDefinitions
    .map((style) => ({ name: style.name, score: fractionalStyles[style.name] ?? 0 }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))[0];
  if (!primaryStyle || primaryStyle.score <= 0) return null;

  const fractionalSubStyles = Object.fromEntries(
    styleDefinitions.map((style) => [
      style.name,
      Object.fromEntries(
        style.subStyles.map((subStyle) => [
          subStyle.name,
          aggregateNeighborScore(
            neighbors,
            (score) => subStyleScoreValue(score, style.name, subStyle.name),
          ),
        ]),
      ),
    ]),
  );
  const primarySubStyle = styleDefinitions
    .find((style) => style.name === primaryStyle.name)
    ?.subStyles.map((subStyle) => ({
      name: subStyle.name,
      score: fractionalSubStyles[primaryStyle.name]?.[subStyle.name] ?? 0,
    }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))[0];
  const topSubStyles = styleDefinitions
    .flatMap((style) => style.subStyles.map((subStyle) => ({
      style: style.name,
      subStyle: subStyle.name,
      score: fractionalSubStyles[style.name]?.[subStyle.name] ?? 0,
    })))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => (
      right.score - left.score ||
      left.style.localeCompare(right.style) ||
      left.subStyle.localeCompare(right.subStyle)
    ))
    .slice(0, 6);
  const closest = neighbors[0];

  return {
    avatar: typeof deckinfo.avatar === "string" ? deckinfo.avatar : "",
    deckName: typeof deckinfo.name === "string" ? deckinfo.name : deckId,
    style: primaryStyle.name,
    subStyle: primarySubStyle?.name ?? "",
    subStyleScore: primarySubStyle?.score ?? 0,
    fractionalStyles,
    fractionalSubStyles,
    topSubStyles,
    inferred: {
      method: STYLE_INFERENCE_METHOD,
      neighborCount: neighbors.length,
      closestDeckId: closest.deckId,
      closestSimilarity: Math.round(closest.similarity * 10000) / 10000,
    },
    notes: `Automatically inferred from ${neighbors.length} similar scored decklists; closest source deck ${closest.deckId}.`,
  };
}

export function inferMissingDeckStyleScores({
  styleScores,
  taxonomy,
  archive,
  cards,
  neighborCount = DEFAULT_STYLE_INFERENCE_NEIGHBORS,
}) {
  const rarityByCard = buildRarityByCard(cards);
  const styleDefinitions = buildStyleDefinitions(taxonomy);
  const vectors = new Map();
  for (const [deckId, archiveEntry] of Object.entries(archive)) {
    const vector = buildStyleInferenceVector(archiveEntry?.deckinfo, rarityByCard);
    if (vector.size > 0) vectors.set(deckId, vector);
  }

  const inverseDocumentFrequency = buildInverseDocumentFrequency(vectors);
  const norms = new Map(
    [...vectors.entries()].map(([deckId, vector]) => [
      deckId,
      vectorNorm(vector, inverseDocumentFrequency),
    ]),
  );
  const seedDecks = Object.entries(styleScores)
    .filter(([deckId, score]) => vectors.has(deckId) && isRecord(score))
    .map(([deckId, score]) => ({ deckId, score, vector: vectors.get(deckId) }))
    .sort((left, right) => left.deckId.localeCompare(right.deckId));
  const combinedStyleScores = { ...styleScores };
  const inferredDeckIds = [];
  const unscoredDeckIds = [];

  for (const [deckId, archiveEntry] of Object.entries(archive).sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    if (isRecord(combinedStyleScores[deckId])) continue;
    const vector = vectors.get(deckId);
    const norm = norms.get(deckId) ?? 0;
    if (!vector || norm <= 0) {
      unscoredDeckIds.push(deckId);
      continue;
    }

    const candidates = seedDecks
      .map((seed) => ({
        deckId: seed.deckId,
        score: seed.score,
        similarity: vectorSimilarity(
          vector,
          seed.vector,
          inverseDocumentFrequency,
          norm,
          norms.get(seed.deckId) ?? 0,
        ),
      }))
      .filter((neighbor) => neighbor.similarity > 0)
      .sort((left, right) => (
        right.similarity - left.similarity || left.deckId.localeCompare(right.deckId)
      ));
    const bestSimilarity = candidates[0]?.similarity ?? 0;
    const neighbors = candidates
      .filter((candidate) => candidate.similarity >= bestSimilarity * 0.45)
      .slice(0, Math.max(1, neighborCount));
    const inferred = neighbors.length > 0
      ? inferDeckStyleScore(deckId, archiveEntry?.deckinfo ?? {}, neighbors, styleDefinitions)
      : null;
    if (!inferred) {
      unscoredDeckIds.push(deckId);
      continue;
    }
    combinedStyleScores[deckId] = inferred;
    inferredDeckIds.push(deckId);
  }

  return {
    styleScores: combinedStyleScores,
    summary: {
      method: STYLE_INFERENCE_METHOD,
      sourceDeckCount: seedDecks.length,
      inferredDeckCount: inferredDeckIds.length,
      unscoredDeckCount: unscoredDeckIds.length,
      inferredDeckIds,
      unscoredDeckIds,
    },
  };
}

function buildStyleDefinitions(taxonomy) {
  const styleEntries = taxonomy.deckStyles ?? {};
  const order = Array.isArray(taxonomy.displayOrder?.deckStyles)
    ? taxonomy.displayOrder.deckStyles
    : Object.keys(styleEntries);
  const names = [
    ...order,
    ...Object.keys(styleEntries).filter((name) => !order.includes(name)),
  ];

  return names.map((name) => {
    const entry = styleEntries[name] ?? {};
    const subStyles = entry.subStyles ?? {};
    return {
      id: canonicalizeId(name),
      name,
      tooltip: typeof entry.tooltip === "string" ? entry.tooltip : "",
      description: typeof entry.description === "string" ? entry.description : "",
      subStyles: Object.entries(subStyles).map(([subName, description]) => ({
        id: canonicalizeId(subName),
        name: subName,
        tooltip: typeof description === "string" ? description : "",
        description: typeof description === "string" ? description : "",
      })),
    };
  });
}

function getStyleClusterDeckIds(styleScores, styleName, mode) {
  return Object.entries(styleScores)
    .filter(([, score]) => {
      if (mode === "primary") return score.style === styleName;
      return (score.fractionalStyles?.[styleName] ?? 0) > 0;
    })
    .map(([deckId]) => deckId);
}

function getSubStyleClusterDeckIds(styleScores, styleName, subStyleName, mode) {
  return Object.entries(styleScores)
    .filter(([, score]) => {
      if (mode === "primary") return score.style === styleName && score.subStyle === subStyleName;
      return (score.fractionalSubStyles?.[styleName]?.[subStyleName] ?? 0) > 0;
    })
    .map(([deckId]) => deckId);
}

function serializeCards(cardMap) {
  const entries = [...cardMap.entries()]
    .map(([cardName, value]) => [
      cardName,
      {
        score: displayScore(value.contribution),
        deckCount: value.deckIds.size,
        weightedDecks: Math.round(value.weightedDecks * 10000) / 10000,
        examples: value.examples,
      },
    ])
    .filter(([, value]) => value.score > 0)
    .sort((left, right) => {
      const scoreDelta = right[1].score - left[1].score;
      if (scoreDelta !== 0) return scoreDelta;
      return left[0].localeCompare(right[0]);
    });
  return Object.fromEntries(entries);
}

function serializeDeckRefs({ deckIds, styleScores, runtimeDecks, scoreForDeck }) {
  return deckIds
    .map((deckId) => {
      const deck = runtimeDecks[deckId];
      if (!deck) return null;
      const score = displayScore(clampScore(scoreForDeck(styleScores[deckId])));
      if (score <= 0) return null;
      return { deckId, score };
    })
    .filter((entry) => entry !== null)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      const leftDeck = runtimeDecks[left.deckId];
      const rightDeck = runtimeDecks[right.deckId];
      const avatarDelta = String(leftDeck?.avatar ?? "").localeCompare(
        String(rightDeck?.avatar ?? ""),
      );
      if (avatarDelta !== 0) return avatarDelta;
      return String(leftDeck?.name ?? left.deckId).localeCompare(
        String(rightDeck?.name ?? right.deckId),
      );
    });
}

function buildCardsForDeckIds({
  deckIds,
  styleScores,
  archive,
  rarityByCard,
  scoreForDeck,
  alpha,
}) {
  const cards = new Map();
  const clusterSize = deckIds.length;
  if (clusterSize === 0) return cards;
  const deckWeight = 1 / clusterSize ** alpha;

  for (const deckId of deckIds) {
    const score = clampScore(scoreForDeck(styleScores[deckId]));
    if (score <= 0) continue;
    const deckinfo = archive[deckId]?.deckinfo;
    if (!deckinfo) continue;
    const deckName = styleScores[deckId]?.deckName ?? deckinfo.name ?? deckId;
    for (const [cardName, saturation] of normalizeDeckCards(deckinfo, rarityByCard)) {
      addCardContribution(cards, cardName, score * saturation * deckWeight, deckName, deckWeight);
    }
  }

  return cards;
}

export function buildDeckStyleAssociations({
  styleScores,
  taxonomy,
  archive,
  cards,
  alpha = DEFAULT_ALPHA,
  inferMissingStyles = true,
  inferenceNeighborCount = DEFAULT_STYLE_INFERENCE_NEIGHBORS,
}) {
  const inference = inferMissingStyles
    ? inferMissingDeckStyleScores({
        styleScores,
        taxonomy,
        archive,
        cards,
        neighborCount: inferenceNeighborCount,
      })
    : {
        styleScores,
        summary: {
          method: "source-only",
          sourceDeckCount: Object.keys(styleScores).filter((deckId) => deckId in archive).length,
          inferredDeckCount: 0,
          unscoredDeckCount: Object.keys(archive).filter((deckId) => !(deckId in styleScores)).length,
          inferredDeckIds: [],
          unscoredDeckIds: Object.keys(archive).filter((deckId) => !(deckId in styleScores)),
        },
      };
  const effectiveStyleScores = inference.styleScores;
  const rarityByCard = buildRarityByCard(cards);
  const cardByName = buildCardByName(cards);
  const runtimeDecks = {};
  for (const deckId of Object.keys(archive).sort()) {
    const deck = archiveDeckToRuntimeDeck(deckId, archive[deckId], cardByName);
    if (deck) {
      runtimeDecks[deckId] = deck;
    }
  }
  const styles = buildStyleDefinitions(taxonomy);
  const modes = {
    primary: { styles: {} },
    fractional: { styles: {} },
  };

  for (const mode of Object.keys(modes)) {
    for (const style of styles) {
      const styleDeckIds = getStyleClusterDeckIds(effectiveStyleScores, style.name, mode);
      const styleCards = buildCardsForDeckIds({
        deckIds: styleDeckIds,
        styleScores: effectiveStyleScores,
        archive,
        rarityByCard,
        alpha,
        scoreForDeck: (score) => score?.fractionalStyles?.[style.name] ?? 0,
      });
      const styleDecks = serializeDeckRefs({
        deckIds: styleDeckIds,
        styleScores: effectiveStyleScores,
        runtimeDecks,
        scoreForDeck: (score) => score?.fractionalStyles?.[style.name] ?? 0,
      });
      const subStyles = {};
      for (const subStyle of style.subStyles) {
        const subDeckIds = getSubStyleClusterDeckIds(
          effectiveStyleScores,
          style.name,
          subStyle.name,
          mode,
        );
        const subCards = buildCardsForDeckIds({
          deckIds: subDeckIds,
          styleScores: effectiveStyleScores,
          archive,
          rarityByCard,
          alpha,
          scoreForDeck: (score) => score?.fractionalSubStyles?.[style.name]?.[subStyle.name] ?? 0,
        });
        const subDecks = serializeDeckRefs({
          deckIds: subDeckIds,
          styleScores: effectiveStyleScores,
          runtimeDecks,
          scoreForDeck: (score) => score?.fractionalSubStyles?.[style.name]?.[subStyle.name] ?? 0,
        });
        subStyles[subStyle.id] = {
          id: subStyle.id,
          name: subStyle.name,
          cards: serializeCards(subCards),
          decks: subDecks,
        };
      }
      modes[mode].styles[style.id] = {
        id: style.id,
        name: style.name,
        cards: serializeCards(styleCards),
        decks: styleDecks,
        subStyles,
      };
    }
  }

  return {
    version: "sorcery-deck-style-associations-v2",
    generatedAt: new Date().toISOString(),
    alpha,
    styleScoring: {
      method: inference.summary.method,
      sourceDeckCount: inference.summary.sourceDeckCount,
      inferredDeckCount: inference.summary.inferredDeckCount,
      unscoredDeckCount: inference.summary.unscoredDeckCount,
    },
    styles,
    decks: runtimeDecks,
    modes,
  };
}

export function parseArgs(argv) {
  const options = {
    styleScoresPath: DEFAULT_STYLE_SCORE_PATH,
    taxonomyPath: DEFAULT_TAXONOMY_PATH,
    archivePath: DEFAULT_ARCHIVE_PATH,
    cardDataPath: DEFAULT_CARD_DATA_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    alpha: DEFAULT_ALPHA,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--style-scores" && value) {
      options.styleScoresPath = value;
      i += 1;
    } else if (arg === "--taxonomy" && value) {
      options.taxonomyPath = value;
      i += 1;
    } else if (arg === "--archive" && value) {
      options.archivePath = value;
      i += 1;
    } else if (arg === "--card-data" && value) {
      options.cardDataPath = value;
      i += 1;
    } else if (arg === "--output" && value) {
      options.outputPath = value;
      i += 1;
    } else if (arg === "--alpha" && value) {
      options.alpha = Number(value);
      i += 1;
    }
  }

  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function runDeckStyleAssociationBuild(overrides = {}) {
  const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const options = {
    ...parseArgs([]),
    ...overrides,
  };
  const [styleScores, taxonomy, archive, cards] = await Promise.all([
    readJson(path.resolve(root, options.styleScoresPath)),
    readJson(path.resolve(root, options.taxonomyPath)),
    readJson(path.resolve(root, options.archivePath)),
    readJson(path.resolve(root, options.cardDataPath)),
  ]);
  const output = buildDeckStyleAssociations({
    styleScores,
    taxonomy,
    archive,
    cards,
    alpha: options.alpha,
  });
  const outputPath = path.resolve(root, options.outputPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output)}\n`);
  return { output, outputPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runDeckStyleAssociationBuild(options);
  const scoring = result.output.styleScoring;
  console.log(
    `Wrote ${result.outputPath}: source=${scoring.sourceDeckCount} inferred=${scoring.inferredDeckCount} unscored=${scoring.unscoredDeckCount}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
