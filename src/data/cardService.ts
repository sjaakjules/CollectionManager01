/**
 * Card data fetching service
 *
 * Fetches card data from the Sorcery TCG API.
 * Caches data in browser storage for offline use.
 *
 * Requests use the shared SorceryTCG queue and same-origin Vite/PHP proxies.
 *
 * Related files:
 * - `src/app/Startup.ts` (initial load)
 * - `src/data/dataModels.ts` (typed card contracts)
 * - `vite.config.ts` and deployed Apache/PHP routes (proxy routing)
 */

import type { Card } from "./dataModels";
import { get, set } from "idb-keyval";
import { isBlockedTokenCardName } from "@/data/tokenCards";
import { normalizeCardCatalog, type CardCatalogResult } from './cardCatalog';
import { sorceryClient } from './sorceryRequest';
import { withProvisionalCards } from './provisionalCards';

// Always fetch via same-origin to avoid CORS.
// - DEV: Vite should proxy this path (see vite.config.ts).
// - PROD: Apache routes this through the same-origin PHP proxy.
const API_URL = "/api/sorcery/cards";

// Bundled snapshot for offline-first runs (no network, no cache yet).
// Regenerate with `pnpm cards:snapshot` after updating docs/Sorcery_CardInfo.json.
const LOCAL_SNAPSHOT_URL = "/assets/sorcery_cards.json";
// Bump after publishing a reviewed official snapshot, never clear guest data.
export const CARD_CATALOGUE_REVISION = '2026-11-16';

type FetchedCatalogue = CardCatalogResult & { stale?: boolean };
let pendingCatalogue: Promise<FetchedCatalogue> | null = null;

function fetchFreshCatalogue(): Promise<FetchedCatalogue> {
  if (!pendingCatalogue) {
    pendingCatalogue = (async () => {
      const response = await sorceryClient.fetch(API_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      return { ...normalizeCardCatalog(await response.json()),
        stale: response.headers.get('x-sorcery-catalogue-cache') === 'stale' };
    })();
    void pendingCatalogue.then(
      () => { pendingCatalogue = null; },
      () => { pendingCatalogue = null; },
    );
  }
  return pendingCatalogue;
}

/**
 * Fetch all cards from cache or API with retry/fallback behavior.
 *
 * Inputs:
 * - Optional `onWarning` callback for catalogue recovery notices.
 *
 * Outputs:
 * - Resolves to a `Card[]` from cache or network.
 * - Throws only when the API, cache and bundled snapshot are all unusable.
 */
export async function fetchCards(onWarning?: (message: string) => void): Promise<Card[]> {
  // Try cache first
  const cached = await getCachedCards();
  if (cached && cached.revision === CARD_CATALOGUE_REVISION && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log("Using cached card data");
    return playableCatalog(cached.catalog, onWarning);
  }

  // Fetch from API
  try {
    console.log("Fetching cards from API...");
    const catalog = await fetchFreshCatalogue();
    const cards = playableCatalog(catalog, onWarning);
    if (catalog.stale) onWarning?.('SorceryTCG is unavailable. Using the last verified shared catalogue.');

    // A partial response must not replace the last complete catalog.
    // Keep photo transcriptions out of the official cache so corrected local
    // transcriptions and future official records can replace them on any load.
    if (catalog.issues.length === 0 && !catalog.stale) await cacheCards(filterPlayableCards(catalog.cards));

    return cards;
  } catch (error) {
    console.error("Failed to fetch cards from API:", error);

    // A bundled release is newer than a cache from a previous catalogue build.
    if (cached && cached.revision !== CARD_CATALOGUE_REVISION) {
      const bundled = await fetchBundledCards(onWarning);
      if (bundled) {
        onWarning?.('The latest card catalogue could not be loaded. Using the bundled release catalogue.');
        return bundled;
      }
    }

    // Return cached data if available (even if stale)
    if (cached) {
      console.log("Using stale cached data due to API error");
      onWarning?.('The latest card catalogue could not be loaded. Using saved cards; newer cards may be unavailable.');
      return playableCatalog(cached.catalog, onWarning);
    }

    // Last resort: the bundled snapshot, so a first-ever run still works
    // fully offline. Not cached, so the next online run fetches fresh data.
    const bundled = await fetchBundledCards(onWarning);
    if (bundled) {
      console.log("Using bundled card snapshot (offline fallback)");
      onWarning?.('The latest card catalogue could not be loaded. Using bundled cards; newer cards may be unavailable.');
      return bundled;
    }

    throw error;
  }
}

async function fetchBundledCards(onWarning?: (message: string) => void): Promise<Card[] | null> {
  try {
    const response = await fetch(LOCAL_SNAPSHOT_URL);
    if (!response.ok) return null;
    return playableCatalog(normalizeCardCatalog(await response.json()), onWarning);
  } catch (error) {
    console.warn("Bundled card snapshot unavailable:", error);
    return null;
  }
}

function playableCatalog(catalog: CardCatalogResult, onWarning?: (message: string) => void): Card[] {
  const cards = filterPlayableCards(catalog.cards);
  if (cards.length === 0) throw new Error('Card catalog contains no playable cards');
  if (catalog.issues.length > 0) {
    console.warn('Card catalogue records needing review:', catalog.issues);
    const skipped = catalog.issues.filter((issue) => issue.skipped);
    const repaired = catalog.issues.filter((issue) => !issue.skipped);
    if (skipped.length > 0) {
      const names = skipped.slice(0, 5).map((issue) => issue.cardName).join(', ');
      onWarning?.(`${skipped.length} card record(s) could not be loaded: ${names}${skipped.length > 5 ? ', …' : ''}. Saved decks are unchanged.`);
    }
    if (repaired.length > 0) {
      onWarning?.(`${repaired.length} card(s) are using set metadata because current rules are unavailable.`);
    }
  }
  const supplemented = withProvisionalCards(cards);
  const previewCount = supplemented.filter((card) => card.provisional).length;
  if (previewCount > 0) {
    onWarning?.(`${previewCount} cards use provisional photo transcriptions. Official release metadata replaces them when available.`);
  }
  return supplemented;
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
    for (const umbrella of card.umbrellas ?? []) subTypes.add(umbrella);
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

// Cache helpers

async function getCachedCards(): Promise<CachedCards | null> {
  try {
    const cached: unknown = await get(CACHE_KEY);
    if (!cached || typeof cached !== 'object' || !('cards' in cached)) return null;
    const catalog = normalizeCardCatalog(cached.cards);
    if (filterPlayableCards(catalog.cards).length === 0) return null;
    const timestamp = 'timestamp' in cached && typeof cached.timestamp === 'number'
      && Number.isFinite(cached.timestamp) && cached.timestamp <= Date.now()
      ? cached.timestamp : 0;
    const revision = 'revision' in cached && typeof cached.revision === 'string' ? cached.revision : '';
    return { timestamp, catalog, revision };
  } catch (error) {
    console.warn('Card cache unavailable or incompatible; trying a fresh catalog:', error);
    return null;
  }
}

async function cacheCards(cards: Card[]): Promise<void> {
  try {
    await set(CACHE_KEY, {
      revision: CARD_CATALOGUE_REVISION,
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
  revision: string;
  timestamp: number;
  catalog: CardCatalogResult;
}
