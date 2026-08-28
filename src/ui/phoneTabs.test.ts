import { describe, expect, it } from "vitest";
import { getPhoneSideSwipeTarget, togglePhoneTab } from "./phoneTabs";

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

describe("getPhoneSideSwipeTarget", () => {
  it("opens stacks from a left-edge swipe", () => {
    expect(
      getPhoneSideSwipeTarget({
        current: null,
        startX: 10,
        startY: 200,
        endX: 84,
        endY: 210,
        viewportWidth: 390,
      }),
    ).toBe("stacks");
  });

  it("opens decks from a right-edge swipe", () => {
    expect(
      getPhoneSideSwipeTarget({
        current: null,
        startX: 382,
        startY: 200,
        endX: 300,
        endY: 205,
        viewportWidth: 390,
      }),
    ).toBe("decks");
  });

  it("closes an open side panel with the opposite swipe", () => {
    expect(
      getPhoneSideSwipeTarget({
        current: "stacks",
        startX: 180,
        startY: 200,
        endX: 90,
        endY: 208,
        viewportWidth: 390,
      }),
    ).toBeNull();

    expect(
      getPhoneSideSwipeTarget({
        current: "decks",
        startX: 240,
        startY: 200,
        endX: 330,
        endY: 208,
        viewportWidth: 390,
      }),
    ).toBeNull();
  });

  it("ignores short or mostly vertical gestures", () => {
    expect(
      getPhoneSideSwipeTarget({
        current: null,
        startX: 12,
        startY: 100,
        endX: 38,
        endY: 104,
        viewportWidth: 390,
      }),
    ).toBeUndefined();

    expect(
      getPhoneSideSwipeTarget({
        current: null,
        startX: 12,
        startY: 100,
        endX: 72,
        endY: 170,
        viewportWidth: 390,
      }),
    ).toBeUndefined();
  });
});
