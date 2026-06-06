export const TOUCH_TAP_SLOP_PX = 12;
export const TOUCH_LONG_PRESS_MS = 400;
export const TOUCH_DOUBLE_TAP_MS = 300;
export const SYNTHETIC_MOUSE_AFTER_TOUCH_MS = 800;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface TouchGesturePoint {
  pointerId: number;
  x: number;
  y: number;
  timeMs: number;
}

export interface TouchGestureTarget {
  key: string;
}

export interface TouchGestureSnapshot<TTarget extends TouchGestureTarget> {
  pointerId: number;
  target: TTarget;
  start: TouchGesturePoint;
  current: TouchGesturePoint;
}

export type TouchGestureMove<TTarget extends TouchGestureTarget> =
  | { type: "none" }
  | { type: "pan-start" }
  | { type: "drag-start"; gesture: TouchGestureSnapshot<TTarget> }
  | { type: "drag-move"; gesture: TouchGestureSnapshot<TTarget> };

export type TouchGestureRelease<TTarget extends TouchGestureTarget> =
  | { type: "none" }
  | {
      type: "tap";
      target: TTarget;
      position: TouchGesturePoint;
      isDoubleTap: boolean;
    }
  | {
      type: "action";
      target: TTarget;
      position: TouchGesturePoint;
    }
  | {
      type: "drag-end";
      target: TTarget;
      position: TouchGesturePoint;
    };

interface LastTap {
  key: string;
  timeMs: number;
}

type TouchPhase = "idle" | "pending" | "panning" | "long-pressed" | "dragging" | "multi-touch";

export interface TouchGestureOptions {
  tapSlopPx: number;
  longPressMs: number;
  doubleTapMs: number;
}

export interface TouchPointerEventLike {
  pointerType?: string;
  type?: string;
  nativeEvent?: unknown;
}

const DEFAULT_OPTIONS: TouchGestureOptions = {
  tapSlopPx: TOUCH_TAP_SLOP_PX,
  longPressMs: TOUCH_LONG_PRESS_MS,
  doubleTapMs: TOUCH_DOUBLE_TAP_MS,
};

function distance(a: TouchGesturePoint, b: TouchGesturePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const property = value[key];
  return typeof property === "string" ? property : null;
}

function hasTouchList(value: unknown, key: "touches" | "changedTouches"): boolean {
  if (!isRecord(value)) return false;
  const property = value[key];
  return typeof property === "object" && property !== null && "length" in property;
}

function isNativeTouchEventLike(value: unknown): boolean {
  const type = getStringProperty(value, "type");
  return (
    type?.startsWith("touch") === true ||
    hasTouchList(value, "touches") ||
    hasTouchList(value, "changedTouches")
  );
}

export function isTouchLikePointerEvent(event: TouchPointerEventLike): boolean {
  if (event.pointerType === "touch") return true;

  const nativePointerType = getStringProperty(event.nativeEvent, "pointerType");
  if (nativePointerType === "touch") return true;

  return isNativeTouchEventLike(event) || isNativeTouchEventLike(event.nativeEvent);
}

export function isMouseLikePointerEvent(event: TouchPointerEventLike): boolean {
  if (event.pointerType === "mouse") return true;
  return getStringProperty(event.nativeEvent, "pointerType") === "mouse";
}

export function isSyntheticMouseAfterTouch(
  event: TouchPointerEventLike,
  lastTouchTimeMs: number,
  nowMs: number,
  windowMs = SYNTHETIC_MOUSE_AFTER_TOUCH_MS,
): boolean {
  return (
    isMouseLikePointerEvent(event) &&
    lastTouchTimeMs > 0 &&
    nowMs - lastTouchTimeMs <= windowMs
  );
}

export class TouchGestureTracker<TTarget extends TouchGestureTarget> {
  private readonly options: TouchGestureOptions;
  private activePointers = new Set<number>();
  private phase: TouchPhase = "idle";
  private target: TTarget | null = null;
  private startPoint: TouchGesturePoint | null = null;
  private currentPoint: TouchGesturePoint | null = null;
  private longPressTimer: TimerHandle | null = null;
  private lastTap: LastTap | null = null;
  private onLongPressStart: ((gesture: TouchGestureSnapshot<TTarget>) => void) | null = null;

