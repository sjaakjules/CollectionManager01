import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ARCHIVE_PATH = 'tmp/deckArchive.json';
const DEFAULT_CARD_DATA_PATH = 'docs/Sorcery_CardInfo.json';
const DEFAULT_OUTPUT_PATH = 'public/assets/sorcery_card_associations.json';

export const DEFAULT_ASSOCIATION_OPTIONS = {
  topLinks: 60,
  minEvidence: 3,
  similarityThreshold: 0.32,
  weights: {
    spellbook: 0.75,
    atlas: 0.15,
    collection: 0.05,
    avatar: 0.05,
  },
};

export const RARITY_LIMITS = {
  Ordinary: 4,
  Exceptional: 3,
  Elite: 2,
  Unique: 1,
};

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseQuantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sortedEntries(record) {
  if (!isRecord(record)) return [];
  return Object.entries(record)
    .map(([name, quantity]) => [name, parseQuantity(quantity)])
    .filter(([name, quantity]) => name.trim() && quantity > 0)
    .sort(([left], [right]) => left.localeCompare(right));
}

function incrementMap(map, key, amount) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function incrementNestedMap(root, from, to, amount) {
  let inner = root.get(from);
  if (!inner) {
    inner = new Map();
    root.set(from, inner);
  }
  inner.set(to, (inner.get(to) ?? 0) + amount);
}

function addEvidence(root, from, to, deckId, clusterId) {
  const key = `${from}\u0000${to}`;
  let evidence = root.get(key);
  if (!evidence) {
    evidence = { exampleDeckIds: [], clusterIds: new Set() };
    root.set(key, evidence);
  }
  if (evidence.exampleDeckIds.length < 8 && !evidence.exampleDeckIds.includes(deckId)) {
    evidence.exampleDeckIds.push(deckId);
  }
  evidence.clusterIds.add(clusterId);
}

function getCardStats(card) {
  const guardian = isRecord(card?.guardian) ? card.guardian : {};
  const setStats = Array.isArray(card?.sets)
    ? card.sets.map((set) => set?.metadata).find((metadata) => isRecord(metadata))
    : null;
  return {
    type: typeof guardian.type === 'string' ? guardian.type : setStats?.type ?? null,
    rarity:
      typeof guardian.rarity === 'string' && guardian.rarity in RARITY_LIMITS
        ? guardian.rarity
        : typeof setStats?.rarity === 'string' && setStats.rarity in RARITY_LIMITS
          ? setStats.rarity
          : null,
  };
}

export function buildCardMetadata(cards) {
  const metadata = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || typeof card.name !== 'string' || !card.name.trim()) continue;
    metadata.set(card.name, getCardStats(card));
  }
  return metadata;
}

export function getRarityLimit(cardName, metadata, quantity = 1) {
  const rarity = metadata.get(cardName)?.rarity ?? null;
  if (rarity && rarity in RARITY_LIMITS) return RARITY_LIMITS[rarity];
  return Math.max(1, quantity);
}

export function copySaturation(quantity, rarityLimit) {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(rarityLimit) || rarityLimit <= 0) return 1;
  return Math.min(1, quantity / rarityLimit);
}

function boardToQuantityMap(board) {
  const map = new Map();
  for (const [name, quantity] of sortedEntries(board)) {
    map.set(name, quantity);
  }
  return map;
}

