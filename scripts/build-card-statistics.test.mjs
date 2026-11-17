import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCardStatistics } from './build-card-statistics.mjs';
import { analyticsResponseFixture } from './lib/play-sorcery-analytics.fixture.ts';
import { parseAnalyticsSnapshot } from './lib/play-sorcery-analytics.ts';

vi.mock('./lib/card-catalog.mjs', () => ({ readCardCatalog: async () => ({ cards: [{ name: 'Toolbox' }], issues: [] }) }));
const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
async function files() {
  const directory = await mkdtemp(join(tmpdir(), 'sorcery-statistics-test-')); directories.push(directory);
  return { input: join(directory, 'cards'), output: join(directory, 'public', 'card_statistics.json') };
}

describe('offline statistics build', () => {
  it('publishes only prepared aggregates, matches names and retains unknown names without network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No live requests')));
    const { input, output } = await files();
    const data = analyticsResponseFixture();
    data.cards[0].cardName = ' TOOLBOX ';
    data.cards[0].notInHand = { playerGames: 100, matches: 100, wins: 45, winRate: .45 };
    await writeFile(input, JSON.stringify({ ...data, cookie: 'synthetic-secret', userId: 'synthetic-identity' }));
    expect(await buildCardStatistics(input, output)).toMatchObject({ cards: 2, matched: 1, unmatched: ['Unknown Card'] });
    const text = await readFile(output, 'utf8');
    const asset = JSON.parse(text);
    expect(asset.cards.Toolbox).toMatchObject({ deckShare: { value: 20, games: 1000 }, inDeck: { value: 50, games: 200 }, played: { value: 0, games: 200 }, openingHand: { value: null, games: null }, drawnDifference: { value: 10, games: 100 } });
    expect(asset.unmatched['Unknown Card']).toBeDefined();
    expect(text).not.toMatch(/synthetic-|guardian|cardKey|importedAt/);
    expect((await stat(output)).mode & 0o777).toBe(0o644);
    await buildCardStatistics(input, output);
    expect(await readFile(output, 'utf8')).toBe(text);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts the previous local archive but keeps suppressed differences unavailable', async () => {
    const { input, output } = await files();
    const response = analyticsResponseFixture();
    response.cards[0].notInHand = { playerGames: null, matches: null, wins: null, winRate: null };
    await writeFile(input, JSON.stringify(parseAnalyticsSnapshot(response)));
    await buildCardStatistics(input, output);
    expect(JSON.parse(await readFile(output, 'utf8')).cards.Toolbox.drawnDifference).toEqual({ value: null, games: null });
  });
  it('preserves the last published file on invalid input and refuses to overwrite its source', async () => {
    const { input, output } = await files();
    await writeFile(input, JSON.stringify(analyticsResponseFixture()));
    await buildCardStatistics(input, output);
    const previous = await readFile(output, 'utf8');
    await writeFile(input, '<html>Sign in</html>');
    await expect(buildCardStatistics(input, output)).rejects.toThrow('not JSON');
    expect(await readFile(output, 'utf8')).toBe(previous);
    await expect(buildCardStatistics(input, input)).rejects.toThrow('separate');
  });
});
