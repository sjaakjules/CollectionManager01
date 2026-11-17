import { describe, expect, it } from 'vitest';
import { analyticsResponseFixture } from './play-sorcery-analytics.fixture';
import { drawnDifference, matchAnalyticsCards, parseAnalyticsSnapshot, parseAnalyticsText } from './play-sorcery-analytics';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture entry');
  return value;
}

describe('Play Sorcery offline analytics', () => {
  it('preserves zero wins, suppressed counts and independent cohorts', () => {
    const snapshot = parseAnalyticsSnapshot(analyticsResponseFixture());
    const card = required(snapshot.data.cards[0]);
    expect(card.played.winRate).toBe(0);
    expect(card.openingHand).toEqual({ playerGames: null, matches: null, wins: null, winRate: null });
    expect(drawnDifference(card)).toBeCloseTo(10);
    card.notInHand.winRate = null;
    expect(drawnDifference(card)).toBeNull();
  });

  it('joins canonical names without losing unmatched rows or copying metadata', () => {
    const data = analyticsResponseFixture();
    required(data.cards[0]).cardName = '  Séer’s  Vision ';
    const snapshot = parseAnalyticsSnapshot(data);
    const matched = matchAnalyticsCards(snapshot, [{ name: "Se\u0301er's Vision" }]);
    expect(matched.map((row) => row.catalogueName)).toEqual(["Se\u0301er's Vision", null]);
    expect(required(matched[1]).stats.cardName).toBe('Unknown Card');
    expect(snapshot.data.cards[0]).not.toHaveProperty('guardian');
  });

  it('strips extraneous fields and round-trips a provenance envelope', () => {
    const data = { ...analyticsResponseFixture(), headers: { cookie: 'synthetic-secret' }, userId: 'synthetic-user' };
    Object.assign(required(data.cards[0]), { privateField: 'synthetic-secret' });
    const snapshot = parseAnalyticsSnapshot(data, new Date('2026-11-05T00:00:00Z'));
    expect(JSON.stringify(snapshot)).not.toContain('synthetic-');
    expect(parseAnalyticsText(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.importedAt).toBe('2026-11-05T00:00:00.000Z');
  });

  it('rejects login pages and HARs without reflecting their contents', () => {
    expect(() => parseAnalyticsText('<html>synthetic-secret</html>')).toThrow('not JSON');
    expect(() => parseAnalyticsSnapshot({ log: { entries: [] } })).toThrow('response body');
  });

  it('rejects incompatible snapshots, duplicates, bad dates and invalid rates', () => {
    const original = analyticsResponseFixture();
    expect(() => parseAnalyticsSnapshot({ ...original, releasedThrough: '2026-02-30' })).toThrow('release date');
    expect(() => parseAnalyticsSnapshot({ ...original, dataAvailable: false })).toThrow('no released analytics');
    expect(() => parseAnalyticsSnapshot({ ...original, cards: [] })).toThrow('non-empty');
    expect(() => parseAnalyticsSnapshot({ ...original, cards: [original.cards[0], original.cards[0]] })).toThrow('Duplicate');
    const changed = analyticsResponseFixture();
    required(changed.cards[0]).inDeck.winRate = 50;
    expect(() => parseAnalyticsSnapshot(changed)).toThrow('0 to 1');
    const snapshot = parseAnalyticsSnapshot(original);
    expect(() => parseAnalyticsSnapshot({ ...snapshot, format: 'draft' })).toThrow('Unsupported');
  });
});
