import { describe, expect, it } from "vitest";
import { togglePhoneTab } from "./phoneTabs";

describe("togglePhoneTab", () => {
  it("opens the requested tab when none is active", () => {
    expect(togglePhoneTab(null, "stacks")).toBe("stacks");
  });

  it("switches to the requested tab when another tab is active", () => {
    expect(togglePhoneTab("stacks", "filter")).toBe("filter");
  });

  it("closes the active tab when it is pressed again", () => {
    expect(togglePhoneTab("decks", "decks")).toBeNull();
  });
});
