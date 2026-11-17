import type { CardStatisticsAsset, CardStatistics } from '../cardStatistics';

export function cardStatisticsFixture(): CardStatisticsAsset {
  const stats: CardStatistics = {
    deckShare: { value: 20, games: 1000 }, inDeck: { value: 55, games: 200 },
    played: { value: 0, games: 100 }, openingHand: { value: null, games: null },
    inHand: { value: 45, games: 100 }, notInHand: { value: 55, games: 200 },
    inDeckUnplayed: { value: null, games: null }, drawnDifference: { value: -10, games: 100 },
  };
  return { version: 'card-statistics-v1', source: 'Play Sorcery Online', format: 'constructed',
    releasedThrough: '2026-10-31', generatedAt: 1793826387287, totalGames: 500, totalPlayerGames: 1000,
    cards: { Toolbox: stats }, unmatched: { 'Unknown Card': structuredClone(stats) } };
}
