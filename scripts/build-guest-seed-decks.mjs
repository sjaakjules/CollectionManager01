#!/usr/bin/env node

/**
 * Build the guest seed deck asset from a Curiosa deck archive.
 *
 * Converts archive entries (produced by `scripts/fetch-curiosa-decks.mjs`)
 * into app-shaped decks and writes them to a public asset. At startup the app
 * merges these decks into guest data once per deck id, so they are editable
 * fully offline and stay separate from the online Curiosa versions.
 *
 * Archive board maps (spellbook/atlas/collection/maybe, name -> quantity)
 * become app boards: spellbook + atlas fold into mainboard, collection is the
 * sideboard, maybe is the maybeboard, and the deck avatar becomes the avatar
 * board. Card names are canonicalized against the card catalog; unknown names
 * are kept verbatim and reported as warnings (never silently dropped).
 *
 * Usage:
 *   node scripts/build-guest-seed-decks.mjs \
 *     [--input offlineData/guestDecks.json] \
 *     [--output public/assets/guest_seed_decks.json] \
 *     [--card-data docs/Sorcery_CardInfo.json]
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_INPUT = 'offlineData/guestDecks.json';
const DEFAULT_OUTPUT = 'public/assets/guest_seed_decks.json';
const DEFAULT_CARD_DATA = 'docs/Sorcery_CardInfo.json';

// Must match the deck id convention used by `src/data/curiosaService.ts` so a
// pasted Curiosa URL and a seeded deck of the same source never duplicate.
const CURIOSA_DECK_ID_PREFIX = 'curiosa-';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeCardKey(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function buildCardNameLookup(cards) {
  const lookup = new Map();
  for (const card of cards) {
    if (typeof card?.name === 'string' && card.name.trim()) {
      lookup.set(normalizeCardKey(card.name), card.name);
    }
  }
  return lookup;
}

function convertBoardMap(boardMap, lookup, warnings, deckName, boardLabel) {
  const cards = [];
  if (!isRecord(boardMap)) return cards;
  for (const [rawName, rawQuantity] of Object.entries(boardMap)) {
    const quantity = Number(rawQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      warnings.push(
        `${deckName}: skipped "${rawName}" (${boardLabel}) with invalid quantity ${rawQuantity}`,
      );
      continue;
    }
    const canonical = lookup.get(normalizeCardKey(rawName));
    if (!canonical) {
      warnings.push(`${deckName}: unknown card "${rawName}" (${boardLabel}) kept verbatim`);
    }
    cards.push({ name: canonical ?? String(rawName), quantity: Math.floor(quantity) });
  }
  return cards;
}

/**
 * Convert one archive entry into an app-shaped seed deck.
 * Returns `{ deck, warnings }`.
 */
export function convertArchiveDeckToSeedDeck(deckId, deckinfo, lookup, nowIso) {
  const warnings = [];
  const name =
    typeof deckinfo?.name === 'string' && deckinfo.name.trim()
      ? deckinfo.name.trim()
      : `Curiosa deck ${deckId}`;

  const cards = isRecord(deckinfo?.cards) ? deckinfo.cards : {};
  const mainboard = [
    ...convertBoardMap(cards.spellbook, lookup, warnings, name, 'spellbook'),
    ...convertBoardMap(cards.atlas, lookup, warnings, name, 'atlas'),
  ];
  const sideboard = convertBoardMap(cards.collection, lookup, warnings, name, 'sideboard');
  const maybeboard = convertBoardMap(cards.maybe, lookup, warnings, name, 'maybeboard');

  const avatar = [];
  const avatarName = typeof deckinfo?.avatar === 'string' ? deckinfo.avatar.trim() : '';
  if (avatarName) {
    const canonical = lookup.get(normalizeCardKey(avatarName));
    if (!canonical) {
      warnings.push(`${name}: unknown avatar "${avatarName}" kept verbatim`);
    }
    avatar.push({ name: canonical ?? avatarName, quantity: 1 });
  } else {
    warnings.push(`${name}: no avatar recorded in archive`);
  }

  const createdAt =
    typeof deckinfo?.createdAt === 'string' ? deckinfo.createdAt : nowIso;
  const updatedAt =
    typeof deckinfo?.updatedAt === 'string' ? deckinfo.updatedAt : nowIso;

  const deck = {
    id: `${CURIOSA_DECK_ID_PREFIX}${deckId}`,
    name,
    boards: { mainboard, sideboard, avatar, maybeboard },
    createdAt,
    updatedAt,
  };
  const author = deckinfo?.user?.username;
  if (typeof author === 'string' && author.trim()) {
    deck.author = author.trim();
  }
  return { deck, warnings };
}

export function convertArchiveToSeedDecks(archive, cards, nowIso) {
  const lookup = buildCardNameLookup(cards);
  const decks = [];
  const warnings = [];
  for (const [deckId, entry] of Object.entries(archive)) {
    if (!isRecord(entry?.deckinfo)) {
      warnings.push(`${deckId}: archive entry has no deckinfo, skipped`);
      continue;
    }
    const result = convertArchiveDeckToSeedDeck(deckId, entry.deckinfo, lookup, nowIso);
    decks.push(result.deck);
    warnings.push(...result.warnings);
  }
  return { decks, warnings };
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    cardData: DEFAULT_CARD_DATA,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' || arg === '-i') {
      args.input = argv[++i];
    } else if (arg === '--output' || arg === '-o') {
      args.output = argv[++i];
    } else if (arg === '--card-data') {
      args.cardData = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.input || !args.output || !args.cardData) {
    throw new Error('--input, --output and --card-data require values');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const archive = JSON.parse(await fs.readFile(args.input, 'utf8'));
  const cards = JSON.parse(await fs.readFile(args.cardData, 'utf8'));
  if (!isRecord(archive)) {
    throw new Error(`Archive at ${args.input} is not an object keyed by deck id`);
  }
  if (!Array.isArray(cards)) {
    throw new Error(`Card data at ${args.cardData} is not an array`);
  }

  const nowIso = new Date().toISOString();
  const { decks, warnings } = convertArchiveToSeedDecks(archive, cards, nowIso);

  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(
    args.output,
    `${JSON.stringify({ generatedAt: nowIso, decks }, null, 2)}\n`,
  );

  for (const warning of warnings) {
    console.warn(`warning: ${warning}`);
  }
  console.log(
    `Wrote ${decks.length} seed deck${decks.length === 1 ? '' : 's'} to ${args.output}` +
      (warnings.length > 0 ? ` (${warnings.length} warnings)` : ''),
  );
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  });
}
