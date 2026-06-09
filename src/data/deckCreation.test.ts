import { describe, expect, it } from "vitest";
import { createLocalDeck } from "@/data/deckCreation";

describe("createLocalDeck", () => {
  it("creates an existing-schema deck with avatar and counted mainboard cards", () => {
    const deck = createLocalDeck({
      id: "deck-local",
      name: "AoFire Deck",
      avatarName: "Avatar of Fire",
      mainboardCardNames: ["Spark", "Spark", "Bolt"],
    });

    expect(deck.id).toBe("deck-local");
    expect(deck.boards.avatar).toEqual([{ name: "Avatar of Fire", quantity: 1 }]);
    expect(deck.boards.mainboard).toEqual([
      { name: "Spark", quantity: 2 },
      { name: "Bolt", quantity: 1 },
    ]);
    expect(deck.boards.sideboard).toEqual([]);
    expect(deck.boards.maybeboard).toEqual([]);
  });
});