export function normalizeDeckArchive(archive) {
  const decks = [];
  const entries = Array.isArray(archive)
    ? archive.map((deck, index) => [deck?.deckinfo?.id ?? `deck-${index + 1}`, deck])
    : Object.entries(isRecord(archive) ? archive : {});

  for (const [archiveId, value] of entries) {
    const deckinfo = isRecord(value?.deckinfo) ? value.deckinfo : value;
    if (!isRecord(deckinfo)) continue;

    const id =
      typeof deckinfo.id === 'string' && deckinfo.id.trim()
        ? deckinfo.id.trim()
        : String(archiveId);
    const cards = isRecord(deckinfo.cards) ? deckinfo.cards : {};
    const spellbook = boardToQuantityMap(cards.spellbook);
    const atlas = boardToQuantityMap(cards.atlas);
    const collection = boardToQuantityMap(cards.collection);
    const avatar =
      typeof deckinfo.avatar === 'string' && deckinfo.avatar.trim()
        ? deckinfo.avatar.trim()
        : null;
    const main = new Map();

    if (avatar) main.set(avatar, 1);
    for (const [name, quantity] of spellbook) main.set(name, quantity);
    for (const [name, quantity] of atlas) {
      main.set(name, (main.get(name) ?? 0) + quantity);
    }

    decks.push({
      id,
      name: typeof deckinfo.name === 'string' && deckinfo.name.trim() ? deckinfo.name.trim() : id,
      avatar,
      spellbook,
      atlas,
      collection,
      main,
    });
  }

  return decks.sort((left, right) => left.id.localeCompare(right.id));
}

export function buildSaturationVector(board, metadata) {
  const vector = new Map();
  for (const [name, quantity] of board) {
    vector.set(name, copySaturation(quantity, getRarityLimit(name, metadata, quantity)));
  }
  return vector;
}

export function weightedJaccard(left, right) {
  let numerator = 0;
  let denominator = 0;
  const keys = new Set([...left.keys(), ...right.keys()]);

  for (const key of keys) {
    const leftValue = left.get(key) ?? 0;
    const rightValue = right.get(key) ?? 0;
    numerator += Math.min(leftValue, rightValue);
    denominator += Math.max(leftValue, rightValue);
  }

  return denominator > 0 ? numerator / denominator : 0;
}

export function buildDeckIdentityVectors(decks, metadata) {
  return decks.map((deck) => ({
    spellbook: buildSaturationVector(deck.spellbook, metadata),
    atlas: buildSaturationVector(deck.atlas, metadata),
    collection: buildSaturationVector(deck.collection, metadata),
    avatar: deck.avatar,
  }));
}

export function deckSimilarity(left, right, weights = DEFAULT_ASSOCIATION_OPTIONS.weights) {
  const avatarMatch = left.avatar && right.avatar && left.avatar === right.avatar ? 1 : 0;
  return (
    weights.spellbook * weightedJaccard(left.spellbook, right.spellbook) +
    weights.atlas * weightedJaccard(left.atlas, right.atlas) +
    weights.collection * weightedJaccard(left.collection, right.collection) +
    weights.avatar * avatarMatch
  );
}

export function buildDeckGraph(vectors, options = DEFAULT_ASSOCIATION_OPTIONS) {
  const adjacency = Array.from({ length: vectors.length }, () => new Map());
  const threshold = options.similarityThreshold ?? DEFAULT_ASSOCIATION_OPTIONS.similarityThreshold;

  for (let left = 0; left < vectors.length; left += 1) {
    for (let right = left + 1; right < vectors.length; right += 1) {
      const similarity = deckSimilarity(vectors[left], vectors[right], options.weights);
      if (similarity < threshold) continue;
      adjacency[left].set(right, similarity);
      adjacency[right].set(left, similarity);
    }
  }

  return adjacency;
}

function calculateModularity(adjacency, communities) {
  let totalEdgeWeight = 0;
  const degrees = adjacency.map((neighbors) => {
    let degree = 0;
    for (const weight of neighbors.values()) degree += weight;
    return degree;
  });

  for (let node = 0; node < adjacency.length; node += 1) {
    for (const [neighbor, weight] of adjacency[node]) {
      if (node < neighbor) totalEdgeWeight += weight;
    }
  }

  if (totalEdgeWeight <= 0) return 0;

  const communityStats = new Map();
  for (let node = 0; node < communities.length; node += 1) {
    const community = communities[node];
    const stats = communityStats.get(community) ?? { internal: 0, totalDegree: 0 };
    stats.totalDegree += degrees[node];
    communityStats.set(community, stats);
  }

  for (let node = 0; node < adjacency.length; node += 1) {
    for (const [neighbor, weight] of adjacency[node]) {
      if (node < neighbor && communities[node] === communities[neighbor]) {
        communityStats.get(communities[node]).internal += 2 * weight;
      }
    }
  }

  const doubleTotal = 2 * totalEdgeWeight;
  let modularity = 0;
  for (const stats of communityStats.values()) {
    modularity += stats.internal / doubleTotal - (stats.totalDegree / doubleTotal) ** 2;
  }
  return modularity;
}

