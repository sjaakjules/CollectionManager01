/**
 * Read-only card/avatar association data generated from downloaded decks.
 *
 * The generated JSON is static app data. It is intentionally kept out of
 * guest/account user data so users cannot mutate it through the UI.
 */

export type AssociationSourceZone = "main" | "collection";

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

export interface CardAssociationLink {
  to: string;
  mainMain?: LinkStats;
  mainCollection?: LinkStats;
  collectionCollection?: LinkStats;
}

export type CardAssociationIndex = Record<string, CardAssociationLink[]>;

export interface CardAssociationMeta {
  version: number;
  generatedAt: string;
  deckCount: number;
  clusterCount: number;
  clusterSizes: Record<string, number>;
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
  };
  deckNames: Record<string, string>;
  collectionNodeNames: string[];
}

export interface CardAssociationData {
  __meta: CardAssociationMeta;
  index: CardAssociationIndex;
}

export interface AssociationScores {
  main: LinkStats | null;
  collection: LinkStats | null;
}

let cachedAssociations: CardAssociationData | null = null;
let loadPromise: Promise<CardAssociationData> | null = null;

export async function loadCardAssociations(): Promise<CardAssociationData> {
  if (cachedAssociations) return cachedAssociations;
  if (loadPromise) return loadPromise;

  loadPromise = fetch("/assets/sorcery_card_associations.json", {
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to load card associations: ${response.status}`);
    }
    cachedAssociations = (await response.json()) as CardAssociationData;
    return cachedAssociations;
  });

  return loadPromise;
}

export function getAssociationLink(
  associations: CardAssociationData | null,
  from: string | null,
  to: string,
): CardAssociationLink | null {
  if (!associations || !from || from === to) return null;
  return associations.index[from]?.find((link) => link.to === to) ?? null;
}

export function getAssociationScores(
  associations: CardAssociationData | null,
  from: string | null,
  to: string,
  sourceZone: AssociationSourceZone,
): AssociationScores {
  const link = getAssociationLink(associations, from, to);
  if (!link) return { main: null, collection: null };

  if (sourceZone === "collection") {
    return {
      main: null,
      collection: link.collectionCollection ?? null,
    };
  }

  return {
    main: link.mainMain ?? null,
    collection: link.mainCollection ?? null,
  };
}

export function hasCollectionAssociationSource(
  associations: CardAssociationData | null,
  cardName: string | null,
): boolean {
  if (!associations || !cardName) return false;
  return associations.__meta.collectionNodeNames.includes(cardName);
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

  return [
    `Score: ${stats.score}`,
    `Confidence: ${Math.round(stats.confidence * 100)}%`,
    `Lift: ${stats.lift.toFixed(1)}x`,
    `Evidence: ${evidence} weighted decks`,
  ].join("\n") + exampleText;
}
