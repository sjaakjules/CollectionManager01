import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

const DEFAULT_ARCHIVE_PATH = 'offlineData/deckArchive.json';
const DEFAULT_CARD_DATA_PATH = 'docs/Sorcery_CardInfo.json';
const DEFAULT_OUTPUT_BASE_PATH = 'tmp/oldAssociations/sorcery_card_associations';
const DEFAULT_SKIPPED_SPELLBOOK_MIN = 50;
const DEFAULT_SKIPPED_ATLAS_MIN = 20;
const DEFAULT_FULL_SPELLBOOK_MIN = 60;
const DEFAULT_FULL_ATLAS_MIN = 30;
const ASSOCIATION_MODES = ['balanced', 'meta'];
const ELEMENT_ORDER = ['air', 'earth', 'fire', 'water'];
const ELEMENT_SYMBOLS = {
  air: '🜁',
  earth: '🜃',
  fire: '🜂',
  water: '🜄',
};
export const PACKAGE_ZONE_WEIGHTS = {
  spellbook: 1,
  atlas: 1,
  avatar: 0.75,
};

export const DEFAULT_PACKAGE_OPTIONS = {
  enabled: true,
  components: 24,
  iterations: 400,
  seed: 1337,
  epsilon: 1e-9,
  l1H: 0.002,
  l1W: 0.0005,
  minNodeStrength: 0.12,
  minCardPackageStrength: 0.18,
  minDeckMembership: 0.08,
  minNodesPerPackage: 12,
  maxNodesPerPackage: 24,
  maxPackagesPerNode: 4,
  maxPackagesPerDeck: 5,
  maxExampleDecksPerPackage: 5,
  packageBoostWeight: 0.3,
  reliabilityWeightedSupport: 6,
};

export const DEFAULT_ASSOCIATION_OPTIONS = {
  topLinks: 60,
  minEvidence: 3,
  similarityThreshold: 0.32,
  weights: {
    spellbook: 0.75,
    atlas: 0.2,
    collection: 0,
    avatar: 0.05,
  },
  filters: {
    constructedOnly: true,
    fullDecksOnly: true,
    includeSkipped: false,
    fullSpellbookMin: DEFAULT_FULL_SPELLBOOK_MIN,
    fullAtlasMin: DEFAULT_FULL_ATLAS_MIN,
  },
  packageOptions: DEFAULT_PACKAGE_OPTIONS,
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

export function canonicalizeAssociationName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function associationNodeId(kind, name) {
  const canonicalName = canonicalizeAssociationName(name);
  return `${kind}:${canonicalName || 'unknown'}`;
}

function createNode(kind, displayName) {
  const canonicalName = canonicalizeAssociationName(displayName);
  return {
    id: `${kind}:${canonicalName || 'unknown'}`,
    kind,
    displayName,
    canonicalName,
  };
}

function registerNode(nodes, kind, displayName) {
  if (!displayName) return null;
  const node = createNode(kind, displayName);
  const existing = nodes.get(node.id);
  if (existing) return existing.id;
  nodes.set(node.id, node);
  return node.id;
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
    elements: parseElementList(card?.elements),
    thresholds: normalizeThresholds(guardian.thresholds),
  };
}

function normalizeThresholds(thresholds) {
  const normalized = {};
  if (!isRecord(thresholds)) return normalized;
  for (const element of ELEMENT_ORDER) {
    const value = Number(thresholds[element]);
    if (Number.isFinite(value) && value > 0) normalized[element] = value;
  }
  return normalized;
}

function normalizeElementName(value) {
  const normalized = canonicalizeAssociationName(String(value ?? ''));
  return ELEMENT_ORDER.find((element) => normalized.includes(element)) ?? null;
}

function parseElementList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeElementName).filter(Boolean))];
  }
  if (typeof value !== 'string') return [];
  return [
    ...new Set(
      value
        .split(/[,/|+&\s]+/u)
        .map(normalizeElementName)
        .filter(Boolean),
    ),
  ];
}

export function buildCardMetadata(cards) {
  const metadata = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || typeof card.name !== 'string' || !card.name.trim()) continue;
    const kind = getCardStats(card).type === 'Avatar' ? 'avatar' : 'card';
    metadata.set(associationNodeId(kind, card.name), getCardStats(card));
  }
  return metadata;
}

export function getRarityLimit(nodeId, metadata, quantity = 1) {
  const rarity = metadata.get(nodeId)?.rarity ?? null;
  if (rarity && rarity in RARITY_LIMITS) return RARITY_LIMITS[rarity];
  return Math.max(1, quantity);
}

export function copySaturation(quantity, rarityLimit) {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(rarityLimit) || rarityLimit <= 0) return 1;
  return Math.min(1, quantity / rarityLimit);
}

function boardToQuantityMap(board, nodes, kind = 'card') {
  const map = new Map();
  for (const [name, quantity] of sortedEntries(board)) {
    const nodeId = registerNode(nodes, kind, name);
    if (!nodeId) continue;
    map.set(nodeId, (map.get(nodeId) ?? 0) + quantity);
  }
  return map;
}

function boardQuantityTotal(board) {
  return sortedEntries(board).reduce((sum, [, quantity]) => sum + quantity, 0);
}

function getDeckCardCount(deckinfo, boardName) {
  const cardCount = isRecord(deckinfo?.cardCount) ? deckinfo.cardCount : {};
  const counted = Number(cardCount[boardName]);
  if (Number.isFinite(counted) && counted >= 0) return counted;

  const cards = isRecord(deckinfo?.cards) ? deckinfo.cards : {};
  return boardQuantityTotal(cards[boardName]);
}

function getDeckFormat(entry, deckinfo) {
  const candidates = [
    deckinfo?.format,
    entry?.format,
    entry?.metadata?.format,
    entry?.hint?.format,
    entry?.deckinfo?.format,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim() ?? '';
}

function isConstructedDeck(entry, deckinfo) {
  const format = getDeckFormat(entry, deckinfo);
  return !format || format.toLowerCase() === 'constructed';
}

function isFullDeck(deckinfo, filters) {
  return (
    getDeckCardCount(deckinfo, 'spellbook') >= filters.fullSpellbookMin &&
    getDeckCardCount(deckinfo, 'atlas') >= filters.fullAtlasMin
  );
}

function createFilterSummary(sourceDeckCount) {
  return {
    sourceDeckCount,
    acceptedDeckCount: 0,
    skippedDeckCount: 0,
    missingDeckinfo: 0,
    nonConstructed: 0,
    incomplete: 0,
  };
}

function inferDeckElements(spellbook, atlas, metadata) {
  const scores = new Map();
  for (const board of [spellbook, atlas]) {
    for (const [nodeId, quantity] of board) {
      const stats = metadata.get(nodeId);
      if (!stats) continue;
      const elements =
        stats.elements.length > 0 ? stats.elements : Object.keys(stats.thresholds ?? {});
      for (const element of elements) {
        const threshold = stats.thresholds?.[element] ?? 1;
        incrementMap(scores, element, quantity * Math.max(1, threshold));
      }
    }
  }

  return [...scores]
    .filter(([element]) => ELEMENT_ORDER.includes(element))
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return ELEMENT_ORDER.indexOf(left[0]) - ELEMENT_ORDER.indexOf(right[0]);
    })
    .slice(0, 2)
    .map(([element]) => element);
}

