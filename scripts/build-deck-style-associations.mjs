import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_STYLE_SCORE_PATH = "tmp/sorcery_deck_style_scores_with_substyles.json";
const DEFAULT_TAXONOMY_PATH = "tmp/sorcery_taxonomy_tooltips.json";
const DEFAULT_ARCHIVE_PATH = "offlineData/deckArchive.json";
const DEFAULT_CARD_DATA_PATH = "docs/Sorcery_CardInfo.json";
const DEFAULT_OUTPUT_PATH = "public/assets/sorcery_deck_style_associations.json";
const DEFAULT_ALPHA = 1;
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
}) {
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
      const styleDeckIds = getStyleClusterDeckIds(styleScores, style.name, mode);
      const styleCards = buildCardsForDeckIds({
        deckIds: styleDeckIds,
        styleScores,
        archive,
        rarityByCard,
        alpha,
        scoreForDeck: (score) => score?.fractionalStyles?.[style.name] ?? 0,
      });
      const styleDecks = serializeDeckRefs({
        deckIds: styleDeckIds,
        styleScores,
        runtimeDecks,
        scoreForDeck: (score) => score?.fractionalStyles?.[style.name] ?? 0,
      });
      const subStyles = {};
      for (const subStyle of style.subStyles) {
        const subDeckIds = getSubStyleClusterDeckIds(
          styleScores,
          style.name,
          subStyle.name,
          mode,
        );
        const subCards = buildCardsForDeckIds({
          deckIds: subDeckIds,
          styleScores,
          archive,
          rarityByCard,
          alpha,
          scoreForDeck: (score) => score?.fractionalSubStyles?.[style.name]?.[subStyle.name] ?? 0,
        });
        const subDecks = serializeDeckRefs({
          deckIds: subDeckIds,
          styleScores,
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
  await runDeckStyleAssociationBuild(options);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