export function runLouvainLikeClustering(adjacency) {
  const communities = adjacency.map((_, index) => index);
  if (adjacency.every((neighbors) => neighbors.size === 0)) {
    return communities.map((_, index) => `cluster-${index + 1}`);
  }

  const nodeOrder = adjacency
    .map((neighbors, index) => ({
      index,
      degree: [...neighbors.values()].reduce((sum, value) => sum + value, 0),
    }))
    .sort((left, right) => right.degree - left.degree || left.index - right.index)
    .map((entry) => entry.index);

  let currentModularity = calculateModularity(adjacency, communities);
  let changed = true;
  let passes = 0;

  while (changed && passes < 25) {
    changed = false;
    passes += 1;

    for (const node of nodeOrder) {
      const originalCommunity = communities[node];
      const candidates = new Set([originalCommunity]);
      for (const neighbor of adjacency[node].keys()) {
        candidates.add(communities[neighbor]);
      }

      let bestCommunity = originalCommunity;
      let bestModularity = currentModularity;

      for (const candidate of [...candidates].sort((left, right) => left - right)) {
        if (candidate === originalCommunity) continue;
        communities[node] = candidate;
        const modularity = calculateModularity(adjacency, communities);
        if (modularity > bestModularity + 1e-10) {
          bestModularity = modularity;
          bestCommunity = candidate;
        }
      }

      communities[node] = bestCommunity;
      if (bestCommunity !== originalCommunity) {
        currentModularity = bestModularity;
        changed = true;
      }
    }
  }

  const remap = new Map();
  let nextCluster = 1;
  return communities.map((community) => {
    if (!remap.has(community)) {
      remap.set(community, `cluster-${nextCluster}`);
      nextCluster += 1;
    }
    return remap.get(community);
  });
}

export function calculateDeckWeights(clusterIds) {
  const sizes = new Map();
  for (const clusterId of clusterIds) {
    sizes.set(clusterId, (sizes.get(clusterId) ?? 0) + 1);
  }
  return clusterIds.map((clusterId) => 1 / Math.sqrt(sizes.get(clusterId) ?? 1));
}

function channelKey(sourceZone, targetZone) {
  if (sourceZone === 'main' && targetZone === 'main') return 'mainMain';
  if (sourceZone === 'main' && targetZone === 'collection') return 'mainCollection';
  if (sourceZone === 'collection' && targetZone === 'collection') return 'collectionCollection';
  throw new Error(`Unsupported association channel: ${sourceZone}-${targetZone}`);
}

function zoneMap(deck, zone) {
  return zone === 'main' ? deck.main : deck.collection;
}

