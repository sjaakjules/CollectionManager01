/**
 * User-facing rule violation messages
 *
 * Centralizes all validation message strings for consistency.
 *
 * Related files:
 * - `src/rules/deckRules.ts` (message consumers)
 * - `src/data/dataModels.ts` (deck limit constants)
 */

import { DECK_LIMITS } from '@/data/dataModels';

export type RuleViolationType =
  | 'TOO_MANY_AVATARS'
  | 'TOO_MANY_SPELLS'
  | 'TOO_MANY_SITES'
  | 'TOO_MANY_SIDEBOARD'
  | 'RARITY_LIMIT_EXCEEDED'
  | 'COLLECTION_EXCEEDED';

interface MessageParams {
  count?: number;
  cardName?: string;
  rarity?: string;
  limit?: number;
  available?: number;
}

const MESSAGE_TEMPLATES: Record<RuleViolationType, (params: MessageParams) => string> = {
  TOO_MANY_AVATARS: (p) =>
    `Too many avatars: ${p.count} (limit ${DECK_LIMITS.AVATAR_COUNT})`,

  TOO_MANY_SPELLS: (p) =>
    `Too many spells: ${p.count} (limit ${DECK_LIMITS.SPELL_COUNT})`,

  TOO_MANY_SITES: (p) =>
    `Too many sites: ${p.count} (limit ${DECK_LIMITS.SITE_COUNT})`,

  TOO_MANY_SIDEBOARD: (p) =>
    `Too many sideboard cards: ${p.count} (limit ${DECK_LIMITS.SIDEBOARD_COUNT})`,

  RARITY_LIMIT_EXCEEDED: (p) =>
    `${p.cardName}: ${p.count} copies exceeds ${p.rarity} limit of ${p.limit}`,

  COLLECTION_EXCEEDED: (p) =>
    `${p.cardName}: Need ${p.count}, only ${p.available} in collection`,
};

/**
 * Resolve display text for a rule-violation code.
 *
 * Inputs:
 * - `type`: Rule violation identifier.
 * - `params`: Optional interpolation values for the chosen template.
 *
 * Outputs:
 * - Returns human-readable message string.
 */
export function getRuleMessage(type: RuleViolationType, params: MessageParams): string {
  const template = MESSAGE_TEMPLATES[type];
  return template(params);
}

/**
 * Build quick-reference deck-limit lines for UI display.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - Returns an ordered array of limit description strings.
 */
export function getDeckLimitsDescription(): string[] {
  return [
    `Avatar: ${DECK_LIMITS.AVATAR_COUNT}`,
    `Spells: ${DECK_LIMITS.SPELL_COUNT} max`,
    `Sites: ${DECK_LIMITS.SITE_COUNT} max`,
    `Sideboard: ${DECK_LIMITS.SIDEBOARD_COUNT}`,
    `Ordinary: 4x | Exceptional: 3x | Elite: 2x | Unique: 1x`,
  ];
}
