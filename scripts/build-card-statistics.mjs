#!/usr/bin/env node
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ANALYTICS_MAX_BYTES, ANALYTICS_METRICS, drawnDifference, matchAnalyticsCards, parseAnalyticsText } from './lib/play-sorcery-analytics.ts';
import { parseCardStatisticsAsset } from '../src/data/cardStatistics.ts';
import { readCardCatalog } from './lib/card-catalog.mjs';

/** Offline only. Publish aggregate values under canonical catalogue names. */
export async function buildCardStatistics(input = 'offlineData/playsorcery/constructed.json', output = 'public/assets/card_statistics.json', cataloguePath = 'public/assets/sorcery_cards.json') {
  if (resolve(input) === resolve(output) || resolve(cataloguePath) === resolve(output)) throw new Error('The output must be separate from the saved response and catalogue.');
  if ((await stat(input)).size > ANALYTICS_MAX_BYTES) throw new Error('Analytics files must be smaller than 10 MB.');
  const snapshot = parseAnalyticsText(await readFile(input, 'utf8'));
  const catalogue = await readCardCatalog(cataloguePath);
  if (!catalogue.cards.length) throw new Error('The local card catalogue is empty. No output was changed.');
  const rows = matchAnalyticsCards(snapshot, catalogue.cards);
  const rounded = value => value === null ? null : Number(value.toFixed(6));
  const cards = [];
  const unmatched = [];
  for (const { stats, catalogueName } of rows) {
    const groups = Object.fromEntries(ANALYTICS_METRICS.map(key => [key, {
      value: stats[key].winRate === null ? null : rounded(stats[key].winRate * 100),
      games: stats[key].playerGames,
    }]));
    const difference = drawnDifference(stats);
    const differenceGames = stats.inHand.playerGames === null || stats.notInHand.playerGames === null
      ? null : Math.min(stats.inHand.playerGames, stats.notInHand.playerGames);
    const prepared = {
      deckShare: { value: rounded(stats.deckShare * 100), games: snapshot.data.totalPlayerGames },
      ...groups,
      drawnDifference: { value: differenceGames === null ? null : rounded(difference), games: differenceGames },
    };
    (catalogueName ? cards : unmatched).push([catalogueName ?? stats.cardName, prepared]);
  }
  const sorted = entries => Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const { releasedThrough, generatedAt, totalGames, totalPlayerGames } = snapshot.data;
  const asset = parseCardStatisticsAsset({ version: 'card-statistics-v1', source: 'Play Sorcery Online', format: 'constructed',
    releasedThrough, generatedAt, totalGames, totalPlayerGames, cards: sorted(cards), unmatched: sorted(unmatched) });
  const path = resolve(output);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(asset) + '\n', { mode: 0o644, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return { path, cards: rows.length, matched: cards.length, unmatched: Object.keys(asset.unmatched), releasedThrough };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    if (args[0] && !args[0].startsWith('--')) options.input = args.shift();
    while (args.length) {
      const option = args.shift();
      const value = args.shift();
      if (!value || value.startsWith('--') || !['--input', '--output', '--card-data'].includes(option)) {
        throw new Error('Usage: pnpm analytics:build [saved-response.json] [--input <file>] [--output <file>] [--card-data <catalogue.json>]');
      }
      options[option.slice(2)] = value;
    }
    const result = await buildCardStatistics(options.input, options.output, options['card-data']);
    console.log(`Prepared ${result.matched} matched cards through ${result.releasedThrough}: ${result.path}`);
    if (result.unmatched.length) console.log(`Unmatched names retained: ${result.unmatched.join(', ')}`);
    console.log('Upload this asset with the site. No live requests were made.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Statistics build failed.');
    process.exitCode = 1;
  }
}
