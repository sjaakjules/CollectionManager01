/**
 * Card data fetching service
 *
 * Fetches card data from the Sorcery TCG API.
 * Caches data in browser storage for offline use.
 *
 * In development, requests are proxied through Vite to avoid CORS issues.
 * In production, requests go directly to the API (requires proper CORS headers).
 */

import type { Card } from "./dataModels";
import { get, set, del } from "idb-keyval";

// Always fetch via same-origin to avoid CORS.
// - DEV: Vite should proxy this path (see vite.config.ts).
// - PROD (Netlify drag-and-drop): Netlify will proxy this via `public/_redirects`.
const API_URL = "/api/sorcery/cards";

const FETCH_TIMEOUT_MS = 20_000;
const RETRY_COUNT = 2;

/**
 * Fetch all cards from the API or cache
 */
export async function fetchCards(): Promise<Card[]> {
  // Try cache first
  const cached = await getCachedCards();
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log("Using cached card data");
    return cached.cards;
  }

  // Fetch from API
  try {
    console.log("Fetching cards from API...");
    const response = await fetchWithRetry(API_URL, {
      timeoutMs: FETCH_TIMEOUT_MS,
      retries: RETRY_COUNT,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const cards = (await response.json()) as Card[];

    // Cache the result
    await cacheCards(cards);

    return cards;
  } catch (error) {
    console.error("Failed to fetch cards from API:", error);

    // Return cached data if available (even if stale)
    if (cached) {
      console.log("Using stale cached data due to API error");
      return cached.cards;
    }

    throw error;
  }
}

/**
 * Force refresh card data from API
 */
export async function refreshCards(): Promise<Card[]> {
  await clearCardCache();
  return fetchCards();
}

/**
 * Get card by name
 */
export function findCardByName(cards: Card[], name: string): Card | undefined {
  return cards.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

/**
 * Get all unique card types
 */
export function getCardTypes(cards: Card[]): string[] {
  const types = new Set<string>();
  for (const card of cards) {
    types.add(card.guardian.type);
  }
  return Array.from(types).sort();
}

/**
 * Get all unique elements
 */
export function getElements(cards: Card[]): string[] {
  const elements = new Set<string>();
  for (const card of cards) {
    if (card.elements) {
      elements.add(card.elements);
    }
  }
  return Array.from(elements).sort();
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

interface FetchWithRetryOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const { timeoutMs = 20_000, retries = 0, ...init } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        // Avoid cached CORS failures; let our own caching layer handle persistence.
        cache: "no-store",
      });
      clearTimeout(timeout);

      if (res.ok) return res;

      // Retry on transient upstream errors.
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Network request failed");
}

// Cache helpers

async function getCachedCards(): Promise<CachedCards | null> {
  try {
    return (await get<CachedCards>(CACHE_KEY)) ?? null;
  } catch {
    return null;
  }
}

async function cacheCards(cards: Card[]): Promise<void> {
  try {
    await set(CACHE_KEY, {
      timestamp: Date.now(),
      cards,
    });
  } catch (error) {
    console.warn("Failed to cache cards:", error);
  }
}

async function clearCardCache(): Promise<void> {
  try {
    await del(CACHE_KEY);
  } catch (error) {
    console.warn("Failed to clear card cache:", error);
  }
}

const CACHE_KEY = "sorcery_card_cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedCards {
  timestamp: number;
  cards: Card[];
}
