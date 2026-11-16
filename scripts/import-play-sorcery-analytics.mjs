#!/usr/bin/env node
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ANALYTICS_MAX_BYTES, matchAnalyticsCards, parseAnalyticsText } from '../src/data/playSorceryAnalytics.ts';
import { readCardCatalog } from './lib/card-catalog.mjs';

/** No transport or credentials: import a response saved by the signed-in browser. */
export async function importPlaySorceryAnalytics(input, output = 'offlineData/playsorcery/constructed.json', cataloguePath = 'public/assets/sorcery_cards.json') {
  if ((await stat(input)).size > ANALYTICS_MAX_BYTES) throw new Error('Analytics files must be smaller than 10 MB.');
  const snapshot = parseAnalyticsText(await readFile(input, 'utf8'));
  const catalogue = await readCardCatalog(cataloguePath);
  if (!catalogue.cards.length) throw new Error('The local card catalogue is empty. No output was changed.');
  const rows = matchAnalyticsCards(snapshot, catalogue.cards);
  const unmatched = rows.filter((row) => !row.catalogueName).map((row) => row.stats.cardName);
  const path = resolve(output);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return { path, cards: rows.length, matched: rows.length - unmatched.length, unmatched, releasedThrough: snapshot.data.releasedThrough };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const input = args.shift();
  let output;
  let catalogue;
  try {
    if (!input || input.startsWith('--')) throw new Error('Usage: pnpm analytics:import <saved-response.json> [--output <file>] [--card-data <catalogue.json>]');
    while (args.length) {
      const option = args.shift();
      const value = args.shift();
      if (!value || value.startsWith('--') || !['--output', '--card-data'].includes(option)) throw new Error('Expected --output <file> or --card-data <file>.');
      if (option === '--output') output = value;
      else catalogue = value;
    }
    const result = await importPlaySorceryAnalytics(input, output, catalogue);
    console.log(`Saved ${result.cards} cards (${result.matched} matched) through ${result.releasedThrough} to ${result.path}`);
    if (result.unmatched.length) console.log(`Unmatched names retained: ${result.unmatched.join(', ')}`);
    console.log('Open Card Stats → Import JSON in the app and select this file. No live requests were made.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Analytics import failed.');
    process.exitCode = 1;
  }
}