function normalizeDeckElements(deckinfo, spellbook, atlas, metadata) {
  const declared = parseElementList(deckinfo.elements);
  return declared.length > 0 ? declared.slice(0, 2) : inferDeckElements(spellbook, atlas, metadata);
}

function normalizeDeckArchiveInternal(archive, nodes, filters = {}, metadata = new Map()) {
  const mergedFilters = {
    ...DEFAULT_ASSOCIATION_OPTIONS.filters,
    ...filters,
  };
  const entries = Array.isArray(archive)
    ? archive.map((deck, index) => [deck?.deckinfo?.id ?? `deck-${index + 1}`, deck])
    : Object.entries(isRecord(archive) ? archive : {});
  const decks = [];
  const summary = createFilterSummary(entries.length);

  for (const [archiveId, value] of entries) {
    const deckinfo = isRecord(value?.deckinfo) ? value.deckinfo : value;
    if (!isRecord(deckinfo)) {
      summary.missingDeckinfo += 1;
      summary.skippedDeckCount += 1;
      continue;
    }
    if (mergedFilters.constructedOnly && !isConstructedDeck(value, deckinfo)) {
      summary.nonConstructed += 1;
      summary.skippedDeckCount += 1;
      continue;
    }
    if (mergedFilters.fullDecksOnly && !isFullDeck(deckinfo, mergedFilters)) {
      summary.incomplete += 1;
      summary.skippedDeckCount += 1;
      continue;
    }

    const id =
      typeof deckinfo.id === 'string' && deckinfo.id.trim()
        ? deckinfo.id.trim()
        : String(archiveId);
    const cards = isRecord(deckinfo.cards) ? deckinfo.cards : {};
    const spellbook = boardToQuantityMap(cards.spellbook, nodes);
    const atlas = boardToQuantityMap(cards.atlas, nodes);
    const collection = boardToQuantityMap(cards.collection, nodes);
    const avatar =
      typeof deckinfo.avatar === 'string' && deckinfo.avatar.trim()
        ? deckinfo.avatar.trim()
        : null;
    const avatarNodeId = avatar ? registerNode(nodes, 'avatar', avatar) : null;
    const main = new Map();

    if (avatarNodeId) main.set(avatarNodeId, 1);
    for (const [nodeId, quantity] of spellbook) main.set(nodeId, quantity);
    for (const [nodeId, quantity] of atlas) {
      main.set(nodeId, (main.get(nodeId) ?? 0) + quantity);
    }

    decks.push({
      id,
      name: typeof deckinfo.name === 'string' && deckinfo.name.trim() ? deckinfo.name.trim() : id,
      avatar: avatarNodeId,
      spellbook,
      atlas,
      collection,
      main,
      elements: normalizeDeckElements(deckinfo, spellbook, atlas, metadata),
    });
    summary.acceptedDeckCount += 1;
  }

  return {
    decks: decks.sort((left, right) => left.id.localeCompare(right.id)),
    summary,
  };
}

export function normalizeDeckArchive(archive, filters = {}) {
  return normalizeDeckArchiveInternal(archive, new Map(), {
    constructedOnly: false,
    fullDecksOnly: false,
    ...filters,
  }).decks;
}

export function filterSkippedArchiveDecks(skippedArchive, options = {}) {
  const minSpellbook = options.minSpellbook ?? DEFAULT_SKIPPED_SPELLBOOK_MIN;
  const minAtlas = options.minAtlas ?? DEFAULT_SKIPPED_ATLAS_MIN;
  const entries = Object.entries(isRecord(skippedArchive) ? skippedArchive : {});
  const accepted = {};
  const summary = {
    total: entries.length,
    accepted: 0,
    missingDeckinfo: 0,
    belowMinimum: 0,
  };

  for (const [id, entry] of entries) {
    const deckinfo = isRecord(entry?.deckinfo) ? entry.deckinfo : null;
    if (!deckinfo) {
      summary.missingDeckinfo += 1;
      continue;
    }

    const spellbookCount = getDeckCardCount(deckinfo, 'spellbook');
    const atlasCount = getDeckCardCount(deckinfo, 'atlas');
    if (spellbookCount < minSpellbook || atlasCount < minAtlas) {
      summary.belowMinimum += 1;
      continue;
    }

    accepted[id] = { deckinfo, hint: entry.hint, status: entry.status, reason: entry.reason };
    summary.accepted += 1;
  }

  return { archive: accepted, summary };
}

export function mergeArchives(...archives) {
  const merged = {};
  for (const archive of archives) {
    for (const [id, entry] of Object.entries(isRecord(archive) ? archive : {})) {
      if (isRecord(merged[id]?.deckinfo)) continue;
      merged[id] = entry;
    }
  }
  return merged;
}

