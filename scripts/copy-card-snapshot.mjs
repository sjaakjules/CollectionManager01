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
import { readCardCatalog } from './lib/card-catalog.mjs';

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
  const { cards, issues } = await readCardCatalog(args.input);
  if (issues.length > 0) {
    throw new Error(`Snapshot was not replaced. Review catalog issues first:\n${JSON.stringify(issues, null, 2)}`);
  }
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  const temporary = `${args.output}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(cards, null, 2)}\n`);
    await fs.rename(temporary, args.output);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  console.log(`Validated and copied ${cards.length} cards: ${args.input} -> ${args.output}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
