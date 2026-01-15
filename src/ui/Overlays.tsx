/**
 * Overlay utilities for card quantity display
 *
 * This file provides React components for overlay rendering.
 * The actual overlay on cards is handled in CardSprite.ts using PixiJS.
 * This module provides helper functions for overlay styling and logic.
 */

import type { CollectionItem, Deck } from '@/data/dataModels';

export interface OverlayInfo {
  quantity: number;
  color: 'white' | 'black' | 'red';
}

/**
 * Calculate overlay info for a card in the active deck
 */
export function calculateOverlayInfo(
  cardName: string,
  deck: Deck | null,
  collection: CollectionItem[],
  loadedDecks: Deck[] = []
): OverlayInfo {
  if (!deck) {
    return { quantity: 0, color: 'white' };
  }

  // Calculate quantity in deck (mainboard + sideboard, not maybeboard)
  let deckQuantity = 0;
  for (const board of ['mainboard', 'sideboard', 'avatar'] as const) {
    const card = deck.boards[board].find((c) => c.name === cardName);
    if (card) {
      deckQuantity += card.quantity;
    }
  }

  // If no collection loaded, show white quantity
  if (collection.length === 0) {
    return { quantity: deckQuantity, color: 'white' };
  }

  // Calculate total needed across all loaded decks
  let totalNeeded = deckQuantity;
  for (const otherDeck of loadedDecks) {
    if (otherDeck.id === deck.id) continue;
    for (const board of ['mainboard', 'sideboard', 'avatar'] as const) {
      const card = otherDeck.boards[board].find((c) => c.name === cardName);
      if (card) {
        totalNeeded += card.quantity;
      }
    }
  }

  // Get collection quantity
  const collectionItem = collection.find((c) => c.name === cardName);
  const collectionQuantity = collectionItem?.quantity ?? 0;

  // Determine color based on availability
  let color: OverlayInfo['color'] = 'white';
  if (totalNeeded > collectionQuantity) {
    color = 'red';
  } else if (collectionQuantity === 0) {
    color = 'black';
  }

  return { quantity: deckQuantity, color };
}

/**
 * Format quantity for display
 */
export function formatQuantity(quantity: number): string {
  if (quantity <= 0) return '';
  return quantity.toString();
}
