import { describe, expect, it } from "vitest";
import type { Card, Deck } from "@/data/dataModels";
import { createEmptyDeck } from "@/data/dataModels";
import {
  getAvatarShortName,
  getDeckDisplayName,
  getDeckElementSummary,
} from "@/ui/deckDisplay";

function card(name: string, thresholds: { air?: number; earth?: number; fire?: number; water?: number }): Card {
  return {
    name,
    guardian: {
      rarity: "Ordinary",
      type: "Minion",
      rulesText: "",
      cost: 1,
      attack: 1,
      defence: 1,
      life: null,
      thresholds: {
        air: thresholds.air ?? 0,
        earth: thresholds.earth ?? 0,
        fire: thresholds.fire ?? 0,
        water: thresholds.water ?? 0,
      },
    },
    elements: "",
    subTypes: "",
    sets: [],
  };
}

function deckWithAvatar(avatarName: string): Deck {
  const deck = createEmptyDeck("Example", "deck-1");
  deck.boards.avatar.push({ name: avatarName, quantity: 1 });
  return deck;
}

describe("deck display helpers", () => {
  it("uses the provided avatar short names", () => {
    expect(getAvatarShortName("Avatar of Fire")).toBe("AoFire");
    expect(getAvatarShortName("Spellslinger")).toBe("Sling");
    expect(getAvatarShortName("Animist")).toBe("Animist");
  });

  it("falls back to deck names for unknown avatars", () => {
    expect(getAvatarShortName("Custom Avatar")).toBe("Custom Avatar");
  });

  it("formats deck display labels from the avatar", () => {
    expect(getDeckDisplayName(deckWithAvatar("Dragonlord"))).toBe("Dragon");
  });

  it("derives element symbols from non-avatar deck cards", () => {
    const deck = deckWithAvatar("Avatar of Fire");
    deck.boards.mainboard.push({ name: "Air Card", quantity: 2 });
    deck.boards.sideboard.push({ name: "Earth Fire Card", quantity: 1 });

    expect(
      getDeckElementSummary(deck, [
        card("Air Card", { air: 1 }),
        card("Earth Fire Card", { earth: 1, fire: 2 }),
      ]),
    ).toEqual(["air", "earth", "fire"]);
  });
});

