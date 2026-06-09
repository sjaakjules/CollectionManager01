import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatAssociationEvidence,
  getAssociationNodeId,
  getAssociationClusterCardScore,
  getAssociationClusterGroups,
  getAssociationClusters,
  getAssociationScores,
  hasCollectionAssociationSource,
  loadCardAssociations,
  resolveAssociationNodeId,
  type CardAssociationData,
  type LinkStats,
} from "@/data/cardAssociations";

function stats(score: number, overrides: Partial<LinkStats> = {}): LinkStats {
  return {
    score,
    confidence: 0.5,
    lift: 2,
    coCount: 2,
    countA: 3,
    countB: 4,
    totalWeight: 5,
    exampleDeckIds: ["deck-1"],
    clusterIds: ["cluster-1", "cluster-2"],
    ...overrides,
  };
}

function associations(mode: "balanced" | "meta" = "balanced"): CardAssociationData {
  return {
    __meta: {
      version: 2,
      generatedAt: "2026-01-01T00:00:00.000Z",
      mode,
      sourceDeckCount: 1,
      acceptedDeckCount: 1,
      skippedDeckCount: 0,
      deckCount: 1,
      clusterCount: 2,
      clusterSizes: { "cluster-1": 1, "cluster-2": 1 },
      filters: {
        constructedOnly: true,
        fullDecksOnly: true,
        includeSkipped: false,
      },
      options: {
        topLinks: 10,
        minEvidence: 0,
        similarityThreshold: 1,
        weights: {
          spellbook: 0.75,
          atlas: 0.2,
          collection: 0,
          avatar: 0.05,
        },
      },
      deckNames: { "deck-1": "Example Deck" },
      collectionNodeIds: ["card:a"],
    },
    nodes: {
      "card:a": {
        id: "card:a",
        kind: "card",
        displayName: "A",
        canonicalName: "a",
      },
      "card:b": {
        id: "card:b",
        kind: "card",
        displayName: "B",
        canonicalName: "b",
      },
      "avatar:a": {
        id: "avatar:a",
        kind: "avatar",
        displayName: "A",
        canonicalName: "a",
      },
      "avatar:b": {
        id: "avatar:b",
        kind: "avatar",
        displayName: "B",
        canonicalName: "b",
      },
    },
    clusters: {
      "cluster-1": {
        id: "cluster-1",
        label: "Cluster 1",
        avatarIds: ["avatar:a"],
        size: 2,
        totalWeight: 2,
        deckIds: ["deck-1"],
        cards: {
          "card:a": {
            score: 100,
            confidence: 1,
            count: 2,
            totalWeight: 2,
          },
        },
      },
      "cluster-2": {
        id: "cluster-2",
        label: "Cluster 2",
        avatarIds: ["avatar:a", "avatar:b"],
        size: 3,
        totalWeight: 3,
        deckIds: ["deck-2"],
        cards: {},
      },
    },
    index: {
      "card:a": [
        {
          to: "card:b",
          mainMain: stats(11),
          mainCollection: {
            mainToCollection: stats(22),
            collectionToMain: stats(33),
          },
          collectionCollection: stats(44),
        },
      ],
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("card association runtime helpers", () => {
  it("maps source-zone scores to the expected outline channels", () => {
    const data = associations();

    expect(getAssociationScores(data, "card:a", "card:b", "main")).toMatchObject({
      main: { score: 11 },
      collection: { score: 22 },
    });
    expect(getAssociationScores(data, "card:a", "card:b", "collection")).toMatchObject({
      main: { score: 33 },
      collection: { score: 44 },
    });
  });

  it("resolves canonical node ids with card and avatar kinds kept distinct", () => {
    const data = associations();

    expect(getAssociationNodeId("A", "card")).toBe("card:a");
    expect(resolveAssociationNodeId(data, "A", "Avatar")).toBe("avatar:a");
    expect(resolveAssociationNodeId(data, "A", "Magic")).toBe("card:a");
    expect(hasCollectionAssociationSource(data, "A", "Magic")).toBe(true);
    expect(hasCollectionAssociationSource(data, "A", "Avatar")).toBe(false);
  });

  it("includes cluster coverage in tooltip evidence", () => {
    expect(formatAssociationEvidence(associations(), stats(10))).toContain(
      "Seen across 2 archetype clusters",
    );
  });

  it("sorts clusters and returns card scores for a selected cluster", () => {
    const data = associations();

    expect(getAssociationClusters(data).map((cluster) => cluster.id)).toEqual([
      "cluster-1",
      "cluster-2",
    ]);
    expect(getAssociationClusterCardScore(data, "cluster-1", "card:a")).toMatchObject({
      score: 100,
    });
  });

  it("groups clusters by avatar and keeps multi-avatar clusters separate", () => {
    const groups = getAssociationClusterGroups(associations());

    expect(groups.map((group) => group.label)).toEqual(["A", "Multi-avatar"]);
    expect(groups[0]?.clusters.map((cluster) => cluster.id)).toEqual(["cluster-1"]);
    expect(groups[1]?.clusters.map((cluster) => cluster.id)).toEqual(["cluster-2"]);
  });

  it("loads the selected balanced or meta static asset", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      return new Response(
        JSON.stringify(associations(path.includes("_meta") ? "meta" : "balanced")),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const balanced = await loadCardAssociations("balanced");
    const meta = await loadCardAssociations("meta");

    expect(balanced.__meta.mode).toBe("balanced");
    expect(meta.__meta.mode).toBe("meta");
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/assets/sorcery_card_associations_balanced.json",
      "/assets/sorcery_card_associations_meta.json",
    ]);
  });
});
