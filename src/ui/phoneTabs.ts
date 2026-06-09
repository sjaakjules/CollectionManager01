export type PhoneTabId = "stacks" | "decks" | "filter";

export function togglePhoneTab(
  current: PhoneTabId | null,
  requested: PhoneTabId,
): PhoneTabId | null {
  return current === requested ? null : requested;
}
