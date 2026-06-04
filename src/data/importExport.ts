/**
 * Deck import/export for Curiosa.io compatibility
 *
 * Export format: "quantity name" per line (e.g., "4 Cave Trolls")
 * Import: Parse text, match card names, highlight unknown cards
 *
 * Related files:
 * - `src/ui/BottomPanel.tsx` (import/export UI actions)
 * - `src/data/dataModels.ts` (deck/card structures)
 * - `src/data/curiosaService.ts` (Curiosa deck ingestion)
 */

import type { Card, Deck, DeckCard, DeckBoards } from './dataModels';
import { createEmptyDeck } from './dataModels';
import { generateUUID } from '@/utils/uuid';

// ============================================================================
// Export
// ============================================================================

/**
 * Export all deck boards into Curiosa-style plain text.
 *
 * Inputs:
 * - `deck`: Deck to serialize.
 *
 * Outputs:
 * - Returns newline-delimited text with optional board headers.
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
 * Export only mainboard cards as plain `quantity name` lines.
 *
 * Inputs:
 * - `deck`: Deck containing mainboard cards.
 *
 * Outputs:
 * - Returns mainboard-only text payload.
 */
export function exportMainboardToText(deck: Deck): string {
  return deck.boards.mainboard.map((c) => `${c.quantity} ${c.name}`).join('\n');
}

/**
 * Export selected cards to "quantity name" lines.
 *
 * Inputs:
 * - `cards`: Card names and quantities chosen by the user.
 *
 * Outputs:
 * - Returns newline-delimited text payload.
 */
export function exportSelectedToText(
  cards: Array<{ name: string; quantity: number }>,
): string {
  return cards.map((c) => `${c.quantity} ${c.name}`).join('\n');
}

/**
 * Download plain text content as a local file.
 *
 * Inputs:
 * - `filename`: Browser download filename.
 * - `text`: Plain-text file contents.
 *
 * Outputs:
 * - Triggers a browser file download; returns `void`.
 */
export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
 * Parse plain-text deck content into internal deck structure.
 *
 * Inputs:
 * - `text`: Deck text in `quantity name` or compatible line variants.
 * - `deckName`: Name assigned to the imported deck.
 * - `cardDatabase`: Known cards for canonical matching/validation.
 *
 * Outputs:
 * - Returns `{ deck, unknownCards, warnings }` with parsing diagnostics.
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
        if (name && qty) {
          processCard(name.trim(), parseInt(qty, 10));
        }
      } else {
        // Assume it's just a card name with quantity 1
        processCard(line, 1);
      }
      continue;
    }

    const [, qtyStr, name] = match;
    if (!qtyStr || !name) continue;
    const quantity = parseInt(qtyStr, 10);
    processCard(name.trim(), quantity);
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

    const card = cardLookup.get(normalizedName);
    if (!card) {
      unknownCards.push(name);
      return;
    }

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

/**
 * Convert Curiosa deck payload into internal `ImportResult`.
 *
 * Inputs:
 * - `data`: Curiosa board payload.
 * - `cardDatabase`: Known cards for canonical name matching.
 *
 * Outputs:
 * - Returns `{ deck, unknownCards, warnings }` ready for reducer insertion.
 */
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

      const dbCard = cardLookup.get(normalizedName);
      if (!dbCard) {
        unknownCards.push(card.name);
        continue;
      }
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
