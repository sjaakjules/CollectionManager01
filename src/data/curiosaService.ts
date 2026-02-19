/**
 * Curiosa.io deck fetching service
 *
 * Fetches deck data from curiosa.io's tRPC API.
 * In development, requests are proxied through Vite to avoid CORS issues.
 */

import type { Deck, DeckCard } from './dataModels';
import { generateUUID } from '@/utils/uuid';

const BASE_URL = '/api/curiosa';

/**
 * Extract deck ID from a curiosa.io URL or raw ID
 * Handles: "https://curiosa.io/decks/abc123", "curiosa.io/decks/abc123", "abc123"
 */
export function extractDeckId(urlOrId: string): string {
  const trimmed = urlOrId.trim().replace(/\/+$/, '');
  if (trimmed.includes('/')) {
    return trimmed.split('/').pop() ?? trimmed;
  }
  return trimmed;
}

/**
 * Fetch a deck from curiosa.io by URL or deck ID
 */
export async function fetchCuriosaDeck(urlOrId: string): Promise<Deck> {
  const deckId = extractDeckId(urlOrId);
  if (!deckId) {
    throw new Error('Invalid deck URL or ID');
  }

  // Fetch deck name from the web page
  const deckName = await fetchDeckName(deckId);

  // Fetch deck card data from tRPC API
  const boards = await fetchDeckBoards(deckId);

  const now = new Date().toISOString();
  return {
    id: generateUUID(),
    name: deckName,
    boards,
    createdAt: now,
    updatedAt: now,
  };
}

async function fetchDeckName(deckId: string): Promise<string> {
  try {
    const response = await fetch(`${BASE_URL}/decks/${deckId}`);
    if (!response.ok) {
      return 'Imported Deck';
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.title?.trim();

    if (title) {
      // Title format: "DeckName | Author" — take just the deck name
      const parts = title.split('|');
      return parts[0]?.trim() || 'Imported Deck';
    }
  } catch {
    // Fall through to default
  }

  return 'Imported Deck';
}

async function fetchDeckBoards(deckId: string): Promise<Deck['boards']> {
  const query: Record<string, { json: { id: string } }> = {};
  for (let i = 0; i < 4; i++) {
    query[String(i)] = { json: { id: deckId } };
  }

  const procedures = [
    'deck.getDecklistById',
    'deck.getAvatarById',
    'deck.getSideboardById',
    'deck.getMaybeboardById',
  ].join(',');

  const input = encodeURIComponent(JSON.stringify(query));
  const url = `${BASE_URL}/api/trpc/${procedures}?batch=1&input=${input}`;

  const response = await fetch(url, {
    headers: {
      'Referer': `https://curiosa.io/decks/${deckId}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch deck: ${response.status}`);
  }

  const results = await response.json();

  if (!Array.isArray(results) || results.length !== 4) {
    throw new Error('Unexpected response format from curiosa.io');
  }

  return {
    mainboard: parseBoardData(results[0]),
    avatar: parseBoardData(results[1]),
    sideboard: parseBoardData(results[2]),
    maybeboard: parseBoardData(results[3]),
  };
}

/**
 * Parse a tRPC board result into DeckCard array.
 * Expected structure: { result: { data: { json: [...] } } }
 * Each card entry may have { name, quantity } or similar fields.
 */
function parseBoardData(result: unknown): DeckCard[] {
  try {
    const data = (result as { result: { data: { json: unknown[] } } })
      ?.result?.data?.json;

    if (!Array.isArray(data)) return [];

    const cards: DeckCard[] = [];

    for (const entry of data) {
      if (!entry || typeof entry !== 'object') continue;

      const record = entry as Record<string, unknown>;

      // Card name is nested inside record.card.name
      const cardObj = record.card as Record<string, unknown> | undefined;
      const name = (cardObj?.name ?? record.name) as string | undefined;
      if (!name || typeof name !== 'string') continue;

      // Try common field names for quantity
      const qty = (record.quantity ?? record.count ?? record.qty ?? 1) as number;

      cards.push({ name, quantity: Number(qty) || 1 });
    }

    return cards;
  } catch {
    return [];
  }
}
