import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardStatisticsFixture } from './__fixtures__/cardStatistics';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
describe('shared statistics asset loader', () => {
  it('loads the same-origin asset once across consumers with no credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => cardStatisticsFixture() });
    vi.stubGlobal('fetch', fetcher);
    const { loadCardStatisticsAsset } = await import('./cardStatisticsAsset');
    const [first, second] = await Promise.all([loadCardStatisticsAsset(), loadCardStatisticsAsset()]);
    expect(first).toEqual(cardStatisticsFixture());
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/assets/card_statistics.json', { cache: 'no-cache', credentials: 'omit' });
  });
  it.each(['missing', 'invalid', 'offline'])('leaves the app usable on %s data and never retries', async failure => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      if (failure === 'offline') throw new Error('offline');
      return { ok: failure !== 'missing', json: async () => ({ bad: true }) };
    }));
    const { loadCardStatisticsAsset } = await import('./cardStatisticsAsset');
    expect(await loadCardStatisticsAsset()).toBeNull();
    expect(await loadCardStatisticsAsset()).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
