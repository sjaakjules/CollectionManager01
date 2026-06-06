import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_MOUSE_AFTER_TOUCH_MS,
  TOUCH_DOUBLE_TAP_MS,
  TOUCH_LONG_PRESS_MS,
  TOUCH_TAP_SLOP_PX,
  TouchGestureTracker,
  isSyntheticMouseAfterTouch,
  isTouchLikePointerEvent,
  type TouchGesturePoint,
  type TouchGestureTarget,
} from "./touchGestures";

interface TestTarget extends TouchGestureTarget {
  label: string;
}

const cardTarget: TestTarget = { key: "card:atlas-wanderers", label: "Atlas Wanderers" };

function point(
  overrides: Partial<TouchGesturePoint> = {},
): TouchGesturePoint {
  return {
    pointerId: 1,
    x: 100,
    y: 100,
    timeMs: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TouchGestureTracker", () => {
  it("classifies a stable touch as a tap", () => {
    const tracker = new TouchGestureTracker<TestTarget>();
    tracker.start(point(), cardTarget);

    const release = tracker.release(point({ timeMs: 80 }));

    expect(release).toMatchObject({
      type: "tap",
      target: cardTarget,
      isDoubleTap: false,
    });
  });

  it("detects a double tap on the same target", () => {
    const tracker = new TouchGestureTracker<TestTarget>();
    tracker.start(point({ timeMs: 10 }), cardTarget);
    tracker.release(point({ timeMs: 60 }));

    tracker.start(point({ timeMs: 60 }), cardTarget);
    const release = tracker.release(point({ timeMs: 60 + TOUCH_DOUBLE_TAP_MS - 1 }));

    expect(release).toMatchObject({
      type: "tap",
      target: cardTarget,
      isDoubleTap: true,
    });
  });

  it("cancels pending tap and hold when movement becomes a pan", () => {
    vi.useFakeTimers();
    const tracker = new TouchGestureTracker<TestTarget>();
    const onLongPressStart = vi.fn();
    tracker.start(point(), cardTarget, onLongPressStart);

    const move = tracker.move(point({ x: 100 + TOUCH_TAP_SLOP_PX + 1, timeMs: 40 }));
    vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS);
    const release = tracker.release(point({ x: 100 + TOUCH_TAP_SLOP_PX + 20, timeMs: 500 }));

    expect(move).toEqual({ type: "pan-start" });
    expect(onLongPressStart).not.toHaveBeenCalled();
    expect(release).toEqual({ type: "none" });
  });

  it("opens actions after a long press released without dragging", () => {
    vi.useFakeTimers();
    const tracker = new TouchGestureTracker<TestTarget>();
    const onLongPressStart = vi.fn();
    tracker.start(point(), cardTarget, onLongPressStart);

    vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS);
    const release = tracker.release(point({ timeMs: TOUCH_LONG_PRESS_MS + 20 }));

    expect(onLongPressStart).toHaveBeenCalledTimes(1);
    expect(release).toMatchObject({
      type: "action",
      target: cardTarget,
    });
  });

  it("starts and ends a drag after long press movement", () => {
    vi.useFakeTimers();
    const tracker = new TouchGestureTracker<TestTarget>();
    tracker.start(point(), cardTarget);
    vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS);

    const move = tracker.move(point({ x: 100 + TOUCH_TAP_SLOP_PX + 4, timeMs: 440 }));
    const release = tracker.release(point({ x: 150, y: 130, timeMs: 520 }));

    expect(move).toMatchObject({
      type: "drag-start",
      gesture: {
        target: cardTarget,
        start: point(),
      },
    });
    expect(release).toMatchObject({
      type: "drag-end",
      target: cardTarget,
    });
  });

  it("cleans up pending work on pointer cancellation", () => {
    vi.useFakeTimers();
    const tracker = new TouchGestureTracker<TestTarget>();
    const onLongPressStart = vi.fn();
    tracker.start(point(), cardTarget, onLongPressStart);

    tracker.cancel();
    vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS);
    const release = tracker.release(point({ timeMs: 500 }));

    expect(onLongPressStart).not.toHaveBeenCalled();
    expect(release).toEqual({ type: "none" });
  });

  it("cancels the primary gesture when a second touch starts", () => {
    vi.useFakeTimers();
    const tracker = new TouchGestureTracker<TestTarget>();
    const onLongPressStart = vi.fn();
    tracker.start(point(), cardTarget, onLongPressStart);

    tracker.start(point({ pointerId: 2, x: 140, y: 140, timeMs: 80 }), {
      key: "empty",
      label: "empty",
    });
    vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS);
    const release = tracker.release(point({ timeMs: 600 }));

    expect(onLongPressStart).not.toHaveBeenCalled();
    expect(release).toEqual({ type: "none" });
  });

  it("recognizes native touch events when pointerType is unavailable", () => {
    expect(
      isTouchLikePointerEvent({
        nativeEvent: {
          type: "touchmove",
          changedTouches: { length: 2 },
        },
      }),
    ).toBe(true);
  });

  it("recognizes native pointer touch events", () => {
    expect(
      isTouchLikePointerEvent({
        pointerType: "",
        nativeEvent: { pointerType: "touch" },
      }),
    ).toBe(true);
  });

  it("suppresses compatibility mouse events shortly after touch", () => {
    expect(
      isSyntheticMouseAfterTouch(
        { pointerType: "mouse" },
        1_000,
        1_000 + SYNTHETIC_MOUSE_AFTER_TOUCH_MS - 1,
      ),
    ).toBe(true);
    expect(
      isSyntheticMouseAfterTouch(
        { pointerType: "mouse" },
        1_000,
        1_000 + SYNTHETIC_MOUSE_AFTER_TOUCH_MS + 1,
      ),
    ).toBe(false);
  });
});
