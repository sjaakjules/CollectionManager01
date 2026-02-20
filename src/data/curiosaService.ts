/**
 * Curiosa.io deck fetching service
 *
 * Fetches deck data from curiosa.io's tRPC API.
 * In development, requests are proxied through Vite to avoid CORS issues.
 * Respects rate limits via x-ratelimit-* response headers.
 */

import type { Deck, DeckCard } from './dataModels';
import { generateUUID } from '@/utils/uuid';

const BASE_URL = '/api/curiosa';

// ============================================================================
// Rate Limiting
// ============================================================================

interface RateLimitState {
  remaining: number | null;
  limit: number | null;
  resetMs: number;
}

const rateLimit: RateLimitState = {
  remaining: null,
  limit: null,
  resetMs: 0,
};

/** Read rate-limit headers from a curiosa.io response and update state */
function updateRateLimit(response: Response): void {
  const limit = response.headers.get('x-ratelimit-limit');
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');

  if (limit) rateLimit.limit = Number(limit);
  if (remaining) rateLimit.remaining = Number(remaining);
  if (reset) rateLimit.resetMs = Number(reset) * 1000;

  if (rateLimit.remaining !== null && rateLimit.limit !== null) {
    console.debug(
      `[curiosa] rate limit: ${rateLimit.remaining}/${rateLimit.limit} remaining`
    );
  }
}

/**
 * Wait if we're close to the rate limit.
 * If remaining is known and low, delay until the reset window.
 */
async function throttleIfNeeded(): Promise<void> {
  if (rateLimit.remaining === null) return;

  if (rateLimit.remaining <= 1) {
    const now = Date.now();
    const waitUntil = rateLimit.resetMs || now + 5000;
    const delay = Math.max(0, waitUntil - now);

    if (delay > 0) {
      console.warn(
        `[curiosa] rate limit nearly exhausted (${rateLimit.remaining} left), waiting ${delay}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** Fetch wrapper that respects curiosa.io rate limits */
async function curiosaFetch(url: string, init?: RequestInit): Promise<Response> {
  await throttleIfNeeded();
  const response = await fetch(url, init);
  updateRateLimit(response);
  return response;
}

// ============================================================================
// Public API
// ============================================================================

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

  // Fetch deck metadata and card data in parallel
  const [meta, boards] = await Promise.all([
    fetchDeckMeta(deckId),
    fetchDeckBoards(deckId),
  ]);

  const now = new Date().toISOString();
  return {
    id: generateUUID(),
    name: meta.name,
    author: meta.author,
    boards,
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Internal Fetchers
// ============================================================================

async function fetchDeckMeta(deckId: string): Promise<{ name: string; author?: string }> {
  try {
    const response = await curiosaFetch(`${BASE_URL}/decks/${deckId}`);
    if (!response.ok) {
      return { name: 'Imported Deck' };
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.title?.trim();

    if (title) {
      // Title format: "DeckName | Author"
      const parts = title.split('|');
      const name = parts[0]?.trim() || 'Imported Deck';
      const author = parts[1]?.trim() || undefined;
      return { name, author };
    }
  } catch {
    // Fall through to default
  }

  return { name: 'Imported Deck' };
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

  const response = await curiosaFetch(url, {
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

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse a tRPC board result into DeckCard array.
 * Expected structure: { result: { data: { json: [...] } } }
 * Avatar endpoint returns a single object instead of an array.
 */
function parseBoardData(result: unknown): DeckCard[] {
  try {
    const raw = (result as { result: { data: { json: unknown } } })
      ?.result?.data?.json;

    // Avatar endpoint returns a single object; other boards return arrays
    const data = Array.isArray(raw) ? raw : raw ? [raw] : [];

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