function calculateChannelStats(decks, deckWeights, clusterIds, sourceZone, targetZone, options) {
  const countA = new Map();
  const countB = new Map();
  const coCounts = new Map();
  const evidence = new Map();
  const totalWeight = deckWeights.reduce((sum, weight) => sum + weight, 0);

  for (let deckIndex = 0; deckIndex < decks.length; deckIndex += 1) {
    const deck = decks[deckIndex];
    const weight = deckWeights[deckIndex] ?? 0;
    const clusterId = clusterIds[deckIndex] ?? `cluster-${deckIndex + 1}`;
    const sourceCards = [...zoneMap(deck, sourceZone).keys()].sort((a, b) => a.localeCompare(b));
    const targetCards = [...zoneMap(deck, targetZone).keys()].sort((a, b) => a.localeCompare(b));

    for (const card of sourceCards) incrementMap(countA, card, weight);
    for (const card of targetCards) incrementMap(countB, card, weight);

    for (const from of sourceCards) {
      for (const to of targetCards) {
        if (from === to) continue;
        incrementNestedMap(coCounts, from, to, weight);
        addEvidence(evidence, from, to, deck.id, clusterId);
      }
    }
  }

  const channel = channelKey(sourceZone, targetZone);
  const result = new Map();
  const minEvidence = options.minEvidence ?? DEFAULT_ASSOCIATION_OPTIONS.minEvidence;

  for (const [from, targets] of coCounts) {
    for (const [to, coCount] of targets) {
      const fromCount = countA.get(from) ?? 0;
      const toCount = countB.get(to) ?? 0;
      if (fromCount <= 0 || toCount <= 0 || totalWeight <= 0) continue;

      const confidence = coCount / fromCount;
      const baseline = toCount / totalWeight;
      const lift = baseline > 0 ? confidence / baseline : 0;
      const reliability = coCount / (coCount + minEvidence);
      const confidenceComponent = Math.sqrt(confidence);
      const liftComponent = Math.min(1, Math.log2(lift + 1) / 3);
      const score = Math.round(100 * reliability * confidenceComponent * liftComponent);
      if (score <= 0) continue;

      const statsEvidence = evidence.get(`${from}\u0000${to}`);
      let links = result.get(from);
      if (!links) {
        links = new Map();
        result.set(from, links);
      }
      links.set(to, {
        channel,
        score,
        confidence,
        lift,
        coCount,
        countA: fromCount,
        countB: toCount,
        totalWeight,
        exampleDeckIds: statsEvidence?.exampleDeckIds ?? [],
        clusterIds: [...(statsEvidence?.clusterIds ?? new Set())].sort(),
      });
    }
  }

  return result;
}

function roundNumber(value, places = 4) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function serializeStats(stats) {
  return {
    score: stats.score,
    confidence: roundNumber(stats.confidence),
    lift: roundNumber(stats.lift),
    coCount: roundNumber(stats.coCount),
    countA: roundNumber(stats.countA),
    countB: roundNumber(stats.countB),
    totalWeight: roundNumber(stats.totalWeight),
    exampleDeckIds: stats.exampleDeckIds,
    clusterIds: stats.clusterIds,
  };
}

function mergeChannel(index, channelStats) {
  for (const [from, targets] of channelStats) {
    let fromLinks = index.get(from);
    if (!fromLinks) {
      fromLinks = new Map();
      index.set(from, fromLinks);
    }
    for (const [to, stats] of targets) {
      const existing = fromLinks.get(to) ?? { to };
      existing[stats.channel] = serializeStats(stats);
      fromLinks.set(to, existing);
    }
  }
}

function topScore(link) {
  return Math.max(
    link.mainMain?.score ?? 0,
    link.mainCollection?.score ?? 0,
    link.collectionCollection?.score ?? 0,
  );
}

function serializeIndex(index, topLinks) {
  const serialized = {};
  for (const [from, links] of [...index].sort(([left], [right]) => left.localeCompare(right))) {
    const top = [...links.values()]
      .sort((left, right) => topScore(right) - topScore(left) || left.to.localeCompare(right.to))
      .slice(0, topLinks);
    if (top.length > 0) serialized[from] = top;
  }
  return serialized;
}

