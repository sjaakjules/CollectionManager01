import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatAssociationEvidence,
  formatAssociationPackageEvidence,
  getAssociationNodeId,
  getAssociationClusterCardScore,
  getAssociationClusterGroupCardScore,
  getAssociationClusterGroups,
  getAssociationClusters,
  getAssociationPackageCardScore,
  getAssociationPackages,
  getAssociationDisplayScores,
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
      clusterCount: 3,
      clusterSizes: { "cluster-1": 1, "cluster-2": 1, "cluster-3": 1 },
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
      "card:c": {
        id: "card:c",
        kind: "card",
        displayName: "C",
        canonicalName: "c",
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
      "cluster-3": {
        id: "cluster-3",
        label: "Cluster 3",
        avatarIds: ["avatar:a"],
        size: 4,
        totalWeight: 4,
        deckIds: ["deck-3"],
        cards: {
          "card:b": {
            score: 72,
            confidence: 0.75,
            count: 3,
            totalWeight: 4,
          },
        },
      },
    },
    packages: [
      {
        id: "pkg-01",
        label: "A / B / C",
        topNodes: [
          { nodeId: "card:a", weight: 1, displayName: "A" },
          { nodeId: "card:b", weight: 0.8, displayName: "B" },
          { nodeId: "card:c", weight: 0.6, displayName: "C" },
        ],
        exampleDecks: [{ deckId: "deck-1", deckName: "Example Deck", membership: 1 }],
        supportDeckCount: 3,
        weightedSupport: 6,
        maxMembership: 1,
      },
    ],
    cardPackages: {
      "card:a": [{ packageId: "pkg-01", strength: 1, packageLabel: "A / B / C" }],
      "card:b": [{ packageId: "pkg-01", strength: 0.8, packageLabel: "A / B / C" }],
      "card:c": [{ packageId: "pkg-01", strength: 0.6, packageLabel: "A / B / C" }],
    },
    deckPackages: {
      "deck-1": [{ packageId: "pkg-01", strength: 1 }],
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
          packages: {
            score: 80,
            blendedMainScore: 37,
            shared: [{ packageId: "pkg-01", label: "A / B / C", strength: 0.8 }],
          },
        },
        {
          to: "card:c",
          packages: {
            score: 60,
            blendedMainScore: 18,
            shared: [{ packageId: "pkg-01", label: "A / B / C", strength: 0.6 }],
          },
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

  it("returns package-boosted display scores without fabricating pairwise stats", () => {
    const data = associations();

    expect(getAssociationDisplayScores(data, "card:a", "card:b", "main")).toMatchObject({
      main: { score: 11 },
      collection: null,
      mainScore: 37,
      collectionScore: null,
      packages: { score: 80, blendedMainScore: 37 },
    });

    expect(getAssociationDisplayScores(data, "card:a", "card:c", "main")).toMatchObject({
      main: null,
      collection: null,
      mainScore: 18,
      collectionScore: null,
      packages: { score: 60, blendedMainScore: 18 },
    });
  });

  it("keeps package boosts scoped to main targets", () => {
    const data = associations();

    expect(
      getAssociationDisplayScores(data, "card:a", "card:b", "main", "collection"),
    ).toMatchObject({
      main: null,
      collection: { score: 22 },
      mainScore: null,
      collectionScore: 22,
      packages: null,
    });

    expect(
      getAssociationDisplayScores(data, "card:a", "card:b", "collection", "main"),
    ).toMatchObject({
      main: { score: 33 },
      collection: null,
      mainScore: 37,
      collectionScore: null,
      packages: { score: 80, blendedMainScore: 37 },
    });

    expect(
      getAssociationDisplayScores(data, "card:a", "card:b", "collection", "collection"),
    ).toMatchObject({
      main: null,
      collection: { score: 44 },
      mainScore: null,
      collectionScore: 44,
      packages: null,
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

  it("formats package evidence after pairwise evidence", () => {
    const data = associations();
    const display = getAssociationDisplayScores(data, "card:a", "card:b", "main");

    expect(display.main).not.toBeNull();
    const text = formatAssociationEvidence(data, display.main as LinkStats, display.packages);

    expect(text).toContain("Score: 11");
    expect(text).toContain("Displayed score: 37");
    expect(text).toContain("Package relation");
    expect(text).toContain("Shared package: A / B / C (80%)");
    expect(text).toContain("Also appears in: Example Deck");
    expect(text.indexOf("Confidence:")).toBeLessThan(text.indexOf("Package relation"));
  });

  it("formats package-only evidence", () => {
    const data = associations();
    const display = getAssociationDisplayScores(data, "card:a", "card:c", "main");

    expect(formatAssociationPackageEvidence(display.packages, data)).toContain(
      "Shared package: A / B / C (60%)",
    );
  });

  it("sorts clusters and returns card scores for a selected cluster", () => {
    const data = associations();

    expect(getAssociationClusters(data).map((cluster) => cluster.id)).toEqual([
      "cluster-1",
      "cluster-2",
      "cluster-3",
    ]);
    expect(getAssociationClusterCardScore(data, "cluster-1", "card:a")).toMatchObject({
      score: 100,
    });
  });

  it("groups clusters by avatar and keeps multi-avatar clusters separate", () => {
    const groups = getAssociationClusterGroups(associations());

    expect(groups.map((group) => group.label)).toEqual(["A", "Multi-avatar"]);
    expect(groups[0]?.clusters.map((cluster) => cluster.id)).toEqual([
      "cluster-1",
      "cluster-3",
    ]);
    expect(groups[1]?.clusters.map((cluster) => cluster.id)).toEqual(["cluster-2"]);
  });

  it("returns the best card score across every cluster in an avatar group", () => {
    const data = associations();

    expect(getAssociationClusterGroupCardScore(data, "avatar:a", "card:a")).toMatchObject({
      score: 100,
    });
    expect(getAssociationClusterGroupCardScore(data, "avatar:a", "card:b")).toMatchObject({
      score: 72,
    });
    expect(getAssociationClusterGroupCardScore(data, "avatar:a", "card:c")).toBeNull();
  });

  it("returns packages and package card scores for package browsing", () => {
    const data = associations();

    expect(getAssociationPackages(data).map((pkg) => pkg.id)).toEqual(["pkg-01"]);
    expect(getAssociationPackageCardScore(data, "pkg-01", "card:b")).toMatchObject({
      score: 80,
      strength: 0.8,
      packageId: "pkg-01",
      packageLabel: "A / B / C",
    });
    expect(getAssociationPackageCardScore(data, "pkg-01", "avatar:a")).toBeNull();
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
