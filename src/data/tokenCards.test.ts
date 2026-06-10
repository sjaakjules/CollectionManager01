import { describe, expect, it } from "vitest";
import { isBlockedTokenCardName } from "@/data/tokenCards";

describe("token card filtering", () => {
  it("blocks token card names while keeping real similarly named cards", () => {
    expect(isBlockedTokenCardName("Frog")).toBe(true);
    expect(isBlockedTokenCardName("Frog (Blue)")).toBe(true);
    expect(isBlockedTokenCardName("Skeleton")).toBe(true);
    expect(isBlockedTokenCardName("Foot Soldier 1")).toBe(true);
    expect(isBlockedTokenCardName("Foot Soldier (English)")).toBe(true);
    expect(isBlockedTokenCardName("Foot Soldiers")).toBe(true);

    expect(isBlockedTokenCardName("Gift of the Frog")).toBe(false);
    expect(isBlockedTokenCardName("Plague of Frogs")).toBe(false);
    expect(isBlockedTokenCardName("Felbog Frog Men")).toBe(false);
    expect(isBlockedTokenCardName("Skeleton Mage")).toBe(false);
  });
});
