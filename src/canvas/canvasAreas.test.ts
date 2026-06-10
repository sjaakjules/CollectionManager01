import { describe, expect, it } from "vitest";
import {
  QUADRANT_BOUNDS,
  ZONE_DEFAULT_SIZE,
  cardNameToOrientationMap,
  createEmptyZone,
  createLookupDeckZone,
  getQuadrantByZoneId,
} from "@/canvas/canvasAreas";
import type { Card, Deck } from "@/data/dataModels";

function card(name: string, type: Card["guardian"]["type"]): Card {
  return {
    name,
    guardian: {
      rarity: "Ordinary",
      type,
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

const deck: Deck = {
  id: "lookup-source",
  name: "Lookup Source",
  boards: {
    avatar: [{ name: "Druid", quantity: 1 }],
    mainboard: [{ name: "Spark", quantity: 1 }],
    sideboard: [],
    maybeboard: [],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("canvas area placement", () => {
  it("places saved deck and stack areas in the saved top-left quadrant", () => {
    expect(getQuadrantByZoneId(createEmptyZone("deck", "Deck", 0))).toBe("decks");
    expect(getQuadrantByZoneId(createEmptyZone("stack", "Stack", 0))).toBe("decks");
  });

  it("places temporary lookup decks in the lower-left quadrant", () => {
    const lookup = createLookupDeckZone(
      deck,
      cardNameToOrientationMap([card("Druid", "Avatar"), card("Spark", "Magic")]),
    );

    expect(getQuadrantByZoneId(lookup)).toBe("stacks");
    expect(lookup.lookupDeckId).toBe("lookup-source");
    expect(lookup.deckId).toBeUndefined();
    expect(lookup.bounds.x).toBeGreaterThanOrEqual(QUADRANT_BOUNDS.stacks.x);
    expect(lookup.bounds.y).toBeGreaterThanOrEqual(QUADRANT_BOUNDS.stacks.y);
  });

  it("avoids existing pinned zones when placing temporary lookup decks", () => {
    const existingLowerLeftZone = {
      ...createEmptyZone("stack", "Old Stack", 0),
      bounds: {
        x: QUADRANT_BOUNDS.stacks.x + 220,
        y: QUADRANT_BOUNDS.stacks.y + 220,
        width: ZONE_DEFAULT_SIZE.deck.width,
        height: ZONE_DEFAULT_SIZE.deck.height,
      },
    };
    const lookup = createLookupDeckZone(
      deck,
      cardNameToOrientationMap([card("Druid", "Avatar"), card("Spark", "Magic")]),
      [existingLowerLeftZone],
    );

    expect(lookup.bounds).not.toEqual(existingLowerLeftZone.bounds);
  });
});
