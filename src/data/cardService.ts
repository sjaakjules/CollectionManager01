/**
 * Card data fetching service
 *
 * Fetches card data from the Sorcery TCG API.
 * Caches data in browser storage for offline use.
 *
 * In development, requests are proxied through Vite to avoid CORS issues.
 * In production, requests go directly to the API (requires proper CORS headers).
 */

import type { Card } from './dataModels';
import { get, set } from 'idb-keyval';

// Use proxy in development to avoid CORS issues with Safari/browsers
const API_URL = import.meta.env.DEV
  ? '/api/sorcery/cards'
  : 'https://api.sorcerytcg.com/api/cards';

const CACHE_KEY = 'sorcery_card_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedCards {
  timestamp: number;
  cards: Card[];
}

/**
 * Fetch all cards from the API or cache
 */
export async function fetchCards(): Promise<Card[]> {
  // Try cache first
  const cached = await getCachedCards();
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('Using cached card data');
    return cached.cards;
  }

  // Fetch from API
  try {
    console.log('Fetching cards from API...');
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const cards = (await response.json()) as Card[];

    // Cache the result
    await cacheCards(cards);

    return cards;
  } catch (error) {
    console.error('Failed to fetch cards from API:', error);

    // Return cached data if available (even if stale)
    if (cached) {
      console.log('Using stale cached data due to API error');
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

// Cache helpers

async function getCachedCards(): Promise<CachedCards | null> {
  try {
    return await get<CachedCards>(CACHE_KEY) ?? null;
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
    console.warn('Failed to cache cards:', error);
  }
}

async function clearCardCache(): Promise<void> {
  try {
    const { del } = await import('idb-keyval');
    await del(CACHE_KEY);
  } catch (error) {
    console.warn('Failed to clear card cache:', error);
  }
}
