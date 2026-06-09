import { describe, expect, it } from "vitest";
import type { CanvasArea } from "@/canvas/canvasAreas";
import { createEmptyDeck } from "@/data/dataModels";
import { buildQuickTransferDeckTargets } from "./deckTransferTargets";

describe("buildQuickTransferDeckTargets", () => {
  it("includes loaded decks even when they do not have canvas areas", () => {
    const deckWithArea = createEmptyDeck("Area Deck", "deck-with-area");
    deckWithArea.boards.avatar = [{ name: "Avatar of Fire", quantity: 1 }];
    const loadedOnlyDeck = createEmptyDeck("Loaded Deck", "loaded-only");
    loadedOnlyDeck.boards.avatar = [{ name: "Animist", quantity: 1 }];
    const canvasAreas: CanvasArea[] = [
      {
        id: "area-1",
        name: "Area Deck",
        type: "deck",
        deckId: "deck-with-area",
        pinned: true,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        cards: [],
        avatarCardName: "Avatar of Fire",
      },
    ];

    expect(buildQuickTransferDeckTargets([deckWithArea, loadedOnlyDeck], canvasAreas)).toEqual([
      {
        id: "deck:deck-with-area",
        deckId: "deck-with-area",
        canvasAreaId: "area-1",
        label: "AoFire",
      },
      {
        id: "deck:loaded-only",
        deckId: "loaded-only",
        canvasAreaId: null,
        label: "Animist",
      },
    ]);
  });
});
