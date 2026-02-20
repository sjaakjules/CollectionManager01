/**
 * Curiosa.io deck fetching service
 *
 * Fetches deck data from curiosa.io by making two proxied requests:
 *   1. HTML page fetch to parse the deck name + author from <title>
 *   2. tRPC batch request to fetch all board data (mainboard, avatar, sideboard, maybeboard)
 *
 * Both requests go through same-origin proxy paths to avoid CORS:
 * - DEV: Vite proxies `/api/curiosa/*` → `https://curiosa.io/*` (see vite.config.ts)
 * - PROD: Netlify proxies via `public/_redirects`
 *
 * Respects rate limits via x-ratelimit-* response headers.
 */

import type { Deck, DeckCard } from "./dataModels";
import { generateUUID } from "@/utils/uuid";

// Proxy prefix — stripped by both Vite (dev) and Netlify _redirects (prod)
const PROXY_PREFIX = "/api/curiosa";

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
  const limit = response.headers.get("x-ratelimit-limit");
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");

  if (limit) rateLimit.limit = Number(limit);
  if (remaining) rateLimit.remaining = Number(remaining);
  if (reset) rateLimit.resetMs = Number(reset) * 1000;

  if (rateLimit.remaining !== null && rateLimit.limit !== null) {
    console.debug(
      `[curiosa] rate limit: ${rateLimit.remaining}/${rateLimit.limit} remaining`,
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
        `[curiosa] rate limit nearly exhausted (${rateLimit.remaining} left), waiting ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** Fetch wrapper that respects curiosa.io rate limits */
async function curiosaFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  await throttleIfNeeded();
  const response = await fetch(url, init);
  updateRateLimit(response);
  return response;
}

// ============================================================================
// tRPC response parsing
// ============================================================================

/** Parse a single board from a tRPC batch result entry */
function parseBoardData(result: unknown): DeckCard[] {
  try {
    const raw = (result as { result: { data: { json: unknown } } })?.result
      ?.data?.json;

    const data = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const cards: DeckCard[] = [];

    for (const entry of data) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;

      const cardObj = record.card as Record<string, unknown> | undefined;
      const name = (cardObj?.name ?? record.name) as string | undefined;
      if (!name || typeof name !== "string") continue;

      const qty = (record.quantity ??
        record.count ??
        record.qty ??
        1) as number;
      cards.push({ name, quantity: Number(qty) || 1 });
    }

    return cards;
  } catch {
    return [];
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Extract deck ID from a curiosa.io URL or raw ID
 * Handles: "https://curiosa.io/decks/abc123", "curiosa.io/decks/abc123", "abc123"
 */
export function extractDeckId(urlOrId: string): string {
  const trimmed = urlOrId.trim().replace(/\/+$/, "");
  if (trimmed.includes("/")) {
    return trimmed.split("/").pop() ?? trimmed;
  }
  return trimmed;
}

/**
 * Fetch a deck from curiosa.io by URL or deck ID.
 *
 * Makes two proxied requests:
 *   1. GET /api/curiosa/decks/{id}  →  HTML page (parse <title> for name/author)
 *   2. GET /api/curiosa/api/trpc/…  →  tRPC batch (board data)
 */
export async function fetchCuriosaDeck(urlOrId: string): Promise<Deck> {
  const deckId = extractDeckId(urlOrId);
  if (!deckId) {
    throw new Error("Invalid deck URL or ID");
  }

  // 1) Fetch the deck HTML page to extract name + author from <title>
  let name = "Imported Deck";
  let author: string | undefined;

  try {
    const htmlUrl = `${PROXY_PREFIX}/decks/${encodeURIComponent(deckId)}`;
    const htmlRes = await curiosaFetch(htmlUrl);

    if (htmlRes.ok) {
      const html = await htmlRes.text();
      const m = html.match(/<title>(.*?)<\/title>/i);
      const title = m?.[1]?.trim();
      if (title) {
        const parts = title.split("|");
        name = parts[0]?.trim() || name;
        author = parts[1]?.trim() || author;
      }
    }
  } catch {
    // keep defaults
  }

  // 2) Fetch board data via tRPC batch request
  const query: Record<string, { json: { id: string } }> = {};
  for (let i = 0; i < 4; i++) query[String(i)] = { json: { id: deckId } };

  const procedures = [
    "deck.getDecklistById",
    "deck.getAvatarById",
    "deck.getSideboardById",
    "deck.getMaybeboardById",
  ].join(",");

  const input = encodeURIComponent(JSON.stringify(query));
  const trpcUrl = `${PROXY_PREFIX}/api/trpc/${procedures}?batch=1&input=${input}`;

  const trpcRes = await curiosaFetch(trpcUrl, {
    headers: { accept: "application/json" },
  });

  if (!trpcRes.ok) {
    throw new Error(`Curiosa API error: ${trpcRes.status}`);
  }

  const results = await trpcRes.json();
  if (!Array.isArray(results) || results.length !== 4) {
    throw new Error("Unexpected response format from curiosa.io");
  }

  const now = new Date().toISOString();
  return {
    id: generateUUID(),
    name,
    author,
    boards: {
      mainboard: parseBoardData(results[0]),
      avatar: parseBoardData(results[1]),
      sideboard: parseBoardData(results[2]),
      maybeboard: parseBoardData(results[3]),
    },
    createdAt: now,
    updatedAt: now,
  };
}
