/**
 * Read-only card/avatar association data generated from downloaded decks.
 *
 * The generated JSON is static app data. It is intentionally kept out of
 * guest/account user data so users cannot mutate it through the UI.
 */

export type AssociationSourceZone = "main" | "collection";
export type AssociationMode = "balanced" | "meta";
export type NodeKind = "card" | "avatar";
export type NodeId = string;

export interface AssociationNode {
  id: NodeId;
  kind: NodeKind;
  displayName: string;
  canonicalName: string;
}

export interface LinkStats {
  score: number;
  confidence: number;
  lift: number;
  coCount: number;
  countA: number;
  countB: number;
  totalWeight: number;
  exampleDeckIds: string[];
  clusterIds: string[];
}

export interface AssociationPackageTopNode {
  nodeId: NodeId;
  weight: number;
  displayName: string;
}

export interface AssociationPackageExampleDeck {
  deckId: string;
  deckName: string;
  membership: number;
}

export interface AssociationPackage {
  id: string;
  label: string;
  topNodes: AssociationPackageTopNode[];
  exampleDecks: AssociationPackageExampleDeck[];
  supportDeckCount: number;
  weightedSupport: number;
  maxMembership: number;
}

export interface NodePackageMembership {
  packageId: string;
  strength: number;
  packageLabel: string;
}

export interface DeckPackageMembership {
  packageId: string;
  strength: number;
}

export interface AssociationSharedPackage {
  packageId: string;
  label: string;
  strength: number;
}

export interface AssociationPackageLink {
  score: number;
  blendedMainScore: number;
  shared: AssociationSharedPackage[];
}

export interface AssociationLink {
  to: NodeId;
  mainMain?: LinkStats;
  mainCollection?: {
    mainToCollection?: LinkStats;
    collectionToMain?: LinkStats;
  };
  collectionCollection?: LinkStats;
  packages?: AssociationPackageLink;
}

export type CardAssociationLink = AssociationLink;
export type CardAssociationIndex = Record<NodeId, AssociationLink[]>;

export interface AssociationClusterCardScore {
  score: number;
  confidence: number;
  count: number;
  totalWeight: number;
}

export interface AssociationClusterProfile {
  id: string;
  label: string;
  avatarIds: NodeId[];
  size: number;
  totalWeight: number;
  deckIds: string[];
  cards: Record<NodeId, AssociationClusterCardScore>;
}

export const MULTI_AVATAR_CLUSTER_GROUP_ID = "multi-avatar";

export interface AssociationClusterGroup {
  id: NodeId | typeof MULTI_AVATAR_CLUSTER_GROUP_ID;
  label: string;
  avatarIds: NodeId[];
  clusters: AssociationClusterProfile[];
}

export interface CardAssociationMeta {
  version: number;
  generatedAt: string;
  mode: AssociationMode;
  sourceDeckCount: number;
  acceptedDeckCount: number;
  skippedDeckCount: number;
  deckCount: number;
  clusterCount: number;
  clusterSizes: Record<string, number>;
  filters: {
    constructedOnly: boolean;
    fullDecksOnly: boolean;
    includeSkipped: boolean;
  };
  options: {
    topLinks: number;
    minEvidence: number;
    similarityThreshold: number;
    weights: {
      spellbook: number;
      atlas: number;
      collection: number;
      avatar: number;
    };
    fullSpellbookMin?: number;
    fullAtlasMin?: number;
    packageOptions?: Record<string, unknown>;
  };
  deckNames: Record<string, string>;
  clustering?: {
    algorithm: "graphology-louvain" | "greedy-modularity";
    clusterCount: number;
    modularity: number | null;
    dendrogram: Array<Record<string, number>> | null;
    level: number;
    fallbackReason?: string;
  };
  collectionNodeIds: NodeId[];
  packageModel?: {
    enabled: boolean;
    components: number;
    iterations: number;
    seed: number;
    deckCount: number;
    nodeCount: number;
    generatedPackageCount: number;
    reconstructionError: number;
  };
}