export function buildCardAssociations(archive, cards, userOptions = {}) {
  const options = {
    ...DEFAULT_ASSOCIATION_OPTIONS,
    ...userOptions,
    weights: {
      ...DEFAULT_ASSOCIATION_OPTIONS.weights,
      ...(userOptions.weights ?? {}),
    },
  };
  const metadata = buildCardMetadata(cards);
  const decks = normalizeDeckArchive(archive);
  const vectors = buildDeckIdentityVectors(decks, metadata);
  const graph = buildDeckGraph(vectors, options);
  const clusterIds = runLouvainLikeClustering(graph);
  const deckWeights = calculateDeckWeights(clusterIds);
  const index = new Map();

  mergeChannel(index, calculateChannelStats(decks, deckWeights, clusterIds, 'main', 'main', options));
  mergeChannel(
    index,
    calculateChannelStats(decks, deckWeights, clusterIds, 'main', 'collection', options),
  );
  mergeChannel(
    index,
    calculateChannelStats(decks, deckWeights, clusterIds, 'collection', 'collection', options),
  );

  const clusterSizes = {};
  for (const clusterId of clusterIds) {
    clusterSizes[clusterId] = (clusterSizes[clusterId] ?? 0) + 1;
  }

  const deckNames = {};
  const collectionNodeNames = new Set();
  for (const deck of decks) {
    deckNames[deck.id] = deck.name;
    for (const cardName of deck.collection.keys()) collectionNodeNames.add(cardName);
  }

  return {
    __meta: {
      version: 1,
      generatedAt: new Date().toISOString(),
      deckCount: decks.length,
      clusterCount: Object.keys(clusterSizes).length,
      clusterSizes,
      options: {
        topLinks: options.topLinks,
        minEvidence: options.minEvidence,
        similarityThreshold: options.similarityThreshold,
        weights: options.weights,
      },
      deckNames,
      collectionNodeNames: [...collectionNodeNames].sort((left, right) => left.localeCompare(right)),
    },
    index: serializeIndex(index, options.topLinks),
  };
}

function parseNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for ${flagName}: ${value}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Build card/avatar association graph from a Curiosa deck archive.

Usage:
  node scripts/build-card-associations.mjs --archive tmp/deckArchive.json --output public/assets/sorcery_card_associations.json

Options:
      --archive <file>       Deck archive JSON. Defaults to ${DEFAULT_ARCHIVE_PATH}
      --card-data <file>     Card catalog JSON. Defaults to ${DEFAULT_CARD_DATA_PATH}
      --output <file>        Output JSON. Defaults to ${DEFAULT_OUTPUT_PATH}
      --top-links <n>        Links per source node. Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.topLinks}
      --threshold <n>        Deck graph threshold. Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.similarityThreshold}
      --min-evidence <n>     Reliability midpoint. Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.minEvidence}
      --spellbook-weight <n> Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.weights.spellbook}
      --atlas-weight <n>     Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.weights.atlas}
      --collection-weight <n> Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.weights.collection}
      --avatar-weight <n>    Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.weights.avatar}
  -h, --help                 Show this help.
`);
}

export function parseArgs(argv) {
  const options = {
    archive: DEFAULT_ARCHIVE_PATH,
    cardData: DEFAULT_CARD_DATA_PATH,
    output: DEFAULT_OUTPUT_PATH,
    help: false,
    associationOptions: {
      ...DEFAULT_ASSOCIATION_OPTIONS,
      weights: { ...DEFAULT_ASSOCIATION_OPTIONS.weights },
    },
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length || !argv[index]) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[index];
    };

    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--archive') {
      options.archive = next();
    } else if (arg === '--card-data') {
      options.cardData = next();
    } else if (arg === '--output') {
      options.output = next();
    } else if (arg === '--top-links') {
      options.associationOptions.topLinks = Math.max(1, Math.floor(parseNumber(next(), arg)));
    } else if (arg === '--threshold') {
      options.associationOptions.similarityThreshold = parseNumber(next(), arg);
    } else if (arg === '--min-evidence') {
      options.associationOptions.minEvidence = Math.max(0, parseNumber(next(), arg));
    } else if (arg === '--spellbook-weight') {
      options.associationOptions.weights.spellbook = parseNumber(next(), arg);
    } else if (arg === '--atlas-weight') {
      options.associationOptions.weights.atlas = parseNumber(next(), arg);
    } else if (arg === '--collection-weight') {
      options.associationOptions.weights.collection = parseNumber(next(), arg);
    } else if (arg === '--avatar-weight') {
      options.associationOptions.weights.avatar = parseNumber(next(), arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function runBuild(options) {
  const archive = await readJson(options.archive);
  const cards = await readJson(options.cardData);
  const associations = buildCardAssociations(archive, cards, options.associationOptions);
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, `${JSON.stringify(associations)}\n`);
  return associations;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const associations = await runBuild(options);
  console.log(
    `Wrote ${options.output}: ${Object.keys(associations.index).length} source nodes, ` +
      `${associations.__meta.deckCount} decks, ${associations.__meta.clusterCount} clusters`,
  );
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
