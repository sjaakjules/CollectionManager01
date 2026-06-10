/**
 * Card data fetching service
 *
 * Fetches card data from the Sorcery TCG API.
 * Caches data in browser storage for offline use.
 *
 * In development, requests are proxied through Vite to avoid CORS issues.
 * In production, requests go directly to the API (requires proper CORS headers).
 *
 * Related files:
 * - `src/app/Startup.ts` (initial load)
 * - `src/data/dataModels.ts` (typed card contracts)
 * - `vite.config.ts` and deployed Apache/PHP routes (proxy routing)
 */

import type { Card } from "./dataModels";
import { get, set } from "idb-keyval";
import { isBlockedTokenCardName } from "@/data/tokenCards";

// Always fetch via same-origin to avoid CORS.
// - DEV: Vite should proxy this path (see vite.config.ts).
// - PROD: Apache routes this through the same-origin PHP proxy.
const API_URL = "/api/sorcery/cards";

const FETCH_TIMEOUT_MS = 20_000;
const RETRY_COUNT = 2;

/**
 * Fetch all cards from cache or API with retry/fallback behavior.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - Resolves to a `Card[]` from cache or network.
 * - Throws when both network and cache are unavailable.
 */
export async function fetchCards(): Promise<Card[]> {
  // Try cache first
  const cached = await getCachedCards();
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log("Using cached card data");
    return filterPlayableCards(cached.cards);
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

    const cards = filterPlayableCards((await response.json()) as Card[]);

    // Cache the result
    await cacheCards(cards);

    return cards;
  } catch (error) {
    console.error("Failed to fetch cards from API:", error);

    // Return cached data if available (even if stale)
    if (cached) {
      console.log("Using stale cached data due to API error");
      return filterPlayableCards(cached.cards);
    }

    throw error;
  }
}

export function filterPlayableCards(cards: Card[]): Card[] {
  return cards.filter((card) => !isBlockedTokenCardName(card.name));
}

export interface CardFilterOptions {
  sets: string[];
  types: string[];
  rarities: string[];
  artists: string[];
  subTypes: string[];
}

const CARD_TYPE_ORDER = ['Avatar', 'Minion', 'Magic', 'Aura', 'Artifact', 'Site'];
const CARD_RARITY_ORDER = ['Ordinary', 'Exceptional', 'Elite', 'Unique'];

function parseSubTypeTokens(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/[,/|]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Build sorted filter option lists from card metadata in one pass.
 *
 * Inputs:
 * - `cards`: Card catalog to summarize.
 *
 * Outputs:
 * - Returns unique/sorted options for sets, types, rarities, artists, and sub-types.
 */
export function buildCardFilterOptions(cards: Card[]): CardFilterOptions {
  const sets = new Set<string>();
  const types = new Set<string>();
  const rarities = new Set<string>();
  const artists = new Set<string>();
  const subTypes = new Set<string>();

  for (const card of cards) {
    if (typeof card.guardian.type === 'string' && card.guardian.type.trim()) {
      types.add(card.guardian.type.trim());
    }
    if (typeof card.guardian.rarity === 'string' && card.guardian.rarity.trim()) {
      rarities.add(card.guardian.rarity.trim());
    }

    for (const setEntry of card.sets) {
      if (typeof setEntry.name === 'string' && setEntry.name.trim()) {
        sets.add(setEntry.name.trim());
      }
      for (const variant of setEntry.variants) {
        if (variant.artist.trim()) {
          artists.add(variant.artist.trim());
        }
      }
    }

    for (const token of parseSubTypeTokens(card.subTypes)) {
      subTypes.add(token);
    }
  }

  return {
    sets: [...sets].sort((a, b) => a.localeCompare(b)),
    types: [...types].sort((a, b) => {
      const aIndex = CARD_TYPE_ORDER.indexOf(a);
      const bIndex = CARD_TYPE_ORDER.indexOf(b);
      const safeA = aIndex === -1 ? CARD_TYPE_ORDER.length : aIndex;
      const safeB = bIndex === -1 ? CARD_TYPE_ORDER.length : bIndex;
      if (safeA !== safeB) return safeA - safeB;
      return a.localeCompare(b);
    }),
    rarities: [...rarities].sort((a, b) => {
      const aIndex = CARD_RARITY_ORDER.indexOf(a);
      const bIndex = CARD_RARITY_ORDER.indexOf(b);
      const safeA = aIndex === -1 ? CARD_RARITY_ORDER.length : aIndex;
      const safeB = bIndex === -1 ? CARD_RARITY_ORDER.length : bIndex;
      if (safeA !== safeB) return safeA - safeB;
      return a.localeCompare(b);
    }),
    artists: [...artists].sort((a, b) => a.localeCompare(b)),
    subTypes: [...subTypes].sort((a, b) => a.localeCompare(b)),
  };
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

const CACHE_KEY = "sorcery_card_cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedCards {
  timestamp: number;
  cards: Card[];
}
