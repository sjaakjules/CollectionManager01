/**
 * Archetype scores data
 *
 * Loads card archetype scores from static seed data and persists edits via userData.
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
let externalSaveHandler: ((scores: ArchetypeScores) => void) | null = null;

/**
 * Load archetype scores from static seed data.
 * Results are cached after first load.
 */
export async function loadArchetypeScores(): Promise<ArchetypeScores> {
  if (cachedScores) return cachedScores;

  const response = await fetch('/assets/sorcery_card_archetype_scores.json', {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to load archetype scores: ${response.status}`);
  }

  cachedScores = (await response.json()) as ArchetypeScores;
  return cachedScores;
}

/**
 * Override the in-memory scores cache.
 * Pass null to clear and allow reload from API/static JSON.
 */
export function setCachedArchetypeScores(scores: ArchetypeScores | null): void {
  cachedScores = scores;
  invalidateArchetypeCache();
}

/**
 * Set a persistence callback used to persist scores into userData.
 * Used to persist scores into account userData.
 */
export function setArchetypeSaveHandler(
  handler: ((scores: ArchetypeScores) => void) | null
): void {
  externalSaveHandler = handler;
  if (externalSaveHandler && dirty) {
    flushPendingScoreUpdates();
  }
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
    Reflect.deleteProperty(scores[cardName], archetype);
    // Clean up empty card entries
    if (Object.keys(scores[cardName]).length === 0) {
      Reflect.deleteProperty(scores, cardName);
    }
  } else {
    scores[cardName][archetype] = next;
  }

  return next;
}

/**
 * Persistent save system.
 * The local cache is always the source of truth — every edit mutates it in-place,
 * and we push the full state into userData via the configured save handler.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let saveInFlight = false;

async function doFullSave(): Promise<void> {
  if (!cachedScores || saveInFlight) return;
  dirty = false;
  saveInFlight = true;
  try {
    if (!externalSaveHandler) {
      // Keep pending until userData persistence is wired.
      dirty = true;
      return;
    }

    externalSaveHandler(cachedScores);
  } catch (err) {
    console.warn('Failed to save archetype scores:', err);
    dirty = true;
  } finally {
    saveInFlight = false;
    // If new edits came in during the save, schedule another
    if (dirty && externalSaveHandler) {
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
 * Immediately flush pending saves.
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

// Flush on page close / tab switch.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushPendingScoreUpdates();
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
 * Add a new category in-memory, then persist via userData save handler.
 * Returns the sanitized category name on success.
 */
export async function addCategory(name: string): Promise<string> {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  if (!sanitized) {
    throw new Error('Invalid category name');
  }

  const scores = (cachedScores ?? {}) as ArchetypeScores;
  if (!scores.__meta) scores.__meta = { categories: [] };

  const existingFromData = new Set<string>();
  for (const [key, val] of Object.entries(scores)) {
    if (key === '__meta') continue;
    if (val && typeof val === 'object') {
      for (const arch of Object.keys(val)) {
        existingFromData.add(arch);
      }
    }
  }

  if (
    scores.__meta.categories.includes(sanitized) ||
    existingFromData.has(sanitized)
  ) {
    throw new Error('Category already exists');
  }

  scores.__meta.categories.push(sanitized);
  cachedScores = scores;
  invalidateArchetypeCache();
  saveScoreUpdate();

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
