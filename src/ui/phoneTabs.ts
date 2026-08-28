export type PhoneTabId = "stacks" | "decks" | "filter";

export const PHONE_SIDE_SWIPE_EDGE_PX = 32;
export const PHONE_SIDE_SWIPE_THRESHOLD_PX = 48;
export const PHONE_SIDE_PANEL_CLOSE_HIT_PX = 420;

export function togglePhoneTab(
  current: PhoneTabId | null,
  requested: PhoneTabId,
): PhoneTabId | null {
  return current === requested ? null : requested;
}

export function getPhoneSideSwipeTarget({
  current,
  startX,
  startY,
  endX,
  endY,
  viewportWidth,
}: {
  current: PhoneTabId | null;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  viewportWidth: number;
}): PhoneTabId | null | undefined {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  if (horizontalDistance < PHONE_SIDE_SWIPE_THRESHOLD_PX) return undefined;
  if (horizontalDistance < verticalDistance * 1.25) return undefined;

  if (startX <= PHONE_SIDE_SWIPE_EDGE_PX && deltaX > 0) return "stacks";
  if (startX >= viewportWidth - PHONE_SIDE_SWIPE_EDGE_PX && deltaX < 0) {
    return "decks";
  }

  const closeHitWidth = Math.min(
    PHONE_SIDE_PANEL_CLOSE_HIT_PX,
    Math.max(PHONE_SIDE_SWIPE_EDGE_PX, viewportWidth - 48),
  );
  if (current === "stacks" && startX <= closeHitWidth && deltaX < 0) return null;
  if (
    current === "decks" &&
    startX >= viewportWidth - closeHitWidth &&
    deltaX > 0
  ) {
    return null;
  }

  return undefined;
}
