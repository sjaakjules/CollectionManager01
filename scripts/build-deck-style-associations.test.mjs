import { describe, expect, it } from "vitest";

import {
  buildDeckStyleAssociations,
  canonicalizeId,
  copySaturation,
  inferMissingDeckStyleScores,
  parseArgs,
} from "./build-deck-style-associations.mjs";

function card(name, rarity = "Ordinary", type = "Magic") {
  return {
    name,
    guardian: {
      rarity,
      type,
      rulesText: "",
      cost: 0,
      attack: null,
      defence: null,
      life: null,
      thresholds: {
        air: name === "Air Spell" ? 1 : 0,
        earth: name === "Site" ? 1 : 0,
        fire: name === "Common" ? 1 : 0,
        water: name === "Sideboard" ? 1 : 0,
      },
    },
    elements: "",
    subTypes: "",
    sets: [],
  };
}

function deck(id, { avatar, spellbook = {}, atlas = {}, collection = {}, maybe = {} }) {
  return {
    deckinfo: {
      id,
      name: `Deck ${id}`,
      avatar,
      cards: {
        spellbook,
        atlas,
        collection,
        maybe,
      },
    },
  };
}

const taxonomy = {
  deckStyles: {
    Vanguard: {
      tooltip: "Front pressure",
      description: "Front pressure",
      subStyles: {
        Burn: "Damage backed pressure",
        Board: "Board backed pressure",
      },
    },
    Control: {
      tooltip: "Control",
      description: "Control",
      subStyles: {
        Removal: "Removal",
      },
    },
  },
  displayOrder: {
    deckStyles: ["Vanguard", "Control"],
  },
};

const styleScores = {
  d1: {
    deckName: "Deck d1",
    style: "Vanguard",
    subStyle: "Burn",
    fractionalStyles: { Vanguard: 0.8, Control: 0.2 },
    fractionalSubStyles: {
      Vanguard: { Burn: 0.6, Board: 0.1 },
      Control: { Removal: 0.2 },
    },
  },
  d2: {
    deckName: "Deck d2",
    style: "Vanguard",
    subStyle: "Board",
    fractionalStyles: { Vanguard: 0.4 },
    fractionalSubStyles: {
      Vanguard: { Burn: 0.2, Board: 0.5 },
    },
  },
  d3: {
    deckName: "Deck d3",
    style: "Control",
    subStyle: "Removal",
    fractionalStyles: { Vanguard: 0.5, Control: 0.6 },
    fractionalSubStyles: {
      Vanguard: { Burn: 0.25 },
      Control: { Removal: 0.6 },
    },
  },
};

const archive = {
  d1: deck("d1", {
    avatar: "Avatar A",
    spellbook: { Common: 2, "Unique Bomb": 1, Frog: 4, "Foot Soldier": 1 },
    collection: { Sideboard: 2 },
    maybe: { "Maybe Card": 4 },
  }),
  d2: deck("d2", {
    avatar: "Avatar B",
    spellbook: { Common: 4 },
    collection: { Sideboard: 4 },
  }),
  d3: deck("d3", {
    avatar: "Avatar C",
    spellbook: { Common: 4 },
    atlas: { Site: 1 },
  }),
  d4: {
    deckinfo: {
      ...deck("d4", {
        avatar: "Avatar A",
        spellbook: { "Air Spell": 4 },
      }).deckinfo,
      format: "Constructed",
      competitive: {
        isCompetitive: true,
        confidence: "high",
        seasons: [2026],
        events: ["Grand Contest"],
        locations: ["Melbourne"],
        resultTags: ["winner"],
        placements: [1],
        topCuts: [],
        records: ["5-0"],
        matchedQueries: ["Grand Contest"],
        matchedSignals: ["event:grand-contest"],
        likes: 5,
        views: 50,
      },
    },
  },
};

const cards = [
  card("Avatar A", "Unique", "Avatar"),
  card("Avatar B", "Unique", "Avatar"),
  card("Avatar C", "Unique", "Avatar"),
  card("Common"),
  card("Air Spell"),
  card("Unique Bomb", "Unique"),
  card("Sideboard"),
  card("Site", "Ordinary", "Site"),
  card("Maybe Card"),
  card("Frog"),
];

