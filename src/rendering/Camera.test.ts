import { describe, expect, it } from "vitest";
import {
  isTrackpadLikeWheel,
  normalizeWheelDeltaPixels,
  shouldPanSidewaysFromWheel,
} from "./Camera";

describe("trackpad wheel handling", () => {
  it("uses horizontal trackpad wheel input for sideways panning", () => {
    expect(
      shouldPanSidewaysFromWheel({
        deltaX: 24,
        deltaY: 3,
        deltaMode: 0,
      }),
    ).toBe(true);
  });

  it("leaves vertical smooth trackpad wheel input for zooming", () => {
    expect(
      shouldPanSidewaysFromWheel({
        deltaX: 0,
        deltaY: 32,
        deltaMode: 0,
      }),
    ).toBe(false);
  });

  it("treats fractional pixel wheel input as trackpad-like", () => {
    expect(
      isTrackpadLikeWheel({
        deltaX: 0,
        deltaY: 84.5,
        deltaMode: 0,
      }),
    ).toBe(true);
  });

  it("leaves coarse mouse wheel input for zooming", () => {
    expect(
      shouldPanSidewaysFromWheel({
        deltaX: 0,
        deltaY: 120,
        deltaMode: 0,
      }),
    ).toBe(false);
  });

  it("leaves trackpad pinch gestures for zooming", () => {
    expect(
      shouldPanSidewaysFromWheel({
        deltaX: 30,
        deltaY: 0,
        deltaMode: 0,
        ctrlKey: true,
      }),
    ).toBe(false);
  });

  it("leaves line-mode mouse wheel input for zooming", () => {
    expect(
      shouldPanSidewaysFromWheel({
        deltaX: 0,
        deltaY: 3,
        deltaMode: 1,
      }),
    ).toBe(false);
  });

  it("normalizes line-mode wheel deltas to pixels", () => {
    expect(
      normalizeWheelDeltaPixels({
        deltaX: 2,
        deltaY: -3,
        deltaMode: 1,
      }),
    ).toEqual({
      deltaX: 32,
      deltaY: -48,
    });
  });
});