export interface CardAssociationData {
  __meta: CardAssociationMeta;
  nodes: Record<NodeId, AssociationNode>;
  clusters: Record<string, AssociationClusterProfile>;
  packages?: AssociationPackage[];
  cardPackages?: Record<NodeId, NodePackageMembership[]>;
  deckPackages?: Record<string, DeckPackageMembership[]>;
  index: CardAssociationIndex;
}

export interface AssociationScores {
  main: LinkStats | null;
  collection: LinkStats | null;
}

export interface AssociationPackageCardScore {
  score: number;
  strength: number;
  packageId: string;
  packageLabel: string;
}

export interface AssociationDisplayScores extends AssociationScores {
  mainScore: number | null;
  collectionScore: number | null;
  packages: AssociationPackageLink | null;
}

const ASSOCIATION_ASSET_PATHS: Record<AssociationMode, string> = {
  balanced: "/assets/sorcery_card_associations_balanced.json",
  meta: "/assets/sorcery_card_associations_meta.json",
};

const cachedAssociations: Partial<Record<AssociationMode, CardAssociationData>> = {};
const loadPromises: Partial<Record<AssociationMode, Promise<CardAssociationData>>> = {};

export function canonicalizeAssociationName(name: string): string {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getAssociationNodeId(
  name: string,
  kind: NodeKind = "card",
): NodeId {
  const canonicalName = canonicalizeAssociationName(name);
  return `${kind}:${canonicalName || "unknown"}`;
}

export function getAssociationNodeKindFromCardType(
  cardType: string | null | undefined,
): NodeKind {
  return cardType === "Avatar" ? "avatar" : "card";
}

export function resolveAssociationNodeId(
  associations: CardAssociationData | null,
  name: string | null,
  cardType?: string | null,
): NodeId | null {
  if (!associations || !name) return null;
  const preferredKind = getAssociationNodeKindFromCardType(cardType);
  const preferredId = getAssociationNodeId(name, preferredKind);
  if (associations.nodes[preferredId]) return preferredId;

  const fallbackKind: NodeKind = preferredKind === "card" ? "avatar" : "card";
  const fallbackId = getAssociationNodeId(name, fallbackKind);
  if (associations.nodes[fallbackId]) return fallbackId;

  return preferredId;
}

export async function loadCardAssociations(
  mode: AssociationMode = "balanced",
): Promise<CardAssociationData> {
  if (cachedAssociations[mode]) return cachedAssociations[mode];
  if (loadPromises[mode]) return loadPromises[mode];

  loadPromises[mode] = fetch(ASSOCIATION_ASSET_PATHS[mode], {
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to load card associations: ${response.status}`);
    }
    cachedAssociations[mode] = (await response.json()) as CardAssociationData;
    return cachedAssociations[mode];
  });

  return loadPromises[mode];
}

export function getAssociationLink(
  associations: CardAssociationData | null,
  fromNodeId: NodeId | null,
  toNodeId: NodeId | null,
): AssociationLink | null {
  if (!associations || !fromNodeId || !toNodeId || fromNodeId === toNodeId) {
    return null;
  }
  return associations.index[fromNodeId]?.find((link) => link.to === toNodeId) ?? null;
}

export function getAssociationScores(
  associations: CardAssociationData | null,
  fromNodeId: NodeId | null,
  toNodeId: NodeId | null,
  sourceZone: AssociationSourceZone,
): AssociationScores {
  const link = getAssociationLink(associations, fromNodeId, toNodeId);
  if (!link) return { main: null, collection: null };

  if (sourceZone === "collection") {
    return {
      main: link.mainCollection?.collectionToMain ?? null,
      collection: link.collectionCollection ?? null,
    };
  }

  return {
    main: link.mainMain ?? null,
    collection: link.mainCollection?.mainToCollection ?? null,
  };
}

export function getAssociationDisplayScores(
  associations: CardAssociationData | null,
  fromNodeId: NodeId | null,
  toNodeId: NodeId | null,
  sourceZone: AssociationSourceZone,
  targetZone: AssociationSourceZone = "main",
): AssociationDisplayScores {
  const link = getAssociationLink(associations, fromNodeId, toNodeId);
  const scores = getAssociationScores(associations, fromNodeId, toNodeId, sourceZone);
  const targetScores =
    targetZone === "collection"
      ? { main: null, collection: scores.collection }
      : { main: scores.main, collection: null };
  const packageScore = targetZone === "main" ? link?.packages ?? null : null;
  const baseMainScore = targetScores.main?.score ?? null;
  const boostedMainScore =
    packageScore && packageScore.blendedMainScore > (baseMainScore ?? 0)
      ? packageScore.blendedMainScore
      : baseMainScore;

  return {
    main: targetScores.main,
    collection: targetScores.collection,
    mainScore: boostedMainScore,
    collectionScore: targetScores.collection?.score ?? null,
    packages: packageScore,
  };
}

export function hasCollectionAssociationSource(
  associations: CardAssociationData | null,
  cardName: string | null,
  cardType?: string | null,
): boolean {
  const nodeId = resolveAssociationNodeId(associations, cardName, cardType);
  if (!associations || !nodeId) return false;
  return associations.__meta.collectionNodeIds.includes(nodeId);
}

function clusterSort(left: AssociationClusterProfile, right: AssociationClusterProfile): number {
  const leftNumber = Number(left.id.replace(/^cluster-/u, ""));
  const rightNumber = Number(right.id.replace(/^cluster-/u, ""));
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.id.localeCompare(right.id);
}

export function getAssociationClusters(
  associations: CardAssociationData | null,
): AssociationClusterProfile[] {
  if (!associations) return [];
  return Object.values(associations.clusters ?? {}).sort(clusterSort);
}

export function getAssociationClusterGroups(
  associations: CardAssociationData | null,
): AssociationClusterGroup[] {
  if (!associations) return [];

  const groups = new Map<string, AssociationClusterGroup>();
  for (const cluster of getAssociationClusters(associations)) {
    const avatarIds = [...(cluster.avatarIds ?? [])].sort((left, right) => {
      const leftName = associations.nodes[left]?.displayName ?? left;
      const rightName = associations.nodes[right]?.displayName ?? right;
      const nameDelta = leftName.localeCompare(rightName);
      if (nameDelta !== 0) return nameDelta;
      return left.localeCompare(right);
    });
    const singleAvatarId = avatarIds.length === 1 ? avatarIds[0] ?? null : null;
    const groupId = singleAvatarId ?? MULTI_AVATAR_CLUSTER_GROUP_ID;
    const existing = groups.get(groupId);
    if (existing) {
      existing.clusters.push(cluster);
      continue;
    }

    groups.set(groupId, {
      id: groupId,
      label:
        groupId === MULTI_AVATAR_CLUSTER_GROUP_ID
          ? "Multi-avatar"
          : associations.nodes[groupId]?.displayName ?? groupId,
      avatarIds: singleAvatarId ? avatarIds : [],
      clusters: [cluster],
    });
  }

  return [...groups.values()].sort((left, right) => {
    if (left.id === MULTI_AVATAR_CLUSTER_GROUP_ID) return 1;
    if (right.id === MULTI_AVATAR_CLUSTER_GROUP_ID) return -1;
    const nameDelta = left.label.localeCompare(right.label);
    if (nameDelta !== 0) return nameDelta;
    return left.id.localeCompare(right.id);
  });
}

export function getAssociationClusterCardScore(
  associations: CardAssociationData | null,
  clusterId: string | null,
  nodeId: NodeId | null,
): AssociationClusterCardScore | null {
  if (!associations || !clusterId || !nodeId) return null;
  return associations.clusters[clusterId]?.cards[nodeId] ?? null;
}

export function getAssociationClusterGroupCardScore(
  associations: CardAssociationData | null,
  groupId: string | null,
  nodeId: NodeId | null,
): AssociationClusterCardScore | null {
  if (!associations || !groupId || !nodeId) return null;
  const group = getAssociationClusterGroups(associations).find(
    (entry) => entry.id === groupId,
  );
  if (!group) return null;

  let bestScore: AssociationClusterCardScore | null = null;
  for (const cluster of group.clusters) {
    const score = cluster.cards[nodeId];
    if (!score) continue;
    if (!bestScore || score.score > bestScore.score) {
      bestScore = score;
    }
  }

  return bestScore;
}

function packageSort(left: AssociationPackage, right: AssociationPackage): number {
  const leftNumber = Number(left.id.replace(/^pkg-/u, ""));
  const rightNumber = Number(right.id.replace(/^pkg-/u, ""));
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.id.localeCompare(right.id);
}

export function getAssociationPackages(
  associations: CardAssociationData | null,
): AssociationPackage[] {
  if (!associations?.packages) return [];
  return [...associations.packages].sort(packageSort);
}

export function getAssociationPackageCardScore(
  associations: CardAssociationData | null,
  packageId: string | null,
  nodeId: NodeId | null,
): AssociationPackageCardScore | null {
  if (!associations || !packageId || !nodeId) return null;
  const pkg = associations.packages?.find((entry) => entry.id === packageId);
  const topNode = pkg?.topNodes.find((entry) => entry.nodeId === nodeId);
  if (!pkg || !topNode) return null;

  return {
    score: Math.round(topNode.weight * 100),
    strength: topNode.weight,
    packageId: pkg.id,
    packageLabel: pkg.label,
  };
}

export function formatAssociationEvidence(
  associations: CardAssociationData,
  stats: LinkStats,
  packageLink?: AssociationPackageLink | null,
): string {
  const evidence = stats.coCount.toFixed(stats.coCount % 1 === 0 ? 0 : 1);
  const examples = stats.exampleDeckIds
    .map((deckId) => associations.__meta.deckNames[deckId] ?? deckId)
    .slice(0, 3);
  const exampleText = examples.length > 0 ? `\n${examples.join("\n")}` : "";
  const clusterCount = new Set(stats.clusterIds).size;

  const lines = [
    `Score: ${stats.score}`,
    `Confidence: ${Math.round(stats.confidence * 100)}%`,
    `Lift: ${stats.lift.toFixed(1)}x`,
    `Evidence: ${evidence} weighted decks`,
    `Seen across ${clusterCount} archetype cluster${clusterCount === 1 ? "" : "s"}`,
  ];

  if (packageLink && packageLink.blendedMainScore > stats.score) {
    lines.push(`Displayed score: ${packageLink.blendedMainScore}`);
  }

  return lines.join("\n") + exampleText + formatAssociationPackageSuffix(associations, packageLink);
}

export function formatAssociationPackageEvidence(
  packageLink: AssociationPackageLink | null | undefined,
  associations?: CardAssociationData | null,
): string {
  if (!packageLink || packageLink.score <= 0 || packageLink.shared.length === 0) {
    return "";
  }
  const labels = packageLink.shared
    .slice(0, 3)
    .map((entry) => `${entry.label} (${Math.round(entry.strength * 100)}%)`);
  const lines = [
    `Score: ${packageLink.score}`,
    `Displayed score: ${packageLink.blendedMainScore}`,
    labels.length === 1 ? `Shared package: ${labels[0]}` : `Shared packages: ${labels.join(", ")}`,
  ];
  const examples = formatPackageExampleDecks(packageLink, associations);
  if (examples) lines.push(examples);
  return lines.join("\n");
}

function formatAssociationPackageSuffix(
  associations: CardAssociationData,
  packageLink: AssociationPackageLink | null | undefined,
): string {
  const evidence = formatAssociationPackageEvidence(packageLink, associations);
  return evidence ? `\n\nPackage relation\n${evidence}` : "";
}

function formatPackageExampleDecks(
  packageLink: AssociationPackageLink,
  associations: CardAssociationData | null | undefined,
): string {
  if (!associations?.packages) return "";
  const packageById = new Map(associations.packages.map((pkg) => [pkg.id, pkg]));
  const deckNames: string[] = [];
  for (const shared of packageLink.shared) {
    const pkg = packageById.get(shared.packageId);
    if (!pkg) continue;
    for (const example of pkg.exampleDecks) {
      if (deckNames.includes(example.deckName)) continue;
      deckNames.push(example.deckName);
      if (deckNames.length >= 3) break;
    }
    if (deckNames.length >= 3) break;
  }
  return deckNames.length > 0 ? `Also appears in: ${deckNames.join(", ")}` : "";
}
