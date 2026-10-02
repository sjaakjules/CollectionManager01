import { describe, expect, it } from "vitest";
import { BOARD_CHOICE_OPTIONS, getBoardChoiceLabel } from "./boardChoice";

describe("board choice options", () => {
  it("maps UI choices to existing deck board keys", () => {
    expect(BOARD_CHOICE_OPTIONS).toEqual([
      { board: "mainboard", label: "Main" },
      { board: "collection", label: "Collection" },
      { board: "maybeboard", label: "Maybe" },
    ]);
  });

  it("returns labels for deck-add boards", () => {
    expect(getBoardChoiceLabel("mainboard")).toBe("Main");
    expect(getBoardChoiceLabel("collection")).toBe("Collection");
    expect(getBoardChoiceLabel("maybeboard")).toBe("Maybe");
  });
});
