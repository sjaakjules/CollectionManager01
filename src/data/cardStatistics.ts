/** Published aggregate reference data. All rates are percentages; differences are pp. */
export const CARD_STATISTICS_ASSET_URL = '/assets/card_statistics.json';
export const CARD_STATISTIC_METRICS = ['deckShare', 'inDeck', 'played', 'openingHand', 'inHand', 'notInHand', 'inDeckUnplayed', 'drawnDifference'] as const;
export type CardStatisticMetric = typeof CARD_STATISTIC_METRICS[number];
export interface CardStatisticValue { value: number | null; games: number | null }
export type CardStatistics = Record<CardStatisticMetric, CardStatisticValue>;
export interface CardStatisticsAsset {
  version: 'card-statistics-v1';
  source: 'Play Sorcery Online';
  format: 'constructed';
  releasedThrough: string;
  generatedAt: number;
  totalGames: number;
  totalPlayerGames: number;
  cards: Record<string, CardStatistics>;
  unmatched: Record<string, CardStatistics>;
}

export const CARD_STATISTIC_LABELS: Record<CardStatisticMetric, string> = {
  deckShare: 'Deck share', inDeck: 'In-deck win rate', played: 'Played win rate', openingHand: 'Opening-hand win rate',
  inHand: 'In-hand win rate', notInHand: 'Never-drawn win rate', inDeckUnplayed: 'Unplayed win rate', drawnDifference: 'Drawn difference',
};
export const CARD_STATISTIC_SHORT_LABELS: Record<CardStatisticMetric, string> = {
  deckShare: 'Use', inDeck: 'Deck WR', played: 'Played WR', openingHand: 'Opening WR',
  inHand: 'Hand WR', notInHand: 'Undrawn WR', inDeckUnplayed: 'Unplayed WR', drawnDifference: 'Drawn Δ',
};
export const CARD_STATISTIC_DESCRIPTIONS: Record<CardStatisticMetric, string> = {
  deckShare: 'Percentage of player-games with this card in the deck. Sample size is all player-games.',
  inDeck: 'Win rate when this card was in the deck.',
  played: 'Win rate when played at least once; uncertain play histories are excluded.',
  openingHand: 'Win rate when kept in the opening hand after the mulligan.',
  inHand: 'Win rate when seen in hand after the mulligan, including later draws.',
  notInHand: 'Win rate when included but never seen in hand; incomplete hand histories are excluded.',
  inDeckUnplayed: 'Win rate when included but not played; uncertain play histories are excluded.',
  drawnDifference: 'In-hand minus never-drawn win rate in percentage points. The sample minimum must be met by both groups.',
};

export function formatCardStatistic(metric: CardStatisticMetric, value: number | null): string {
  if (value === null) return '—';
  return metric === 'drawnDifference'
    ? `${value > 0 ? '+' : ''}${value.toFixed(1)} pp` : `${value.toFixed(1)}%`;
}

/** Validate the published contract, without parsing raw upstream responses or joining metadata. */
export function parseCardStatisticsAsset(input: unknown): CardStatisticsAsset {
  const fail = (): never => { throw new Error('Invalid published card statistics. Rebuild the statistics asset offline.'); };
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    return value as Record<string, unknown>;
  };
  const integer = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
  const root = object(input);
  if (root.version !== 'card-statistics-v1' || root.source !== 'Play Sorcery Online' || root.format !== 'constructed') return fail();
  const releasedThrough = root.releasedThrough;
  if (typeof releasedThrough !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(releasedThrough)
    || !Number.isFinite(Date.parse(releasedThrough)) || new Date(releasedThrough).toISOString().slice(0, 10) !== releasedThrough) return fail();
  const generatedAt = integer(root.generatedAt);
  if (!Number.isFinite(new Date(generatedAt).getTime())) return fail();
  const totalGames = integer(root.totalGames);
  const totalPlayerGames = integer(root.totalPlayerGames);
  const parseCards = (value: unknown): Record<string, CardStatistics> => {
    const entries = Object.entries(object(value));
    if (entries.length > 10000) return fail();
    return Object.fromEntries(entries.map(([name, inputStats]) => {
      if (!name.trim() || name.length > 200) return fail();
      const stats = object(inputStats);
      const metrics = CARD_STATISTIC_METRICS.map(metric => {
        const raw = object(stats[metric]);
        const value = raw.value;
        const games = raw.games === null ? null : integer(raw.games);
        if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < (metric === 'drawnDifference' ? -100 : 0) || value > 100)) return fail();
        if ((games !== null && games > totalPlayerGames) || (value !== null && (games === null || games === 0))) return fail();
        return [metric, { value, games }];
      });
      return [name, Object.fromEntries(metrics) as CardStatistics];
    }));
  };
  return { version: 'card-statistics-v1', source: 'Play Sorcery Online', format: 'constructed', releasedThrough, generatedAt,
    totalGames, totalPlayerGames, cards: parseCards(root.cards), unmatched: parseCards(root.unmatched) };
}
