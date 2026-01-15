/**
 * Deck import/export for Curiosa.io compatibility
 *
 * Export format: "quantity name" per line (e.g., "4 Cave Trolls")
 * Import: Parse text, match card names, highlight unknown cards
 */

import type { Card, Deck, DeckCard, DeckBoards } from './dataModels';
import { createEmptyDeck } from './dataModels';
import { generateUUID } from '@/utils/uuid';

// ============================================================================
// Export
// ============================================================================

/**
 * Export a deck to text format
 */
export function exportDeckToText(deck: Deck): string {
  const lines: string[] = [];

  // Export each board with headers
  const boards: Array<[keyof DeckBoards, string]> = [
    ['avatar', '// Avatar'],
    ['mainboard', '// Mainboard'],
    ['sideboard', '// Sideboard'],
    ['maybeboard', '// Maybeboard'],
  ];

  for (const [boardKey, header] of boards) {
    const board = deck.boards[boardKey];
    if (board.length === 0) continue;

    lines.push(header);
    for (const card of board) {
      lines.push(`${card.quantity} ${card.name}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Export only mainboard (simple format for sharing)
 */
export function exportMainboardToText(deck: Deck): string {
  return deck.boards.mainboard.map((c) => `${c.quantity} ${c.name}`).join('\n');
}

// ============================================================================
// Import
// ============================================================================

export interface ImportResult {
  deck: Deck;
  unknownCards: string[];
  warnings: string[];
}

/**
 * Import deck from text
 * @param text - Text in "quantity name" format
 * @param deckName - Name for the new deck
 * @param cardDatabase - Card database for validation
 */
export function importDeckFromText(
  text: string,
  deckName: string,
  cardDatabase: Card[]
): ImportResult {
  const cardNames = new Set(cardDatabase.map((c) => c.name.toLowerCase()));
  const cardLookup = new Map(cardDatabase.map((c) => [c.name.toLowerCase(), c]));

  const deck = createEmptyDeck(deckName, generateUUID());
  const unknownCards: string[] = [];
  const warnings: string[] = [];

  let currentBoard: keyof DeckBoards = 'mainboard';

  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines
    if (!line) continue;

    // Check for board headers
    if (line.startsWith('//') || line.startsWith('#')) {
      const header = line.toLowerCase();
      if (header.includes('avatar')) {
        currentBoard = 'avatar';
      } else if (header.includes('sideboard')) {
        currentBoard = 'sideboard';
      } else if (header.includes('maybeboard')) {
        currentBoard = 'maybeboard';
      } else if (header.includes('mainboard') || header.includes('main')) {
        currentBoard = 'mainboard';
      }
      continue;
    }

    // Parse "quantity name" format
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) {
      // Try "name x quantity" format
      const altMatch = line.match(/^(.+)\s+x\s*(\d+)$/i);
      if (altMatch) {
        const [, name, qty] = altMatch;
        processCard(name!.trim(), parseInt(qty!, 10));
      } else {
        // Assume it's just a card name with quantity 1
        processCard(line, 1);
      }
      continue;
    }

    const [, qtyStr, name] = match;
    const quantity = parseInt(qtyStr!, 10);
    processCard(name!.trim(), quantity);
  }

  function processCard(name: string, quantity: number) {
    if (quantity <= 0) {
      warnings.push(`Invalid quantity for ${name}`);
      return;
    }

    // Look up card in database
    const normalizedName = name.toLowerCase();
    if (!cardNames.has(normalizedName)) {
      unknownCards.push(name);
      return;
    }

    const card = cardLookup.get(normalizedName)!;

    // Determine board based on card type if not specified
    let targetBoard = currentBoard;
    if (currentBoard === 'mainboard' && card.guardian.type === 'Avatar') {
      targetBoard = 'avatar';
    }

    // Add to deck
    const existingCard = deck.boards[targetBoard].find(
      (c) => c.name.toLowerCase() === normalizedName
    );

    if (existingCard) {
      existingCard.quantity += quantity;
    } else {
      deck.boards[targetBoard].push({
        name: card.name, // Use canonical name from database
        quantity,
      });
    }
  }

  return { deck, unknownCards, warnings };
}

// ============================================================================
// Curiosa.io Integration
// ============================================================================

/**
 * Parse deck from Curiosa.io API response
 * NOTE: Full Curiosa integration is excluded from MVP
 */
export interface CuriosaDeckData {
  name: string;
  author: string;
  mainboard: DeckCard[];
  avatar: DeckCard[];
  sideboard: DeckCard[];
  maybeboard: DeckCard[];
}

export function importFromCuriosaDeck(
  data: CuriosaDeckData,
  cardDatabase: Card[]
): ImportResult {
  const deck = createEmptyDeck(data.name, generateUUID());
  deck.author = data.author;

  const unknownCards: string[] = [];
  const warnings: string[] = [];

  const cardNames = new Set(cardDatabase.map((c) => c.name.toLowerCase()));
  const cardLookup = new Map(cardDatabase.map((c) => [c.name.toLowerCase(), c]));

  function validateAndAdd(cards: DeckCard[], board: keyof DeckBoards) {
    for (const card of cards) {
      const normalizedName = card.name.toLowerCase();
      if (!cardNames.has(normalizedName)) {
        unknownCards.push(card.name);
        continue;
      }

      const dbCard = cardLookup.get(normalizedName)!;
      deck.boards[board].push({
        name: dbCard.name,
        quantity: card.quantity,
      });
    }
  }

  validateAndAdd(data.mainboard, 'mainboard');
  validateAndAdd(data.avatar, 'avatar');
  validateAndAdd(data.sideboard, 'sideboard');
  validateAndAdd(data.maybeboard, 'maybeboard');

  return { deck, unknownCards, warnings };
}