  constructor(options: Partial<TouchGestureOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  start(
    point: TouchGesturePoint,
    target: TTarget,
    onLongPressStart?: (gesture: TouchGestureSnapshot<TTarget>) => void,
  ): void {
    this.activePointers.add(point.pointerId);

    if (this.activePointers.size > 1) {
      this.cancelCurrentGesture("multi-touch");
      return;
    }

    this.clearLongPressTimer();
    this.phase = "pending";
    this.target = target;
    this.startPoint = { ...point };
    this.currentPoint = { ...point };
    this.onLongPressStart = onLongPressStart ?? null;
    this.longPressTimer = setTimeout(() => this.fireLongPress(), this.options.longPressMs);
  }

  move(point: TouchGesturePoint): TouchGestureMove<TTarget> {
    if (this.phase === "idle" || this.phase === "multi-touch") return { type: "none" };
    if (!this.isPrimaryPointer(point.pointerId) || !this.startPoint || !this.target) {
      return { type: "none" };
    }

    this.currentPoint = { ...point };
    const movedBeyondTap = distance(this.startPoint, point) > this.options.tapSlopPx;

    if (this.phase === "pending" && movedBeyondTap) {
      this.clearLongPressTimer();
      this.phase = "panning";
      this.target = null;
      this.startPoint = null;
      this.currentPoint = null;
      this.onLongPressStart = null;
      return { type: "pan-start" };
    }

    if (this.phase === "long-pressed" && movedBeyondTap) {
      this.phase = "dragging";
      return { type: "drag-start", gesture: this.snapshot(point) };
    }

    if (this.phase === "dragging") {
      return { type: "drag-move", gesture: this.snapshot(point) };
    }

    return { type: "none" };
  }

  release(point: TouchGesturePoint): TouchGestureRelease<TTarget> {
    this.activePointers.delete(point.pointerId);

    if (!this.isPrimaryPointer(point.pointerId) || !this.target) {
      if (this.activePointers.size === 0) this.resetGesture();
      return { type: "none" };
    }

    const target = this.target;
    const phase = this.phase;
    this.clearLongPressTimer();
    this.resetGesture();

    if (phase === "pending") {
      const isDoubleTap =
        this.lastTap?.key === target.key &&
        point.timeMs - this.lastTap.timeMs <= this.options.doubleTapMs;
      this.lastTap = isDoubleTap ? null : { key: target.key, timeMs: point.timeMs };
      return { type: "tap", target, position: { ...point }, isDoubleTap };
    }

    if (phase === "long-pressed") {
      this.lastTap = null;
      return { type: "action", target, position: { ...point } };
    }

    if (phase === "dragging") {
      this.lastTap = null;
      return { type: "drag-end", target, position: { ...point } };
    }

    return { type: "none" };
  }

  cancel(): void {
    this.activePointers.clear();
    this.resetGesture();
  }

  isTrackingPointer(pointerId: number): boolean {
    return this.isPrimaryPointer(pointerId) || this.activePointers.has(pointerId);
  }

  isLongPressed(): boolean {
    return this.phase === "long-pressed" || this.phase === "dragging";
  }

  private fireLongPress(): void {
    if (
      this.phase !== "pending" ||
      !this.target ||
      !this.startPoint ||
      !this.currentPoint
    ) {
      return;
    }

    this.phase = "long-pressed";
    this.longPressTimer = null;
    this.onLongPressStart?.(this.snapshot(this.currentPoint));
  }

  private snapshot(point: TouchGesturePoint): TouchGestureSnapshot<TTarget> {
    if (!this.target || !this.startPoint) {
      throw new Error("Cannot snapshot an inactive touch gesture");
    }

    return {
      pointerId: point.pointerId,
      target: this.target,
      start: { ...this.startPoint },
      current: { ...point },
    };
  }

  private isPrimaryPointer(pointerId: number): boolean {
    return this.startPoint?.pointerId === pointerId;
  }

  private cancelCurrentGesture(nextPhase: TouchPhase): void {
    this.clearLongPressTimer();
    this.phase = nextPhase;
    this.target = null;
    this.startPoint = null;
    this.currentPoint = null;
    this.onLongPressStart = null;
  }

  private resetGesture(): void {
    this.clearLongPressTimer();
    this.phase = this.activePointers.size > 0 ? "multi-touch" : "idle";
    this.target = null;
    this.startPoint = null;
    this.currentPoint = null;
    this.onLongPressStart = null;
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer === null) return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }
}
