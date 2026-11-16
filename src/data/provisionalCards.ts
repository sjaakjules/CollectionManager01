import type { Card, CardStats } from './dataModels';
import { normalizeCardCatalog } from './cardCatalog';
import previewCatalog from './provisionalCards.json';

interface PreviewTranscription {
  card: Card;
  source: string;
  officialGuardianHash?: string;
  uncertainFields: string[];
  notes: string[];
}

interface PreviewAppearance {
  name: string;
  setName: string;
  releasedAt: string;
  source: string;
  notes: string[];
}

/** Reviewed previews, kept separate from the official snapshot/cache. */
const entries: PreviewTranscription[] = previewCatalog.cards;
const appearances: PreviewAppearance[] = previewCatalog.appearances;
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
const appearancesByName = new Map(appearances.map((entry) => [nameKey(entry.name), entry]));

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
 * Official records replace new previews in full. Trailer appearances of existing
 * cards only add a provisional set association: their current rules stay official.
 * Legacy photo overrides require an exact baseline fingerprint. Neither user
 * data nor the upstream cache is changed, and repeated application is harmless.
 */
export function withProvisionalCards(cards: Card[]): Card[] {
  const existing = new Set(cards.map((card) => nameKey(card.name)));
  const supplemented = cards.map((card) => {
    if (card.provisional) return card;
    const appearance = appearancesByName.get(nameKey(card.name));
    if (appearance && !card.sets.some((set) => releaseKey(set.name) === releaseKey(appearance.setName))) {
      return {
        ...card,
        sets: [...card.sets, {
          name: appearance.setName,
          releasedAt: appearance.releasedAt,
          metadata: card.guardian,
          variants: [],
        }],
        provisional: { source: appearance.source, uncertainFields: ['set'], notes: appearance.notes },
      };
    }
    const preview = previewsByName.get(nameKey(card.name));
    const baseline = preview && sourceEntries.get(preview.name)?.officialGuardianHash;
    if (!preview || !baseline) return card;
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
