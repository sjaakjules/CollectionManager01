/**
 * Deck validation rules
 *
 * Enforces Sorcery TCG deck-building rules:
 * - 1 avatar
 * - 60 spells maximum
 * - 30 sites maximum
 * - 10 sideboard cards
 * - Rarity limits (Ordinary 4x, Exceptional 3x, Elite 2x, Unique 1x)
 */

import type { Card, Deck, CardRarity } from '@/data/dataModels';
import { DECK_LIMITS, isSpellType, isSiteType } from '@/data/dataModels';
import { getRuleMessage, type RuleViolationType } from './ruleMessages';

// ============================================================================
// Types
// ============================================================================

export interface ValidationError {
  type: RuleViolationType;
  cardName?: string;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

// ============================================================================
// Main Validation
// ============================================================================

/**
 * Validate a deck against all rules
 */
export function validateDeck(deck: Deck, cardDatabase: Card[]): ValidationResult {
  const errors: ValidationError[] = [];

  // Create card lookup for rarity checks
  const cardLookup = new Map(cardDatabase.map((c) => [c.name.toLowerCase(), c]));

  // Count cards by type
  let spellCount = 0;
  let siteCount = 0;
  let avatarCount = deck.boards.avatar.reduce((sum, c) => sum + c.quantity, 0);

  // Track quantities per card for rarity limits
  const cardQuantities = new Map<string, number>();

  // Process mainboard
  for (const deckCard of deck.boards.mainboard) {
    const card = cardLookup.get(deckCard.name.toLowerCase());
    if (!card) continue;

    const type = card.guardian.type;
    if (isSpellType(type)) {
      spellCount += deckCard.quantity;
    } else if (isSiteType(type)) {
      siteCount += deckCard.quantity;
    }

    // Track for rarity limits
    const current = cardQuantities.get(deckCard.name.toLowerCase()) ?? 0;
    cardQuantities.set(deckCard.name.toLowerCase(), current + deckCard.quantity);
  }

  // Process sideboard (counts toward rarity limits)
  for (const deckCard of deck.boards.sideboard) {
    const current = cardQuantities.get(deckCard.name.toLowerCase()) ?? 0;
    cardQuantities.set(deckCard.name.toLowerCase(), current + deckCard.quantity);
  }

  // Validate avatar count
  if (avatarCount > DECK_LIMITS.AVATAR_COUNT) {
    errors.push({
      type: 'TOO_MANY_AVATARS',
      message: getRuleMessage('TOO_MANY_AVATARS', { count: avatarCount }),
    });
  }

  // Validate spell count
  if (spellCount > DECK_LIMITS.SPELL_COUNT) {
    errors.push({
      type: 'TOO_MANY_SPELLS',
      message: getRuleMessage('TOO_MANY_SPELLS', { count: spellCount }),
    });
  }

  // Validate site count
  if (siteCount > DECK_LIMITS.SITE_COUNT) {
    errors.push({
      type: 'TOO_MANY_SITES',
      message: getRuleMessage('TOO_MANY_SITES', { count: siteCount }),
    });
  }

  // Validate sideboard count
  const sideboardCount = deck.boards.sideboard.reduce((sum, c) => sum + c.quantity, 0);
  if (sideboardCount > DECK_LIMITS.SIDEBOARD_COUNT) {
    errors.push({
      type: 'TOO_MANY_SIDEBOARD',
      message: getRuleMessage('TOO_MANY_SIDEBOARD', { count: sideboardCount }),
    });
  }

  // Validate rarity limits
  for (const [cardName, quantity] of cardQuantities) {
    const card = cardLookup.get(cardName);
    if (!card) continue;

    const rarity = card.guardian.rarity;
    const limit = DECK_LIMITS.RARITY_LIMITS[rarity];

    if (quantity > limit) {
      errors.push({
        type: 'RARITY_LIMIT_EXCEEDED',
        cardName: card.name,
        message: getRuleMessage('RARITY_LIMIT_EXCEEDED', {
          cardName: card.name,
          rarity,
          limit,
          count: quantity,
        }),
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Check if adding a card would violate rules
 */
export function canAddCard(
  deck: Deck,
  cardName: string,
  cardDatabase: Card[]
): { allowed: boolean; reason?: string } {
  const card = cardDatabase.find((c) => c.name.toLowerCase() === cardName.toLowerCase());
  if (!card) {
    return { allowed: false, reason: 'Card not found' };
  }

  // Count current quantity of this card
  let currentQty = 0;
  for (const board of ['mainboard', 'sideboard', 'avatar'] as const) {
    const existing = deck.boards[board].find(
      (c) => c.name.toLowerCase() === cardName.toLowerCase()
    );
    if (existing) {
      currentQty += existing.quantity;
    }
  }

  // Check rarity limit
  const rarity = card.guardian.rarity;
  const limit = DECK_LIMITS.RARITY_LIMITS[rarity];

  if (currentQty >= limit) {
    return {
      allowed: false,
      reason: `${rarity} cards limited to ${limit} copies`,
    };
  }

  return { allowed: true };
}

/**
 * Get rarity limit for a card
 */
export function getRarityLimit(rarity: CardRarity): number {
  return DECK_LIMITS.RARITY_LIMITS[rarity];
}
