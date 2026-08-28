#!/usr/bin/env node

/**
 * Copy the card catalog snapshot into public assets.
 *
 * The app uses this bundled copy as a last-resort card database when the
 * network is unavailable and no cached catalog exists yet (offline-first run).
 *
 * Usage:
 *   node scripts/copy-card-snapshot.mjs [--input docs/Sorcery_CardInfo.json] [--output public/assets/sorcery_cards.json]
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_INPUT = 'docs/Sorcery_CardInfo.json';
const DEFAULT_OUTPUT = 'public/assets/sorcery_cards.json';

function parseArgs(argv) {
  const args = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' || arg === '-i') {
      args.input = argv[++i];
    } else if (arg === '--output' || arg === '-o') {
      args.output = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.input || !args.output) {
    throw new Error('Both --input and --output require values');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await fs.readFile(args.input, 'utf8');
  const cards = JSON.parse(raw);
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error(`Card snapshot at ${args.input} is not a non-empty array`);
  }
  for (const card of cards.slice(0, 5)) {
    if (typeof card?.name !== 'string' || typeof card?.guardian !== 'object') {
      throw new Error(`Card snapshot at ${args.input} does not look like Card[]`);
    }
  }
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, raw);
  console.log(`Copied ${cards.length} cards: ${args.input} -> ${args.output}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
