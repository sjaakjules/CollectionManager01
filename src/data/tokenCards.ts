const BLOCKED_TOKEN_NAMES = new Set(["frog", "skeleton"]);

export function isBlockedTokenCardName(cardName: string): boolean {
  const normalized = cardName.trim().toLowerCase();
  if (!normalized) return false;
  if (BLOCKED_TOKEN_NAMES.has(normalized)) return true;
  return /^frog\s*\(/u.test(normalized) || /^foot soldiers?(?:\b|\s*\()/u.test(normalized);
}

export function filterBlockedTokenCardNames(cardNames: string[]): string[] {
  return cardNames.filter((cardName) => !isBlockedTokenCardName(cardName));
}
