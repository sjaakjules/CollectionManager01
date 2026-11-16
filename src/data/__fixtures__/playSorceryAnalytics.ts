/** Synthetic aggregates for offline tests; no downloaded data or credentials. */
export function analyticsResponseFixture() {
  const observed = { playerGames: 200, matches: 180, wins: 100, winRate: 0.5 };
  const suppressed = { playerGames: null, matches: null, wins: null, winRate: null };
  return {
    releasedThrough: '2026-10-31', dataAvailable: true, totalGames: 500,
    generatedAt: 1793826387287, totalPlayerGames: 1000,
    cards: ['Toolbox', 'Unknown Card'].map((cardName, index) => ({
      cardKey: cardName.toLowerCase(), cardName, deckShare: index === 0 ? 0.2 : 0.1,
      inDeck: { ...observed }, played: { ...observed, winRate: index === 0 ? 0 : 0.5, wins: index === 0 ? 0 : 100 },
      openingHand: { ...suppressed }, inHand: { ...observed, winRate: 0.55, wins: 110 },
      notInHand: { ...observed, winRate: 0.45, wins: 90 }, inDeckUnplayed: { ...suppressed },
    })),
  };
}