export function buildSaturationVector(board, metadata) {
  const vector = new Map();
  for (const [nodeId, quantity] of board) {
    vector.set(nodeId, copySaturation(quantity, getRarityLimit(nodeId, metadata, quantity)));
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

function addPackageMatrixValue(row, nodeId, value) {
  if (!nodeId || value <= 0) return;
  row.set(nodeId, Math.min(1, (row.get(nodeId) ?? 0) + value));
}

function addPackageBoardValues(row, board, metadata, zoneWeight) {
  for (const [nodeId, quantity] of board) {
    const rarityLimit = getRarityLimit(nodeId, metadata, quantity);
    addPackageMatrixValue(row, nodeId, copySaturation(quantity, rarityLimit) * zoneWeight);
  }
}

export function buildPackageMatrix(
  decks,
  deckWeights,
  metadata,
  packageOptions = DEFAULT_PACKAGE_OPTIONS,
) {
  const zoneWeights = packageOptions.zoneWeights ?? PACKAGE_ZONE_WEIGHTS;
  const rowMaps = decks.map((deck, deckIndex) => {
    const row = new Map();
    addPackageBoardValues(row, deck.spellbook, metadata, zoneWeights.spellbook ?? 1);
    addPackageBoardValues(row, deck.atlas, metadata, zoneWeights.atlas ?? 1);
    if (deck.avatar) {
      addPackageMatrixValue(row, deck.avatar, zoneWeights.avatar ?? PACKAGE_ZONE_WEIGHTS.avatar);
    }

    const rowWeight = Math.sqrt(Math.max(0, deckWeights[deckIndex] ?? 1));
    return new Map([...row].map(([nodeId, value]) => [nodeId, value * rowWeight]));
  });
  const nodeIds = [...new Set(rowMaps.flatMap((row) => [...row.keys()]))].sort((left, right) =>
    left.localeCompare(right),
  );
  const nodeIndex = new Map(nodeIds.map((nodeId, index) => [nodeId, index]));
  const matrix = rowMaps.map((row) => {
    const values = Array.from({ length: nodeIds.length }, () => 0);
    for (const [nodeId, value] of row) {
      const index = nodeIndex.get(nodeId);
      if (index !== undefined) values[index] = value;
    }
    return values;
  });

  return {
    matrix,
    nodeIds,
    deckIds: decks.map((deck) => deck.id),
  };
}

export function createSeededRandom(seed) {
  let state = Number.isFinite(seed) ? seed >>> 0 : DEFAULT_PACKAGE_OPTIONS.seed;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function transposeMatrix(matrix) {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  return Array.from({ length: cols }, (_, col) =>
    Array.from({ length: rows }, (_, row) => matrix[row][col] ?? 0),
  );
}

export function multiplyMatrices(left, right) {
  const leftRows = left.length;
  const shared = left[0]?.length ?? 0;
  const rightCols = right[0]?.length ?? 0;
  const result = Array.from({ length: leftRows }, () => Array.from({ length: rightCols }, () => 0));

  for (let i = 0; i < leftRows; i += 1) {
    for (let k = 0; k < shared; k += 1) {
      const leftValue = left[i][k] ?? 0;
      if (leftValue === 0) continue;
      for (let j = 0; j < rightCols; j += 1) {
        result[i][j] += leftValue * (right[k]?.[j] ?? 0);
      }
    }
  }

  return result;
}

function sparseRowsFromMatrix(matrix) {
  return matrix.map((row) => {
    const entries = [];
    for (let index = 0; index < row.length; index += 1) {
      const value = row[index] ?? 0;
      if (value > 0) entries.push([index, value]);
    }
    return entries;
  });
}

function multiplyTransposeLeftBySparse(W, sparseX, columnCount) {
  const n = W.length;
  const k = W[0]?.length ?? 0;
  const result = Array.from({ length: k }, () => Array.from({ length: columnCount }, () => 0));

  for (let i = 0; i < n; i += 1) {
    const rowEntries = sparseX[i] ?? [];
    if (rowEntries.length === 0) continue;
    for (let p = 0; p < k; p += 1) {
      const weight = W[i][p] ?? 0;
      if (weight === 0) continue;
      for (const [j, value] of rowEntries) {
        result[p][j] += weight * value;
      }
    }
  }

  return result;
}

function multiplySparseByTransposeRight(sparseX, H, componentCount) {
  const result = Array.from({ length: sparseX.length }, () =>
    Array.from({ length: componentCount }, () => 0),
  );

  for (let i = 0; i < sparseX.length; i += 1) {
    for (const [j, value] of sparseX[i]) {
      for (let p = 0; p < componentCount; p += 1) {
        result[i][p] += value * (H[p]?.[j] ?? 0);
      }
    }
  }

  return result;
}

export function frobeniusError(left, right) {
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) {
    const leftRow = left[i] ?? [];
    const rightRow = right[i] ?? [];
    for (let j = 0; j < leftRow.length; j += 1) {
      const delta = (leftRow[j] ?? 0) - (rightRow[j] ?? 0);
      sum += delta * delta;
    }
  }
  return Math.sqrt(sum);
}

export function normalizeNmfComponents(W, H) {
  for (let p = 0; p < H.length; p += 1) {
    const norm = Math.sqrt(H[p].reduce((sum, value) => sum + value * value, 0));
    if (norm <= 0) continue;
    for (let j = 0; j < H[p].length; j += 1) {
      H[p][j] /= norm;
    }
    for (let i = 0; i < W.length; i += 1) {
      W[i][p] *= norm;
    }
  }
}

export function runDeterministicNmf(matrix, options = DEFAULT_PACKAGE_OPTIONS) {
  const n = matrix.length;
  const m = matrix[0]?.length ?? 0;
  const k = Math.max(0, Math.floor(options.components ?? DEFAULT_PACKAGE_OPTIONS.components));
  if (n === 0 || m === 0 || k === 0) {
    return { W: [], H: [], reconstructionError: 0 };
  }

  const eps = options.epsilon ?? DEFAULT_PACKAGE_OPTIONS.epsilon;
  const rng = createSeededRandom(options.seed ?? DEFAULT_PACKAGE_OPTIONS.seed);
  const W = Array.from({ length: n }, () =>
    Array.from({ length: k }, () => 0.05 + rng() * 0.1),
  );
  const H = Array.from({ length: k }, () =>
    Array.from({ length: m }, () => 0.05 + rng() * 0.1),
  );
  const sparseX = sparseRowsFromMatrix(matrix);
  const iterations = Math.max(0, Math.floor(options.iterations ?? DEFAULT_PACKAGE_OPTIONS.iterations));
  const l1H = options.l1H ?? DEFAULT_PACKAGE_OPTIONS.l1H;
  const l1W = options.l1W ?? DEFAULT_PACKAGE_OPTIONS.l1W;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const numeratorH = multiplyTransposeLeftBySparse(W, sparseX, m);
    const denominatorH = multiplyMatrices(multiplyMatrices(transposeMatrix(W), W), H);

    for (let p = 0; p < k; p += 1) {
      for (let j = 0; j < m; j += 1) {
        H[p][j] *= numeratorH[p][j] / (denominatorH[p][j] + l1H + eps);
      }
    }

    const numeratorW = multiplySparseByTransposeRight(sparseX, H, k);
    const denominatorW = multiplyMatrices(W, multiplyMatrices(H, transposeMatrix(H)));

    for (let i = 0; i < n; i += 1) {
      for (let p = 0; p < k; p += 1) {
        W[i][p] *= numeratorW[i][p] / (denominatorW[i][p] + l1W + eps);
      }
    }

    normalizeNmfComponents(W, H);
  }

  return {
    W,
    H,
    reconstructionError: frobeniusError(matrix, multiplyMatrices(W, H)),
  };
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

function remapCommunitiesToClusterIds(communities, nodeCount) {
  const remap = new Map();
  let nextCluster = 1;
  return Array.from({ length: nodeCount }, (_, index) => {
    const community = communities[String(index)] ?? index;
    if (!remap.has(community)) {
      remap.set(community, `cluster-${nextCluster}`);
      nextCluster += 1;
    }
    return remap.get(community);
  });
}

function serializeLouvainDendrogram(dendrogram) {
  if (!Array.isArray(dendrogram)) return null;
  return dendrogram.map((level) => {
    const serialized = {};
    for (const [nodeId, community] of Object.entries(level).sort(([left], [right]) => {
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
      }
      return left.localeCompare(right);
    })) {
      serialized[nodeId] = community;
    }
    return serialized;
  });
}

export function runGraphologyLouvainClustering(adjacency) {
  const graph = new Graph({ type: 'undirected' });

  for (let nodeIndex = 0; nodeIndex < adjacency.length; nodeIndex += 1) {
    graph.addNode(String(nodeIndex));
  }

  for (let source = 0; source < adjacency.length; source += 1) {
    for (const [target, weight] of adjacency[source]) {
      if (source >= target) continue;
      graph.mergeEdge(String(source), String(target), { weight });
    }
  }

  const details = louvain.detailed(graph, {
    getEdgeWeight: 'weight',
    resolution: 1,
    randomWalk: false,
  });

  return {
    algorithm: 'graphology-louvain',
    clusterIds: remapCommunitiesToClusterIds(details.communities ?? {}, adjacency.length),
    clusterCount: details.count ?? 0,
    modularity: details.modularity,
    dendrogram: serializeLouvainDendrogram(details.dendrogram),
    level: details.level ?? 0,
  };
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

// Deterministic greedy modularity clustering, a Louvain-style approximation
// without graph coarsening.
export function runGreedyModularityClustering(adjacency) {
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

function runDeckClustering(adjacency) {
  try {
    return runGraphologyLouvainClustering(adjacency);
  } catch (error) {
    console.warn('Falling back to greedy clustering:', error);
    const clusterIds = runGreedyModularityClustering(adjacency);
    return {
      algorithm: 'greedy-modularity',
      clusterIds,
      clusterCount: new Set(clusterIds).size,
      modularity: calculateModularity(
        adjacency,
        clusterIds.map((clusterId) => Number(clusterId.replace(/^cluster-/u, ''))),
      ),
      dendrogram: null,
      level: 0,
      fallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function calculateBalancedDeckWeights(clusterIds) {
  const sizes = new Map();
  for (const clusterId of clusterIds) {
    sizes.set(clusterId, (sizes.get(clusterId) ?? 0) + 1);
  }
  return clusterIds.map((clusterId) => 1 / Math.sqrt(sizes.get(clusterId) ?? 1));
}

export function calculateMetaDeckWeights(clusterIds) {
  return clusterIds.map(() => 1);
}

export function calculateDeckWeights(clusterIds, mode = 'balanced') {
  return mode === 'meta'
    ? calculateMetaDeckWeights(clusterIds)
    : calculateBalancedDeckWeights(clusterIds);
}

function channelKey(sourceZone, targetZone) {
  if (sourceZone === 'main' && targetZone === 'main') return 'mainMain';
  if (sourceZone === 'main' && targetZone === 'collection') return 'mainToCollection';
  if (sourceZone === 'collection' && targetZone === 'main') return 'collectionToMain';
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

    for (const nodeId of sourceCards) incrementMap(countA, nodeId, weight);
    for (const nodeId of targetCards) incrementMap(countB, nodeId, weight);

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
      const liftComponent = lift <= 1 ? 0 : Math.min(1, Math.log2(lift) / 2);
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

function compareDisplayEntries(left, right, nodes) {
  const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
  if (scoreDelta !== 0) return scoreDelta;
  const weightDelta = (right.raw ?? right.weight ?? 0) - (left.raw ?? left.weight ?? 0);
  if (weightDelta !== 0) return weightDelta;
  const leftName = nodes.get(left.nodeId)?.displayName ?? left.displayName ?? left.nodeId;
  const rightName = nodes.get(right.nodeId)?.displayName ?? right.displayName ?? right.nodeId;
  const nameDelta = leftName.localeCompare(rightName);
  if (nameDelta !== 0) return nameDelta;
  return left.nodeId.localeCompare(right.nodeId);
}

export function makePackageLabel(topNodes) {
  const names = topNodes
    .slice(0, 3)
    .map((node) => node.displayName)
    .filter(Boolean);
  return names.length > 0 ? names.join(' / ') : 'Card package';
}

function normalizePackageOptions(userOptions = {}) {
  return {
    ...DEFAULT_PACKAGE_OPTIONS,
    ...userOptions,
    zoneWeights: {
      ...PACKAGE_ZONE_WEIGHTS,
      ...(userOptions.zoneWeights ?? {}),
    },
  };
}

function serializePackageOptions(options) {
  const { zoneWeights, ...rest } = options;
  return {
    ...rest,
    zoneWeights,
  };
}

function buildPackageTopNodes(H, packageIndex, nodeIds, nodes, options) {
  const row = H[packageIndex] ?? [];
  const maxWeight = Math.max(...row, 0);
  if (maxWeight <= 0) return [];

  return nodeIds
    .map((nodeId, nodeIndex) => ({
      nodeId,
      displayName: nodes.get(nodeId)?.displayName ?? nodeId,
      weight: row[nodeIndex] / maxWeight,
      raw: row[nodeIndex] ?? 0,
      score: row[nodeIndex] / maxWeight,
    }))
    .filter((entry) => entry.raw > 0)
    .sort((left, right) => compareDisplayEntries(left, right, nodes))
    .filter((entry, index) => entry.weight >= options.minNodeStrength || index < options.minNodesPerPackage)
    .slice(0, options.maxNodesPerPackage)
    .map(({ nodeId, displayName, weight }) => ({
      nodeId,
      weight: roundNumber(weight),
      displayName,
    }));
}

function buildDeckPackageRows(W, packageIds) {
  return W.map((row) => {
    const rowSum = row.reduce((sum, value) => sum + value, 0);
    return packageIds.map((packageId, packageIndex) => ({
      packageId,
      strength: rowSum > 0 ? row[packageIndex] / rowSum : 0,
      raw: row[packageIndex] ?? 0,
    }));
  });
}

function serializeDeckPackages(decks, deckPackageRows, options) {
  const deckPackages = {};
  for (let deckIndex = 0; deckIndex < decks.length; deckIndex += 1) {
    const sorted = [...(deckPackageRows[deckIndex] ?? [])].sort(
      (left, right) =>
        right.strength - left.strength || left.packageId.localeCompare(right.packageId),
    );
    const kept = sorted
      .filter((entry, index) => entry.strength >= options.minDeckMembership || index < options.maxPackagesPerDeck)
      .slice(0, options.maxPackagesPerDeck)
      .map((entry) => ({
        packageId: entry.packageId,
        strength: roundNumber(entry.strength),
      }))
      .filter((entry) => entry.strength > 0);
    if (kept.length > 0) deckPackages[decks[deckIndex].id] = kept;
  }
  return deckPackages;
}

function buildPackageExamples(decks, deckWeights, deckPackageRows, packageIndex, options) {
  const entries = decks
    .map((deck, deckIndex) => ({
      deckId: deck.id,
      deckName: deck.name,
      membership: deckPackageRows[deckIndex]?.[packageIndex]?.strength ?? 0,
      weightedMembership:
        (deckPackageRows[deckIndex]?.[packageIndex]?.strength ?? 0) * (deckWeights[deckIndex] ?? 0),
    }))
    .filter((entry) => entry.membership > 0)
    .sort(
      (left, right) =>
        right.membership - left.membership ||
        right.weightedMembership - left.weightedMembership ||
        left.deckName.localeCompare(right.deckName) ||
        left.deckId.localeCompare(right.deckId),
    );

  return entries.slice(0, options.maxExampleDecksPerPackage).map((entry) => ({
    deckId: entry.deckId,
    deckName: entry.deckName,
    membership: roundNumber(entry.membership),
  }));
}

function serializeCardPackages(H, nodeIds, packages, options) {
  const cardPackages = {};
  for (let nodeIndex = 0; nodeIndex < nodeIds.length; nodeIndex += 1) {
    const column = packages.map((pkg, packageIndex) => ({
      packageId: pkg.id,
      packageLabel: pkg.label,
      raw: H[packageIndex]?.[nodeIndex] ?? 0,
    }));
    const max = Math.max(...column.map((entry) => entry.raw), 0);
    if (max <= 0) continue;
    const memberships = column
      .map((entry) => ({
        packageId: entry.packageId,
        strength: entry.raw / max,
        packageLabel: entry.packageLabel,
      }))
      .filter((entry) => entry.strength >= options.minCardPackageStrength)
      .sort(
        (left, right) =>
          right.strength - left.strength || left.packageId.localeCompare(right.packageId),
      )
      .slice(0, options.maxPackagesPerNode)
      .map((entry) => ({
        packageId: entry.packageId,
        strength: roundNumber(entry.strength),
        packageLabel: entry.packageLabel,
      }));
    if (memberships.length > 0) cardPackages[nodeIds[nodeIndex]] = memberships;
  }
  return cardPackages;
}

export function buildPackageModel({ decks, deckWeights, nodes, metadata, packageOptions = {} }) {
  const options = normalizePackageOptions(packageOptions);
  if (!options.enabled || decks.length === 0) {
    return {
      packages: [],
      cardPackages: {},
      deckPackages: {},
      meta: {
        ...serializePackageOptions(options),
        enabled: false,
        deckCount: decks.length,
        nodeCount: 0,
        generatedPackageCount: 0,
        reconstructionError: 0,
      },
    };
  }

  const packageMatrix = buildPackageMatrix(decks, deckWeights, metadata, options);
  const componentCount = Math.max(
    0,
    Math.min(
      Math.floor(options.components),
      packageMatrix.matrix.length,
      packageMatrix.nodeIds.length,
    ),
  );
  if (componentCount <= 0) {
    return {
      packages: [],
      cardPackages: {},
      deckPackages: {},
      meta: {
        ...serializePackageOptions(options),
        components: componentCount,
        deckCount: decks.length,
        nodeCount: packageMatrix.nodeIds.length,
        generatedPackageCount: 0,
        reconstructionError: 0,
      },
    };
  }

  const nmf = runDeterministicNmf(packageMatrix.matrix, {
    ...options,
    components: componentCount,
  });
  const packageIds = Array.from({ length: componentCount }, (_, index) =>
    `pkg-${String(index + 1).padStart(2, '0')}`,
  );
  const deckPackageRows = buildDeckPackageRows(nmf.W, packageIds);
  const packages = packageIds.map((packageId, packageIndex) => {
    const topNodes = buildPackageTopNodes(nmf.H, packageIndex, packageMatrix.nodeIds, nodes, options);
    const supportEntries = deckPackageRows
      .map((row, deckIndex) => ({
        membership: row[packageIndex]?.strength ?? 0,
        deckWeight: deckWeights[deckIndex] ?? 0,
      }))
      .filter((entry) => entry.membership >= options.minDeckMembership);
    const weightedSupport = supportEntries.reduce(
      (sum, entry) => sum + entry.membership * entry.deckWeight,
      0,
    );
    const maxMembership = Math.max(
      ...deckPackageRows.map((row) => row[packageIndex]?.strength ?? 0),
      0,
    );

    return {
      id: packageId,
      label: makePackageLabel(topNodes),
      topNodes,
      exampleDecks: buildPackageExamples(decks, deckWeights, deckPackageRows, packageIndex, options),
      supportDeckCount: supportEntries.length,
      weightedSupport: roundNumber(weightedSupport),
      maxMembership: roundNumber(maxMembership),
    };
  });

  return {
    packages,
    cardPackages: serializeCardPackages(nmf.H, packageMatrix.nodeIds, packages, options),
    deckPackages: serializeDeckPackages(decks, deckPackageRows, options),
    meta: {
      ...serializePackageOptions(options),
      components: componentCount,
      deckCount: decks.length,
      nodeCount: packageMatrix.nodeIds.length,
      generatedPackageCount: packages.length,
      reconstructionError: roundNumber(nmf.reconstructionError),
    },
  };
}

export function scoreSharedPackages(sourcePackages, targetPackages, packageById, options = {}) {
  const mergedOptions = normalizePackageOptions(options);
  const targetByPackage = new Map(
    (targetPackages ?? []).map((entry) => [entry.packageId, entry]),
  );
  const shared = [];
  let best = 0;

  for (const source of sourcePackages ?? []) {
    const target = targetByPackage.get(source.packageId);
    if (!target) continue;
    const pkg = packageById.get(source.packageId);
    if (!pkg) continue;
    const reliability = Math.min(
      1,
      (pkg.weightedSupport ?? 0) / mergedOptions.reliabilityWeightedSupport,
    );
    const strength = Math.sqrt(source.strength * target.strength) * reliability;
    if (strength > best) best = strength;
    shared.push({
      packageId: source.packageId,
      label: pkg.label,
      strength,
    });
  }

  return {
    score: Math.round(100 * best),
    shared: shared
      .sort((left, right) => right.strength - left.strength || left.packageId.localeCompare(right.packageId))
      .slice(0, 3)
      .map((entry) => ({
        packageId: entry.packageId,
        label: entry.label,
        strength: roundNumber(entry.strength),
      })),
  };
}

export function blendAssociationScore(pairwiseScore, packageScore, packageBoostWeight = 0.3) {
  const pairwise = Math.max(0, Number(pairwiseScore) || 0);
  const packageValue = Math.max(0, Number(packageScore) || 0);
  return Math.min(
    100,
    Math.round(Math.max(pairwise, pairwise * 0.85 + packageValue * packageBoostWeight)),
  );
}

export function getPackageCandidateNodes(sourceNodeId, cardPackages, packageById) {
  const sourcePackages = cardPackages[sourceNodeId] ?? [];
  const candidates = new Map();

  for (const packageRef of sourcePackages) {
    const pkg = packageById.get(packageRef.packageId);
    if (!pkg) continue;
    for (const node of pkg.topNodes ?? []) {
      if (node.nodeId === sourceNodeId) continue;
      const score = Math.sqrt(packageRef.strength * node.weight);
      candidates.set(node.nodeId, Math.max(candidates.get(node.nodeId) ?? 0, score));
    }
  }

  return candidates;
}

export function getVisibleAssociationScore(link) {
  const pairwiseScore = visibleStats(link)?.score ?? 0;
  return Math.max(pairwiseScore, link.packages?.blendedMainScore ?? 0);
}

export function mergePackageEvidenceIntoIndex(index, packageModel, options = {}) {
  const packageOptions = normalizePackageOptions(options.packageOptions ?? options);
  const packageById = new Map((packageModel.packages ?? []).map((pkg) => [pkg.id, pkg]));
  const sourceNodeIds = Object.keys(packageModel.cardPackages ?? {}).sort((left, right) =>
    left.localeCompare(right),
  );

  for (const sourceNodeId of sourceNodeIds) {
    let fromLinks = index.get(sourceNodeId);
    if (!fromLinks) {
      fromLinks = new Map();
      index.set(sourceNodeId, fromLinks);
    }
    const targets = new Set(fromLinks.keys());
    for (const targetNodeId of getPackageCandidateNodes(
      sourceNodeId,
      packageModel.cardPackages,
      packageById,
    ).keys()) {
      targets.add(targetNodeId);
    }

    for (const targetNodeId of [...targets].sort((left, right) => left.localeCompare(right))) {
      if (targetNodeId === sourceNodeId) continue;
      const packageScore = scoreSharedPackages(
        packageModel.cardPackages[sourceNodeId] ?? [],
        packageModel.cardPackages[targetNodeId] ?? [],
        packageById,
        packageOptions,
      );
      if (packageScore.score <= 0 || packageScore.shared.length === 0) continue;
      const link = fromLinks.get(targetNodeId) ?? { to: targetNodeId };
      const pairwiseScore = link.mainMain?.score ?? 0;
      link.packages = {
        score: packageScore.score,
        blendedMainScore: blendAssociationScore(
          pairwiseScore,
          packageScore.score,
          packageOptions.packageBoostWeight,
        ),
        shared: packageScore.shared,
      };
      fromLinks.set(targetNodeId, link);
    }
  }
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
      const serializedStats = serializeStats(stats);
      if (stats.channel === 'mainToCollection' || stats.channel === 'collectionToMain') {
        existing.mainCollection = {
          ...(existing.mainCollection ?? {}),
          [stats.channel]: serializedStats,
        };
      } else {
        existing[stats.channel] = serializedStats;
      }
      fromLinks.set(to, existing);
    }
  }
}

function linkStats(link) {
  return [
    link.mainMain,
    link.mainCollection?.mainToCollection,
    link.mainCollection?.collectionToMain,
    link.collectionCollection,
  ].filter(Boolean);
}

function visibleStats(link) {
  return linkStats(link).sort(
    (left, right) =>
      right.score - left.score ||
      right.coCount - left.coCount ||
      right.confidence - left.confidence ||
      right.lift - left.lift,
  )[0] ?? null;
}

function serializeNodes(nodes) {
  const serialized = {};
  for (const [id, node] of [...nodes].sort(([left], [right]) => left.localeCompare(right))) {
    serialized[id] = node;
  }
  return serialized;
}

export function compareAssociationLinks(left, right, nodes) {
  const leftStats = visibleStats(left);
  const rightStats = visibleStats(right);
  const scoreDelta = getVisibleAssociationScore(right) - getVisibleAssociationScore(left);
  if (scoreDelta !== 0) return scoreDelta;
  const coCountDelta = (rightStats?.coCount ?? 0) - (leftStats?.coCount ?? 0);
  if (coCountDelta !== 0) return coCountDelta;
  const confidenceDelta = (rightStats?.confidence ?? 0) - (leftStats?.confidence ?? 0);
  if (confidenceDelta !== 0) return confidenceDelta;
  const liftDelta = (rightStats?.lift ?? 0) - (leftStats?.lift ?? 0);
  if (liftDelta !== 0) return liftDelta;
  const nameDelta = (nodes.get(left.to)?.displayName ?? left.to).localeCompare(
    nodes.get(right.to)?.displayName ?? right.to,
  );
  if (nameDelta !== 0) return nameDelta;
  return left.to.localeCompare(right.to);
}

function serializeIndex(index, topLinks, nodes) {
  const serialized = {};
  for (const [from, links] of [...index].sort(([left], [right]) => left.localeCompare(right))) {
    const top = [...links.values()]
      .sort((left, right) => compareAssociationLinks(left, right, nodes))
      .slice(0, topLinks);
    if (top.length > 0) serialized[from] = top;
  }
  return serialized;
}

function clusterSizesFromIds(clusterIds) {
  const clusterSizes = {};
  for (const clusterId of clusterIds) {
    clusterSizes[clusterId] = (clusterSizes[clusterId] ?? 0) + 1;
  }
  return clusterSizes;
}

function clusterSort(left, right) {
  const leftNumber = Number(left.replace(/^cluster-/u, ''));
  const rightNumber = Number(right.replace(/^cluster-/u, ''));
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function defaultClusterLabel(clusterId) {
  return clusterId.replace(/^cluster-/u, 'Cluster ');
}

function getElementalAvatarElement(displayName) {
  const match = displayName.match(/^Avatar\s+of\s+(.+)$/iu);
  return match ? normalizeElementName(match[1]) : null;
}

function shortenAvatarName(displayName) {
  const elementalAvatarElement = getElementalAvatarElement(displayName);
  if (elementalAvatarElement) return ELEMENT_SYMBOLS[elementalAvatarElement];
  return displayName.trim();
}

function buildClusterLabel(clusterId, cluster, nodes) {
  const avatarIds = [...cluster.avatarIds].filter(Boolean);
  if (avatarIds.length !== 1) return defaultClusterLabel(clusterId);

  const avatarDisplayName = nodes.get(avatarIds[0])?.displayName ?? avatarIds[0];
  const avatarName = shortenAvatarName(avatarDisplayName);
  if (!avatarName) return defaultClusterLabel(clusterId);

  const elementalAvatarElement = getElementalAvatarElement(avatarDisplayName);
  const elements = [...cluster.elementCounts]
    .filter(([element]) => ELEMENT_ORDER.includes(element))
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return ELEMENT_ORDER.indexOf(left[0]) - ELEMENT_ORDER.indexOf(right[0]);
    })
    .slice(0, 2)
    .map(([element]) => element)
    .filter((element) => element !== elementalAvatarElement);
  const elementLabel = elements.map((element) => ELEMENT_SYMBOLS[element]).join('/');

  return elementLabel ? `${avatarName} - ${elementLabel}` : avatarName;
}

function buildClusterProfiles(decks, deckWeights, clusterIds, nodes) {
  const clusters = new Map();

  for (let deckIndex = 0; deckIndex < decks.length; deckIndex += 1) {
    const deck = decks[deckIndex];
    const clusterId = clusterIds[deckIndex] ?? `cluster-${deckIndex + 1}`;
    const weight = deckWeights[deckIndex] ?? 0;
    let cluster = clusters.get(clusterId);
    if (!cluster) {
      cluster = {
        id: clusterId,
        size: 0,
        totalWeight: 0,
        deckIds: [],
        cardCounts: new Map(),
        avatarIds: new Set(),
        elementCounts: new Map(),
      };
      clusters.set(clusterId, cluster);
    }

    cluster.size += 1;
    cluster.totalWeight += weight;
    cluster.deckIds.push(deck.id);
    if (deck.avatar) cluster.avatarIds.add(deck.avatar);
    for (const element of deck.elements) incrementMap(cluster.elementCounts, element, weight);
    for (const nodeId of deck.main.keys()) {
      incrementMap(cluster.cardCounts, nodeId, weight);
    }
  }

  const serialized = {};
  for (const [clusterId, cluster] of [...clusters].sort(([left], [right]) => clusterSort(left, right))) {
    const cards = {};
    const cardEntries = [...cluster.cardCounts]
      .map(([nodeId, count]) => {
        const confidence = cluster.totalWeight > 0 ? count / cluster.totalWeight : 0;
        return {
          nodeId,
          score: Math.round(confidence * 100),
          confidence,
          count,
          totalWeight: cluster.totalWeight,
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (right.count !== left.count) return right.count - left.count;
        const nameDelta = (nodes.get(left.nodeId)?.displayName ?? left.nodeId).localeCompare(
          nodes.get(right.nodeId)?.displayName ?? right.nodeId,
        );
        if (nameDelta !== 0) return nameDelta;
        return left.nodeId.localeCompare(right.nodeId);
      });

    for (const entry of cardEntries) {
      cards[entry.nodeId] = {
        score: entry.score,
        confidence: roundNumber(entry.confidence),
        count: roundNumber(entry.count),
        totalWeight: roundNumber(entry.totalWeight),
      };
    }

    serialized[clusterId] = {
      id: cluster.id,
      label: buildClusterLabel(clusterId, cluster, nodes),
      avatarIds: [...cluster.avatarIds].sort((left, right) => {
        const leftName = nodes.get(left)?.displayName ?? left;
        const rightName = nodes.get(right)?.displayName ?? right;
        const nameDelta = leftName.localeCompare(rightName);
        if (nameDelta !== 0) return nameDelta;
        return left.localeCompare(right);
      }),
      size: cluster.size,
      totalWeight: roundNumber(cluster.totalWeight),
      deckIds: cluster.deckIds.sort((left, right) => left.localeCompare(right)),
      cards,
    };
  }

  return serialized;
}

function buildFilterOptions(userOptions) {
  return {
    ...DEFAULT_ASSOCIATION_OPTIONS.filters,
    ...(userOptions.filters ?? {}),
  };
}

function buildOptions(userOptions) {
  return {
    ...DEFAULT_ASSOCIATION_OPTIONS,
    ...userOptions,
    weights: {
      ...DEFAULT_ASSOCIATION_OPTIONS.weights,
      ...(userOptions.weights ?? {}),
    },
    filters: buildFilterOptions(userOptions),
    packageOptions: normalizePackageOptions(userOptions.packageOptions ?? {}),
  };
}

export function buildCardAssociations(archive, cards, userOptions = {}) {
  const mode = userOptions.mode === 'meta' ? 'meta' : 'balanced';
  const options = buildOptions(userOptions);
  const nodes = new Map();
  const metadata = buildCardMetadata(cards);
  const { decks, summary } = normalizeDeckArchiveInternal(archive, nodes, options.filters, metadata);
  const vectors = buildDeckIdentityVectors(decks, metadata);
  const graph = buildDeckGraph(vectors, options);
  const clustering = runDeckClustering(graph);
  const clusterIds = clustering.clusterIds;
  const deckWeights = calculateDeckWeights(clusterIds, mode);
  const index = new Map();

  mergeChannel(index, calculateChannelStats(decks, deckWeights, clusterIds, 'main', 'main', options));
  mergeChannel(
    index,
    calculateChannelStats(decks, deckWeights, clusterIds, 'main', 'collection', options),
  );
  mergeChannel(
    index,
    calculateChannelStats(decks, deckWeights, clusterIds, 'collection', 'main', options),
  );
  mergeChannel(
    index,
    calculateChannelStats(decks, deckWeights, clusterIds, 'collection', 'collection', options),
  );

  const packageModel = buildPackageModel({
    decks,
    deckWeights,
    nodes,
    metadata,
    packageOptions: options.packageOptions,
  });
  mergePackageEvidenceIntoIndex(index, packageModel, options);

  const clusterSizes = clusterSizesFromIds(clusterIds);
  const clusters = buildClusterProfiles(decks, deckWeights, clusterIds, nodes);
  const deckNames = {};
  const collectionNodeIds = new Set();
  for (const deck of decks) {
    deckNames[deck.id] = deck.name;
    for (const nodeId of deck.collection.keys()) collectionNodeIds.add(nodeId);
  }

  return {
    __meta: {
      version: 4,
      generatedAt: new Date().toISOString(),
      mode,
      sourceDeckCount: summary.sourceDeckCount,
      acceptedDeckCount: summary.acceptedDeckCount,
      skippedDeckCount: summary.skippedDeckCount,
      deckCount: summary.acceptedDeckCount,
      clusterCount: Object.keys(clusterSizes).length,
      clusterSizes,
      filters: {
        constructedOnly: options.filters.constructedOnly,
        fullDecksOnly: options.filters.fullDecksOnly,
        includeSkipped: options.filters.includeSkipped,
      },
      options: {
        topLinks: options.topLinks,
        minEvidence: options.minEvidence,
        similarityThreshold: options.similarityThreshold,
        weights: options.weights,
        fullSpellbookMin: options.filters.fullSpellbookMin,
        fullAtlasMin: options.filters.fullAtlasMin,
        packageOptions: serializePackageOptions(options.packageOptions),
      },
      packageModel: packageModel.meta,
      deckNames,
      clustering: {
        algorithm: clustering.algorithm,
        clusterCount: clustering.clusterCount,
        modularity:
          clustering.modularity === null || clustering.modularity === undefined
            ? null
            : roundNumber(clustering.modularity),
        dendrogram: clustering.dendrogram,
        level: clustering.level,
        fallbackReason: clustering.fallbackReason,
      },
      collectionNodeIds: [...collectionNodeIds].sort((left, right) => left.localeCompare(right)),
      filterSummary: summary,
    },
    nodes: serializeNodes(nodes),
    clusters,
    packages: packageModel.packages,
    cardPackages: packageModel.cardPackages,
    deckPackages: packageModel.deckPackages,
    index: serializeIndex(index, options.topLinks, nodes),
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
  node scripts/build-card-associations.mjs
  node scripts/build-card-associations.mjs --include-skipped --min-spells 50 --min-atlas 20

Options:
      --archive <file>       Deck archive JSON. Defaults to ${DEFAULT_ARCHIVE_PATH}
      --include-skipped      Include filtered decks from the skipped archive.
      --skipped-archive <file> Skipped JSON. Defaults to <archive>.skipped.json.
      --min-spells <n>       Minimum skipped spellbook cards. Defaults to ${DEFAULT_SKIPPED_SPELLBOOK_MIN}
      --min-atlas <n>        Minimum skipped atlas cards. Defaults to ${DEFAULT_SKIPPED_ATLAS_MIN}
      --card-data <file>     Card catalog JSON. Defaults to ${DEFAULT_CARD_DATA_PATH}
      --output-base <path>   Output path without _balanced/_meta suffix. Defaults to ${DEFAULT_OUTPUT_BASE_PATH}
      --output <file>        Compatibility alias. The suffix and .json are removed before writing both modes.
      --top-links <n>        Links per source node. Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.topLinks}
      --threshold <n>        Deck graph threshold. Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.similarityThreshold}
      --min-evidence <n>     Reliability midpoint. Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.minEvidence}
      --spellbook-weight <n> Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.weights.spellbook}
      --atlas-weight <n>     Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.weights.atlas}
      --collection-weight <n> Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.weights.collection}
      --avatar-weight <n>    Defaults to ${DEFAULT_ASSOCIATION_OPTIONS.weights.avatar}
      --packages <n>         NMF package count. Defaults to ${DEFAULT_PACKAGE_OPTIONS.components}
      --no-packages          Disable package model generation.
      --package-iterations <n> Defaults to ${DEFAULT_PACKAGE_OPTIONS.iterations}
      --package-seed <n>     Deterministic NMF seed. Defaults to ${DEFAULT_PACKAGE_OPTIONS.seed}
      --package-min-card-strength <n> Minimum normalized card weight in package top nodes.
      --package-min-membership <n> Minimum deck package membership to count as support.
      --package-max-nodes <n> Maximum top nodes per package.
      --package-max-packages-per-node <n> Maximum package memberships per card/avatar node.
      --package-boost-weight <n> Package contribution in blended score.
      --allow-non-constructed Include non-Constructed source decks.
      --allow-incomplete    Include source decks below full-deck size.
  -h, --help                 Show this help.
`);
}

function outputBaseFromFile(filePath) {
  return filePath
    .replace(/_(balanced|meta)\.json$/u, '')
    .replace(/\.json$/u, '');
}

export function parseArgs(argv) {
  const options = {
    archive: DEFAULT_ARCHIVE_PATH,
    skippedArchive: '',
    includeSkipped: false,
    minSkippedSpellbook: DEFAULT_SKIPPED_SPELLBOOK_MIN,
    minSkippedAtlas: DEFAULT_SKIPPED_ATLAS_MIN,
    cardData: DEFAULT_CARD_DATA_PATH,
    outputBase: DEFAULT_OUTPUT_BASE_PATH,
    help: false,
    associationOptions: {
      ...DEFAULT_ASSOCIATION_OPTIONS,
      weights: { ...DEFAULT_ASSOCIATION_OPTIONS.weights },
      filters: { ...DEFAULT_ASSOCIATION_OPTIONS.filters },
      packageOptions: normalizePackageOptions(DEFAULT_ASSOCIATION_OPTIONS.packageOptions),
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
    } else if (arg === '--include-skipped') {
      options.includeSkipped = true;
      options.associationOptions.filters.includeSkipped = true;
    } else if (arg === '--skipped-archive') {
      options.skippedArchive = next();
      options.includeSkipped = true;
      options.associationOptions.filters.includeSkipped = true;
    } else if (arg === '--min-spells' || arg === '--min-skipped-spellbook') {
      options.minSkippedSpellbook = Math.max(0, Math.floor(parseNumber(next(), arg)));
      options.includeSkipped = true;
      options.associationOptions.filters.includeSkipped = true;
    } else if (arg === '--min-atlas' || arg === '--min-skipped-atlas') {
      options.minSkippedAtlas = Math.max(0, Math.floor(parseNumber(next(), arg)));
      options.includeSkipped = true;
      options.associationOptions.filters.includeSkipped = true;
    } else if (arg === '--card-data') {
      options.cardData = next();
    } else if (arg === '--output-base') {
      options.outputBase = outputBaseFromFile(next());
    } else if (arg === '--output') {
      options.outputBase = outputBaseFromFile(next());
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
    } else if (arg === '--packages') {
      options.associationOptions.packageOptions.components = Math.max(1, Math.floor(parseNumber(next(), arg)));
      options.associationOptions.packageOptions.enabled = true;
    } else if (arg === '--no-packages') {
      options.associationOptions.packageOptions.enabled = false;
    } else if (arg === '--package-iterations') {
      options.associationOptions.packageOptions.iterations = Math.max(0, Math.floor(parseNumber(next(), arg)));
    } else if (arg === '--package-seed') {
      options.associationOptions.packageOptions.seed = Math.floor(parseNumber(next(), arg));
    } else if (arg === '--package-min-card-strength') {
      options.associationOptions.packageOptions.minNodeStrength = Math.max(0, parseNumber(next(), arg));
    } else if (arg === '--package-min-membership') {
      options.associationOptions.packageOptions.minDeckMembership = Math.max(0, parseNumber(next(), arg));
    } else if (arg === '--package-max-nodes') {
      options.associationOptions.packageOptions.maxNodesPerPackage = Math.max(1, Math.floor(parseNumber(next(), arg)));
    } else if (arg === '--package-max-packages-per-node') {
      options.associationOptions.packageOptions.maxPackagesPerNode = Math.max(1, Math.floor(parseNumber(next(), arg)));
    } else if (arg === '--package-boost-weight') {
      options.associationOptions.packageOptions.packageBoostWeight = Math.max(0, parseNumber(next(), arg));
    } else if (arg === '--allow-non-constructed') {
      options.associationOptions.filters.constructedOnly = false;
    } else if (arg === '--allow-incomplete') {
      options.associationOptions.filters.fullDecksOnly = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function outputPathForMode(outputBase, mode) {
  return `${outputBase}_${mode}.json`;
}

export async function runBuild(options) {
  let archive = await readJson(options.archive);
  let skippedSummary = null;
  if (options.includeSkipped) {
    const skippedArchivePath = options.skippedArchive || `${options.archive}.skipped.json`;
    const skippedArchive = await readJson(skippedArchivePath);
    const filteredSkipped = filterSkippedArchiveDecks(skippedArchive, {
      minSpellbook: options.minSkippedSpellbook,
      minAtlas: options.minSkippedAtlas,
    });
    archive = mergeArchives(archive, filteredSkipped.archive);
    skippedSummary = {
      path: skippedArchivePath,
      minSpellbook: options.minSkippedSpellbook,
      minAtlas: options.minSkippedAtlas,
      ...filteredSkipped.summary,
    };
  }

  const cards = await readJson(options.cardData);
  const written = {};
  for (const mode of ASSOCIATION_MODES) {
    const associations = buildCardAssociations(archive, cards, {
      ...options.associationOptions,
      mode,
    });
    associations.__meta.archiveSource = {
      path: options.archive,
      skipped: skippedSummary,
    };
    const outputPath = outputPathForMode(options.outputBase, mode);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(associations, null, 2)}\n`);
    written[mode] = { outputPath, associations };
  }
  return written;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const written = await runBuild(options);
  for (const mode of ASSOCIATION_MODES) {
    const entry = written[mode];
    console.log(
      `Wrote ${entry.outputPath}: ${Object.keys(entry.associations.index).length} source nodes, ` +
        `${entry.associations.__meta.acceptedDeckCount} accepted decks, ` +
        `${entry.associations.__meta.clusterCount} clusters`,
    );
  }
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
