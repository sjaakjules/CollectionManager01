import { describe, expect, it } from "vitest";
import type { Card } from "@/data/dataModels";
import {
  addCustomCategory,
  buildCardCategorySeed,
  getCategoryShelfCards,
  getHiddenBaseCardCategories,
  getVisibleCardCategories,
  normalizeCardCategoryData,
  removeCategory,
  restoreBaseCategory,
  setCategoryScore,
  updateCategoryDefinition,
  type CardCategoryData,
} from "@/data/cardCategories";

function card(name: string): Card {
  return {
    name,
    guardian: {
      rarity: "Ordinary",
      type: "Magic",
      rulesText: "",
      cost: 0,
      attack: null,
      defence: null,
      life: null,
      thresholds: { air: 0, earth: 0, fire: 0, water: 0 },
    },
    elements: "",
    subTypes: "",
    sets: [],
  };
}

const taxonomy = {
  version: "test-taxonomy",
  cardCategories: {
    Swarm: {
      tooltip: "Many bodies",
      description: "Many bodies on the board",
    },
    Burn: {
      tooltip: "Direct damage",
      description: "Direct damage and reach",
    },
  },
  displayOrder: {
    cardCategories: ["Burn", "Swarm"],
  },
};

describe("card category seed helpers", () => {
  it("builds stable ids, display order, and clamped decimal scores", () => {
    const seed = buildCardCategorySeed(taxonomy, {
      Fireball: { Burn: 0.876, Swarm: 0 },
      Goblins: { Swarm: 1.2 },
    });

    expect(seed.version).toBe("test-taxonomy");
    expect(seed.categories.map((category) => category.id)).toEqual([
      "burn",
      "swarm",
    ]);
    expect(seed.scores.Fireball).toEqual({ burn: 0.88 });
    expect(seed.scores.Goblins).toEqual({ swarm: 1 });
  });

  it("normalizes persisted edits while adding new seed categories and scores", () => {
    const seed = buildCardCategorySeed(taxonomy, {
      Fireball: { Burn: 0.7 },
      Goblins: { Swarm: 0.9 },
    });
    const persisted: CardCategoryData = {
      version: "older",
      categories: [
        {
          id: "burn",
          name: "Heat",
          tooltip: "Edited tooltip",
          description: "Edited description",
          base: true,
          hidden: true,
        },
        {
          id: "custom-plan",
          name: "Custom Plan",
          tooltip: "Custom",
          description: "Custom",
          base: false,
        },
      ],
      scores: {
        Fireball: { burn: 0.42, "custom-plan": 0.333 },
      },
    };

    const normalized = normalizeCardCategoryData(persisted, seed);

    expect(normalized.categories.find((category) => category.id === "burn")).toMatchObject({
      name: "Heat",
      hidden: true,
    });
    expect(normalized.categories.some((category) => category.id === "swarm")).toBe(true);
    expect(normalized.scores.Fireball).toEqual({
      burn: 0.42,
      "custom-plan": 0.33,
    });
    expect(normalized.scores.Goblins?.swarm).toBe(0.9);
  });
});

describe("card category editing helpers", () => {
  const baseData: CardCategoryData = {
    version: "test",
    categories: [
      {
        id: "burn",
        name: "Burn",
        tooltip: "Direct damage",
        description: "Direct damage",
        base: true,
      },
      {
        id: "custom-plan",
        name: "Custom Plan",
        tooltip: "Custom",
        description: "Custom",
        base: false,
      },
    ],
    scores: {
      Fireball: { burn: 0.5, "custom-plan": 0.4 },
    },
  };

  it("adds custom categories with unique ids and edits tooltip text", () => {
    const added = addCustomCategory(baseData, "Burn", "Second burn lane");
    const custom = added.categories.at(-1);

    expect(custom).toMatchObject({
      id: "burn-2",
      name: "Burn",
      tooltip: "Second burn lane",
      base: false,
    });

    const edited = updateCategoryDefinition(added, "burn-2", {
      name: "Reach",
      description: "Finishing damage",
    });

    expect(edited.categories.find((category) => category.id === "burn-2")).toMatchObject({
      name: "Reach",
      tooltip: "Finishing damage",
      description: "Finishing damage",
    });
  });

  it("soft-hides base categories, restores them, and hard-removes custom categories", () => {
    const hidden = removeCategory(baseData, "burn");

    expect(getVisibleCardCategories(hidden).map((category) => category.id)).toEqual([
      "custom-plan",
    ]);
    expect(getHiddenBaseCardCategories(hidden).map((category) => category.id)).toEqual([
      "burn",
    ]);
    expect(hidden.scores.Fireball?.burn).toBe(0.5);

    const restored = restoreBaseCategory(hidden, "burn");
    expect(getVisibleCardCategories(restored).map((category) => category.id)).toContain(
      "burn",
    );

    const removedCustom = removeCategory(restored, "custom-plan");
    expect(removedCustom.categories.some((category) => category.id === "custom-plan")).toBe(
      false,
    );
    expect(removedCustom.scores.Fireball?.["custom-plan"]).toBeUndefined();
  });

  it("clamps scores, rounds to two decimals, and omits zeroes", () => {
    const withScore = setCategoryScore(baseData, "Lightning Bolt", "burn", 0.126);
    expect(withScore.scores["Lightning Bolt"]?.burn).toBe(0.13);

    const clampedHigh = setCategoryScore(withScore, "Lightning Bolt", "burn", 2);
    expect(clampedHigh.scores["Lightning Bolt"]?.burn).toBe(1);

    const removed = setCategoryScore(clampedHigh, "Lightning Bolt", "burn", 0);
    expect(removed.scores["Lightning Bolt"]).toBeUndefined();

    const tokenAttempt = setCategoryScore(baseData, "Frog", "burn", 1);
    expect(tokenAttempt.scores.Frog).toBeUndefined();
  });

  it("builds a score-sorted shelf for the active category", () => {
    const data = {
      ...baseData,
      scores: {
        Alpha: { burn: 0.2 },
        Bravo: { burn: 0.9 },
        Charlie: { burn: 0.9 },
      },
    };

    const shelf = getCategoryShelfCards(
      data,
      [card("Alpha"), card("Charlie"), card("Bravo"), card("Delta")],
      "burn",
    );

    expect(shelf.map((entry) => `${entry.card.name}:${entry.score}`)).toEqual([
      "Bravo:0.9",
      "Charlie:0.9",
      "Alpha:0.2",
    ]);
  });
});
