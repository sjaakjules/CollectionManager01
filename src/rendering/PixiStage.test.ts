import { describe, expect, it } from "vitest";
import { mergeSelectedCardNames } from "@/rendering/PixiStage";

describe("PixiStage selection helpers", () => {
  it("includes selected zone cards when emitting selected card names", () => {
    expect(mergeSelectedCardNames(["Beta"], ["Alpha", "Beta"])).toEqual([
      "Alpha",
      "Beta",
    ]);
  });
});
