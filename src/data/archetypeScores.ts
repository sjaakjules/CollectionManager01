/**
 * Archetype scores data
 *
 * Loads card archetype scores from the static JSON file.
 * Each card maps to a set of archetype categories with numeric scores.
 * Positive scores indicate synergy, negative scores indicate anti-synergy.
 */

export type ArchetypeScores = Record<string, Record<string, number>>;

let cachedScores: ArchetypeScores | null = null;
let cachedArchetypes: string[] | null = null;

/**
 * Load archetype scores from the static JSON file.
 * Results are cached after first load.
 */
export async function loadArchetypeScores(): Promise<ArchetypeScores> {
  if (cachedScores) return cachedScores;

  const response = await fetch('/assets/sorcery_card_archetype_scores.json');
  if (!response.ok) {
    throw new Error(`Failed to load archetype scores: ${response.status}`);
  }

  cachedScores = (await response.json()) as ArchetypeScores;
  return cachedScores;
}

/**
 * Get all unique archetype names from the scores data.
 * Returns a sorted array of archetype names.
 */
export function getArchetypeNames(scores: ArchetypeScores): string[] {
  if (cachedArchetypes) return cachedArchetypes;

  const archetypes = new Set<string>();
  for (const cardScores of Object.values(scores)) {
    for (const archetype of Object.keys(cardScores)) {
      archetypes.add(archetype);
    }
  }

  cachedArchetypes = [...archetypes].sort();
  return cachedArchetypes;
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
 * Save archetype scores to disk via the dev server.
 * Debounced so rapid edits batch into a single write.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveArchetypeScores(scores: ArchetypeScores): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('/api/save-archetype-scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scores),
    }).catch((err) => {
      console.warn('Failed to save archetype scores:', err);
    });
  }, 500);
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