describe("deck-style association builder", () => {
  it("parses default paths and alpha", () => {
    const options = parseArgs([]);

    expect(options.outputPath).toBe("public/assets/sorcery_deck_style_associations.json");
    expect(options.alpha).toBe(1);
  });

  it("canonicalizes ids and rarity-normalizes saturation", () => {
    expect(canonicalizeId("Burn Pressure")).toBe("burn-pressure");
    expect(copySaturation(2, 4)).toBe(0.5);
    expect(copySaturation(1, 1)).toBe(1);
  });

  it("builds primary and fractional style scores with alpha=1 deck weighting", () => {
    const output = buildDeckStyleAssociations({
      styleScores,
      taxonomy,
      archive,
      cards,
      alpha: 1,
      inferMissingStyles: false,
    });
    const primaryVanguard = output.modes.primary.styles.vanguard;
    const fractionalVanguard = output.modes.fractional.styles.vanguard;

    expect(primaryVanguard.cards.Common.score).toBe(0.4);
    expect(primaryVanguard.cards["Unique Bomb"].score).toBe(0.4);
    expect(primaryVanguard.cards.Sideboard.score).toBe(0.4);
    expect(primaryVanguard.cards["Maybe Card"]).toBeUndefined();
    expect(primaryVanguard.cards.Frog).toBeUndefined();
    expect(primaryVanguard.cards.Common.deckCount).toBe(2);
    expect(primaryVanguard.cards.Common.weightedDecks).toBe(1);

    expect(fractionalVanguard.cards.Common.score).toBe(0.43);
    expect(fractionalVanguard.cards["Unique Bomb"].score).toBe(0.27);
    expect(fractionalVanguard.cards.Site.score).toBe(0.04);
    expect(fractionalVanguard.cards.Common.deckCount).toBe(3);
    expect(fractionalVanguard.cards.Common.weightedDecks).toBe(1);
  });

  it("aggregates sub-styles differently for primary and fractional modes", () => {
    const output = buildDeckStyleAssociations({
      styleScores,
      taxonomy,
      archive,
      cards,
      alpha: 1,
      inferMissingStyles: false,
    });
    const primaryBurn = output.modes.primary.styles.vanguard.subStyles.burn;
    const fractionalBurn = output.modes.fractional.styles.vanguard.subStyles.burn;

    expect(primaryBurn.cards.Common.score).toBe(0.3);
    expect(primaryBurn.cards["Unique Bomb"].score).toBe(0.6);
    expect(primaryBurn.cards.Common.deckCount).toBe(1);

    expect(fractionalBurn.cards.Common.score).toBe(0.25);
    expect(fractionalBurn.cards["Unique Bomb"].score).toBe(0.2);
    expect(fractionalBurn.cards.Site.score).toBe(0.02);
    expect(fractionalBurn.cards.Common.deckCount).toBe(3);
  });

  it("emits associated deck lookup rows for styles and sub-styles", () => {
    const output = buildDeckStyleAssociations({
      styleScores,
      taxonomy,
      archive,
      cards,
      alpha: 1,
      inferMissingStyles: false,
    });
    const primaryVanguard = output.modes.primary.styles.vanguard;
    const primaryBurn = primaryVanguard.subStyles.burn;
    const fractionalBurn = output.modes.fractional.styles.vanguard.subStyles.burn;

    expect(primaryVanguard.decks).toEqual([
      { deckId: "d1", score: 0.8 },
      { deckId: "d2", score: 0.4 },
    ]);
    expect(primaryBurn.decks).toEqual([{ deckId: "d1", score: 0.6 }]);
    expect(fractionalBurn.decks).toEqual([
      { deckId: "d1", score: 0.6 },
      { deckId: "d3", score: 0.25 },
      { deckId: "d2", score: 0.2 },
    ]);
  });

  it("emits compact runtime decks with atlas in mainboard and no tokens", () => {
    const output = buildDeckStyleAssociations({
      styleScores,
      taxonomy,
      archive,
      cards,
      alpha: 1,
      inferMissingStyles: false,
    });

    expect(output.decks.d3.boards.mainboard).toEqual([
      { name: "Common", quantity: 4 },
      { name: "Site", quantity: 1 },
    ]);
    expect(output.decks.d1.boards.avatar).toEqual([
      { name: "Avatar A", quantity: 1 },
    ]);
    expect(output.decks.d1.boards.mainboard.map((entry) => entry.name)).not.toContain(
      "Frog",
    );
    expect(output.decks.d1.boards.mainboard.map((entry) => entry.name)).not.toContain(
      "Foot Soldier",
    );
    expect(output.decks.d1.elements).toEqual(["fire", "water"]);
    expect(output.decks.d3.elements).toEqual(["fire"]);
  });

  it("includes unscored archive decks and preserves competitive lookup metadata", () => {
    const output = buildDeckStyleAssociations({
      styleScores,
      taxonomy,
      archive,
      cards,
      alpha: 1,
      inferMissingStyles: false,
    });

    expect(output.version).toBe("sorcery-deck-style-associations-v2");
    expect(output.decks.d4).toMatchObject({
      id: "d4",
      format: "Constructed",
      competitive: {
        isCompetitive: true,
        events: ["Grand Contest"],
        placements: [1],
      },
    });
    expect(output.modes.primary.styles.vanguard.decks).not.toContainEqual(
      expect.objectContaining({ deckId: "d4" }),
    );
  });

  it("infers missing deck styles from similar scored decklists", () => {
    const inference = inferMissingDeckStyleScores({
      styleScores,
      taxonomy,
      archive,
      cards,
    });

    expect(inference.summary).toMatchObject({
      sourceDeckCount: 3,
      inferredDeckCount: 1,
      unscoredDeckCount: 0,
    });
    expect(inference.styleScores.d4).toMatchObject({
      style: "Vanguard",
      subStyle: "Burn",
      inferred: {
        method: "tfidf-nearest-decks-v1",
        closestDeckId: "d1",
      },
    });

    const output = buildDeckStyleAssociations({
      styleScores,
      taxonomy,
      archive,
      cards,
      alpha: 1,
    });
    expect(output.styleScoring).toMatchObject({
      inferredDeckCount: 1,
      unscoredDeckCount: 0,
    });
    expect(output.modes.primary.styles.vanguard.decks).toContainEqual(
      expect.objectContaining({ deckId: "d4" }),
    );
  });

  it("sorts output cards by score, then card name", () => {
    const output = buildDeckStyleAssociations({
      styleScores,
      taxonomy,
      archive,
      cards,
      alpha: 1,
      inferMissingStyles: false,
    });

    expect(Object.keys(output.modes.primary.styles.vanguard.cards).slice(0, 3)).toEqual([
      "Avatar A",
      "Common",
      "Sideboard",
    ]);
  });
});
