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

export interface AssociationLink {
  to: NodeId;
  mainMain?: LinkStats;
  mainCollection?: {
    mainToCollection?: LinkStats;
    collectionToMain?: LinkStats;
  };
  collectionCollection?: LinkStats;
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
  };
  deckNames: Record<string, string>;
  collectionNodeIds: NodeId[];
}

export interface CardAssociationData {
  __meta: CardAssociationMeta;
  nodes: Record<NodeId, AssociationNode>;
  clusters: Record<string, AssociationClusterProfile>;
  index: CardAssociationIndex;
}

export interface AssociationScores {
  main: LinkStats | null;
  collection: LinkStats | null;
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

export function formatAssociationEvidence(
  associations: CardAssociationData,
  stats: LinkStats,
): string {
  const evidence = stats.coCount.toFixed(stats.coCount % 1 === 0 ? 0 : 1);
  const examples = stats.exampleDeckIds
    .map((deckId) => associations.__meta.deckNames[deckId] ?? deckId)
    .slice(0, 3);
  const exampleText = examples.length > 0 ? `\n${examples.join("\n")}` : "";
  const clusterCount = new Set(stats.clusterIds).size;

  return [
    `Score: ${stats.score}`,
    `Confidence: ${Math.round(stats.confidence * 100)}%`,
    `Lift: ${stats.lift.toFixed(1)}x`,
    `Evidence: ${evidence} weighted decks`,
    `Seen across ${clusterCount} archetype cluster${clusterCount === 1 ? "" : "s"}`,
  ].join("\n") + exampleText;
}
