/**
 * Archetype scores data
 *
 * Loads card archetype scores from the API (Netlify Function backed by Blob storage).
 * Each card maps to a set of archetype categories with numeric scores.
 * Positive scores indicate synergy, negative scores indicate anti-synergy.
 *
 * A __meta key stores explicitly added categories so they persist even with no card scores.
 */

export type ArchetypeScores = Record<string, Record<string, number>> & {
  __meta?: { categories: string[] };
};

let cachedScores: ArchetypeScores | null = null;
let cachedArchetypes: string[] | null = null;

/**
 * Load archetype scores from the API.
 * Falls back to the static JSON file for local dev without Netlify Functions.
 * Results are cached after first load.
 */
export async function loadArchetypeScores(): Promise<ArchetypeScores> {
  if (cachedScores) return cachedScores;

  // Try API first (works on Netlify), fall back to static file (works in local dev).
  // Check Content-Type to avoid parsing HTML from SPA fallback as JSON.
  let response = await fetch('/api/archetype-scores');
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.includes('application/json')) {
    response = await fetch('/assets/sorcery_card_archetype_scores.json');
  }
  if (!response.ok) {
    throw new Error(`Failed to load archetype scores: ${response.status}`);
  }

  cachedScores = (await response.json()) as ArchetypeScores;
  return cachedScores;
}

/**
 * Get all unique archetype names from the scores data.
 * Includes categories from __meta (explicitly added) and from card scores.
 * Returns a sorted array of archetype names.
 */
export function getArchetypeNames(scores: ArchetypeScores): string[] {
  if (cachedArchetypes) return cachedArchetypes;

  const archetypes = new Set<string>();

  // Include explicitly registered categories from __meta
  if (scores.__meta?.categories) {
    for (const cat of scores.__meta.categories) {
      archetypes.add(cat);
    }
  }

  // Include categories discovered from card scores
  for (const [key, cardScores] of Object.entries(scores)) {
    if (key === '__meta') continue;
    for (const archetype of Object.keys(cardScores)) {
      archetypes.add(archetype);
    }
  }

  cachedArchetypes = [...archetypes].sort();
  return cachedArchetypes;
}

/**
 * Invalidate the cached archetype names so they are recomputed on next call.
 */
export function invalidateArchetypeCache(): void {
  cachedArchetypes = null;
}

/**
 * Mutate a card's archetype score in the cached data.
 * If the resulting score is 0, removes the entry.
 * Mutates the scores object in-place so all references see the change.
 */
export function updateArchetypeScore(
  scores: ArchetypeScores,
  cardName: string,
  archetype: string,
  delta: number
): number {
  if (!scores[cardName]) {
    scores[cardName] = {};
  }
  const current = scores[cardName][archetype] ?? 0;
  const next = current + delta;

  if (next === 0) {
    delete scores[cardName][archetype];
    // Clean up empty card entries
    if (Object.keys(scores[cardName]).length === 0) {
      delete scores[cardName];
    }
  } else {
    scores[cardName][archetype] = next;
  }

  return next;
}

/**
 * Persistent save system.
 * The local cache is always the source of truth — every edit mutates it in-place,
 * and we sync the full state to the server.
 * Posts directly to the function URL with ?action=save-full (no redirect dependency).
 */
const SAVE_URL = '/api/archetype-scores?action=save-full';
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let saveInFlight = false;

async function doFullSave(): Promise<void> {
  if (!cachedScores || saveInFlight) return;
  dirty = false;
  saveInFlight = true;
  try {
    const res = await fetch(SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cachedScores),
    });
    if (!res.ok) {
      console.warn('Save failed with status:', res.status);
      dirty = true;
    }
  } catch (err) {
    console.warn('Failed to save archetype scores:', err);
    dirty = true;
  } finally {
    saveInFlight = false;
    // If new edits came in during the save, schedule another
    if (dirty) {
      saveTimer = setTimeout(doFullSave, 300);
    }
  }
}

export function saveScoreUpdate(): void {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(doFullSave, 300);
}

/**
 * Immediately flush pending saves to the server.
 * Called when switching/deselecting an archetype filter.
 */
export function flushPendingScoreUpdates(): void {
  if (!dirty) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  doFullSave();
}

// Flush on page close / tab switch using sendBeacon (reliable even during unload)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (!dirty || !cachedScores) return;
    const blob = new Blob([JSON.stringify(cachedScores)], { type: 'application/json' });
    navigator.sendBeacon(SAVE_URL, blob);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingScoreUpdates();
    }
  });
}

export function saveArchetypeScores(scores: ArchetypeScores): void {
  cachedScores = scores;
  saveScoreUpdate();
}

/**
 * Add a new category via the server API.
 * Returns the sanitized category name on success.
 */
export async function addCategory(name: string): Promise<string> {
  const response = await fetch('/api/archetype-scores?action=add-category', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryName: name }),
  });

  const data = await response.json() as { ok?: boolean; name?: string; error?: string };

  if (!response.ok) {
    throw new Error(data.error ?? 'Failed to add category');
  }

  const sanitized = data.name ?? name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

  // Update local cache
  if (cachedScores) {
    if (!cachedScores.__meta) cachedScores.__meta = { categories: [] };
    if (!cachedScores.__meta.categories.includes(sanitized)) {
      cachedScores.__meta.categories.push(sanitized);
    }
  }

  // Invalidate archetype name cache so it's recomputed
  invalidateArchetypeCache();

  return sanitized;
}

/**
 * Format archetype name for display.
 * e.g., "card_draw" -> "Card Draw", "aggro" -> "Aggro"
 */
export function formatArchetypeName(archetype: string): string {
  return archetype
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
