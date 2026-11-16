import type { Card, CardStats } from './dataModels';
import { normalizeCardCatalog } from './cardCatalog';
import photoCatalog from './provisionalCards.json';

interface PhotoTranscription {
  card: Card;
  source: string;
  officialGuardianHash?: string;
  uncertainFields: string[];
  notes: string[];
}

/** Reviewed photo transcriptions, kept separate from the official snapshot/cache. */
// An empty supplement is valid once every photographed card has been released.
const entries: PhotoTranscription[] = photoCatalog.cards;
const normalized = entries.length > 0
  ? normalizeCardCatalog(entries.map((entry) => entry.card)).cards
  : [];
const sourceEntries = new Map(entries.map((entry) => [entry.card.name, entry]));

export const provisionalCards: Card[] = normalized.map((card) => ({
  ...card,
  provisional: {
    source: sourceEntries.get(card.name)?.source ?? '',
    uncertainFields: sourceEntries.get(card.name)?.uncertainFields ?? [],
    notes: sourceEntries.get(card.name)?.notes ?? [],
  },
}));

const nameKey = (name: string): string => name.trim().normalize('NFC').toLowerCase();
const releaseKey = (name: string): string => nameKey(name).replace(/[^a-z0-9]/g, '');
const previewsByName = new Map(provisionalCards.map((card) => [nameKey(card.name), card]));

/** Content identity for the known pre-release guardian of a photographed reprint. */
export function cardStatsFingerprint(stats: CardStats): string {
  const content = JSON.stringify([
    stats.rarity, stats.type, stats.rulesText, stats.cost, stats.attack, stats.defence, stats.life,
    stats.thresholds.air, stats.thresholds.earth, stats.thresholds.fire, stats.thresholds.water,
  ]);
  let hash = 2166136261;
  for (let index = 0; index < content.length; index++) {
    hash = Math.imul(hash ^ content.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * New official records win in full. The two known older reprints receive the
 * photographed printing until their official guardian changes or the set lands.
 * Existing printings remain available; no user data or upstream cache is changed.
 */
export function withProvisionalCards(cards: Card[]): Card[] {
  const existing = new Set(cards.map((card) => nameKey(card.name)));
  const supplemented = cards.map((card) => {
    const preview = previewsByName.get(nameKey(card.name));
    const baseline = preview && sourceEntries.get(preview.name)?.officialGuardianHash;
    if (!preview || !baseline || card.provisional) return card;
    const releaseIsOfficial = card.sets.some((set) =>
      preview.sets.some((release) => releaseKey(release.name) === releaseKey(set.name)));
    if (releaseIsOfficial || cardStatsFingerprint(card.guardian) !== baseline) return card;
    return {
      ...card,
      guardian: preview.guardian,
      sets: [...card.sets, ...preview.sets],
      keywords: [...new Set([...(card.keywords ?? []), ...(preview.keywords ?? [])])],
      provisional: preview.provisional,
    };
  });
  return [...supplemented, ...provisionalCards.filter((card) => !existing.has(nameKey(card.name)))];
}
