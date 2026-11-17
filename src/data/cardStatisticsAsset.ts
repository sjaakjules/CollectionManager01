import { CARD_STATISTICS_ASSET_URL, parseCardStatisticsAsset, type CardStatisticsAsset } from './cardStatistics';

let pending: Promise<CardStatisticsAsset | null> | null = null;

/** One same-origin asset read per page session, shared by the panel and hover view. No polling. */
export function loadCardStatisticsAsset(): Promise<CardStatisticsAsset | null> {
  pending ??= fetch(CARD_STATISTICS_ASSET_URL, { cache: 'no-cache', credentials: 'omit' })
    .then(async response => {
      if (!response.ok) return null;
      return parseCardStatisticsAsset(await response.json());
    }).catch(() => null);
  return pending;
}
