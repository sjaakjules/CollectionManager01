#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  SORCERY_DECK_ORIGIN, buildDeckRequestInput, extractDeckId,
  parseSorceryDeck, readDeckResponse,
} from '../src/data/sorceryDeckSource.ts';
export { extractDeckId } from '../src/data/sorceryDeckSource.ts';
const CURIOSA_ORIGIN = SORCERY_DECK_ORIGIN;

import { createSorceryClient, SORCERY_MIN_INTERVAL_MS as LOCAL_REFILL_MS,
  SORCERY_LOW_REMAINING as LOW_REMAINING_THRESHOLD,
  SORCERY_SAFE_REMAINING as SAFE_REMAINING_TARGET } from '../src/data/sorceryRequest.ts';
import { nodeSorceryClient } from './lib/sorcery-client.ts';
import { sorceryInterrupt } from './lib/sorcery-interrupt.mjs';

const DEFAULT_CARD_DATA_PATH = 'public/assets/sorcery_cards.json';
const DEFAULT_APP_ARCHIVE_PATH = 'offlineData/deckArchive.json';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value) {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeCardKey(name) {
  return normalizeText(name).toLowerCase();
}

function parseQuantity(value) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : 1;

  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.floor(parsed));
}

function sumCardMap(cards) {
  return Object.values(cards).reduce((sum, quantity) => sum + quantity, 0);
}

function compareDates(left, right) {
  const leftMs = Date.parse(left ?? '');
  const rightMs = Date.parse(right ?? '');
  const safeLeft = Number.isFinite(leftMs) ? leftMs : 0;
  const safeRight = Number.isFinite(rightMs) ? rightMs : 0;
  return safeLeft - safeRight;
}

function addCardQuantity(cards, name, quantity) {
  const cleanName = normalizeText(name);
  if (!cleanName) return;
  cards[cleanName] = (cards[cleanName] ?? 0) + parseQuantity(quantity);
}

function sortUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function trimBaseUrl(baseUrl) {
  return (baseUrl || CURIOSA_ORIGIN).replace(/\/+$/g, '');
}


function defaultHeaders(extraHeaders = {}) {
  return {
    origin: CURIOSA_ORIGIN,
    referer: `${CURIOSA_ORIGIN}/`,
    'user-agent': 'SorceryStacks/1.0',
    ...extraHeaders,
  };
}

async function readCuriosaError(response) {
  const body = await response.text();

  try {
    const parsed = JSON.parse(body);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      const record = isRecord(entry) ? entry : null;
      const error = isRecord(record?.error) ? record.error : null;
      const errorJson = isRecord(error?.json) ? error.json : null;
      const message = readString(errorJson?.message);
      if (message) return message;
    }
  } catch {
    // Fall through to the raw response body.
  }

  return body.trim() || response.statusText || 'Unknown error';
}

export function extractDeckInputs(inputJson, sourcePath, options = {}) {
  const limitPerFile = Number.isSafeInteger(options.limitPerFile)
    ? options.limitPerFile
    : 0;
  const inputs = [];

  if (isRecord(inputJson) && Array.isArray(inputJson.decks)) {
    const deckEntries =
      limitPerFile > 0 ? inputJson.decks.slice(0, limitPerFile) : inputJson.decks;

    for (let index = 0; index < deckEntries.length; index += 1) {
      const deck = deckEntries[index];
      if (!isRecord(deck)) continue;

      const id = extractDeckId(readString(deck.id) ?? '');
      if (!id) continue;

      inputs.push({
        id,
        sourcePath,
        sourceIndex: index,
        raw: deck.id,
        hint: {
          id,
          createdAt: readString(deck.createdAt),
          updatedAt: readString(deck.updatedAt),
          name: readString(deck.name),
          format: readString(deck.format),
          primer: deck.primer ?? null,
          hotscore: readNumber(deck.hotscore),
          user: isRecord(deck.user) ? deck.user : undefined,
          elements: Array.isArray(deck.elements) ? deck.elements.filter((v) => typeof v === 'string') : undefined,
          competitive: isRecord(deck.competitive) ? deck.competitive : undefined,
        },
      });
    }

    return inputs;
  }

  const deckList = isRecord(inputJson) && Array.isArray(inputJson.Decks)
    ? inputJson.Decks
    : Array.isArray(inputJson)
      ? inputJson
      : [];
  const entries = limitPerFile > 0 ? deckList.slice(0, limitPerFile) : deckList;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const raw = typeof entry === 'string' || typeof entry === 'number'
      ? String(entry)
      : isRecord(entry)
        ? readString(entry.id) ?? readString(entry.url) ?? readString(entry.deckUrl) ?? ''
        : '';
    const id = extractDeckId(raw);
    if (!id) continue;

    inputs.push({
      id,
      sourcePath,
      sourceIndex: index,
      raw,
      hint: { id },
    });
  }

  return inputs;
}

export function dedupeDeckInputs(inputs) {
  const byId = new Map();

  for (const input of inputs) {
    const existing = byId.get(input.id);
    if (!existing) {
      byId.set(input.id, input);
      continue;
    }

    byId.set(input.id, {
      ...existing,
      hint: {
        ...input.hint,
        ...existing.hint,
      },
    });
  }

  return [...byId.values()];
}

export function buildCardTypeLookup(cards) {
  const lookup = new Map();

  for (const card of Array.isArray(cards) ? cards : []) {
    if (!isRecord(card)) continue;
    const name = readString(card.name);
    const guardian = isRecord(card.engine) ? card.engine : isRecord(card.guardian) ? card.guardian : null;
    const type = readString(guardian?.type);
    const key = normalizeCardKey(name);
    if (key && type && !lookup.has(key)) {
      lookup.set(key, type);
    }
  }

  return lookup;
}

export function splitDeckBoards(boards, cardTypeLookup) {
  const cards = {
    spellbook: {},
    atlas: {},
    collection: {},
    maybe: {},
  };
  const unknownMainboardCards = [];

  for (const deckCard of boards.mainboard ?? []) {
    const name = normalizeText(deckCard.name);
    if (!name) continue;

    const cardType = cardTypeLookup.get(normalizeCardKey(name));
    if (!cardType) {
      unknownMainboardCards.push(name);
      continue;
    }

    if (cardType === 'Site') {
      addCardQuantity(cards.atlas, name, deckCard.quantity);
    } else {
      addCardQuantity(cards.spellbook, name, deckCard.quantity);
    }
  }

  for (const deckCard of boards.collection ?? boards.sideboard ?? []) {
    addCardQuantity(cards.collection, deckCard.name, deckCard.quantity);
  }

  for (const deckCard of boards.maybeboard ?? []) {
    addCardQuantity(cards.maybe, deckCard.name, deckCard.quantity);
  }

  return {
    cards,
    cardCount: {
      spellbook: sumCardMap(cards.spellbook),
      atlas: sumCardMap(cards.atlas),
      collection: sumCardMap(cards.collection),
      maybe: sumCardMap(cards.maybe),
    },
    unknownMainboardCards: sortUnique(unknownMainboardCards),
  };
}

export function validateArchiveDeck(splitBoards) {
  const errors = [];

  for (const cardName of splitBoards.unknownMainboardCards) {
    errors.push({
      type: 'UNKNOWN_MAINBOARD_CARD',
      cardName,
      message: `Unknown mainboard card: ${cardName}`,
    });
  }

  if (splitBoards.cardCount.spellbook < 60) {
    errors.push({
      type: 'SPELLBOOK_TOO_SMALL',
      count: splitBoards.cardCount.spellbook,
      message: `Spellbook has ${splitBoards.cardCount.spellbook} cards; expected at least 60`,
    });
  }

  if (splitBoards.cardCount.atlas < 30) {
    errors.push({
      type: 'ATLAS_TOO_SMALL',
      count: splitBoards.cardCount.atlas,
      message: `Atlas has ${splitBoards.cardCount.atlas} cards; expected at least 30`,
    });
  }

  return errors;
}

export function buildArchiveDeck(fetchedDeck, sourceHint, cardTypeLookup) {
  const splitBoards = splitDeckBoards(fetchedDeck.boards, cardTypeLookup);
  const errors = validateArchiveDeck(splitBoards);
  const metadata = {
    ...sourceHint,
    ...fetchedDeck.metadata,
  };
  const now = new Date().toISOString();

  return {
    errors,
    deckinfo: {
      id: fetchedDeck.id,
      createdAt: metadata.createdAt ?? now,
      updatedAt: metadata.updatedAt ?? now,
      name: metadata.name ?? 'Imported Deck',
      format: metadata.format ?? 'Unknown',
      primer: metadata.primer ?? null,
      hotscore: metadata.hotscore ?? 0,
      user: metadata.user ?? {},
      elements: metadata.elements ?? [],
      cardCount: splitBoards.cardCount,
      avatar: fetchedDeck.boards.avatar?.[0]?.name ?? '',
      cards: splitBoards.cards,
      ...(isRecord(metadata.competitive) ? { competitive: metadata.competitive } : {}),
    },
  };
}

export function mergeCompetitiveAnnotation(deckinfo, sourceHint) {
  if (!isRecord(deckinfo) || !isRecord(sourceHint?.competitive)) {
    return { deckinfo, changed: false };
  }

  if (JSON.stringify(deckinfo.competitive) === JSON.stringify(sourceHint.competitive)) {
    return { deckinfo, changed: false };
  }

  return {
    deckinfo: {
      ...deckinfo,
      competitive: sourceHint.competitive,
    },
    changed: true,
  };
}

export function mergeDeckIntoArchive(archive, deckinfo) {
  const existing = archive[deckinfo.id]?.deckinfo;

  if (existing && compareDates(deckinfo.updatedAt, existing.updatedAt) <= 0) {
    return {
      archive,
      status: 'skipped-up-to-date',
      changed: false,
    };
  }

  return {
    archive: {
      ...archive,
      [deckinfo.id]: { deckinfo },
    },
    status: existing ? 'updated' : 'added',
    changed: true,
  };
}

export function prioritizeDeckInputs(inputs, archive, skippedArchive) {
  const newInputs = [];
  const existingInputs = [];
  const skippedInputs = [];

  for (const input of inputs) {
    if (isRecord(archive[input.id]?.deckinfo)) {
      existingInputs.push(input);
    } else if (isRecord(skippedArchive[input.id])) {
      skippedInputs.push(input);
    } else {
      newInputs.push(input);
    }
  }

  return [...newInputs, ...existingInputs, ...skippedInputs];
}

export function isPreviouslyProcessed(input, archive, skippedArchive) {
  return isRecord(archive[input.id]?.deckinfo) || isRecord(skippedArchive[input.id]);
}

function buildSkippedDeckEntry({
  input,
  status,
  reason,
  errors = [],
  deckinfo = null,
  previousEntry = null,
  now,
}) {
  return {
    id: input.id,
    status,
    reason,
    skippedAt: now,
    attempts: (Number.isSafeInteger(previousEntry?.attempts) ? previousEntry.attempts : 0) + 1,
    source: {
      path: input.sourcePath,
      index: input.sourceIndex,
      raw: input.raw,
    },
    hint: input.hint,
    deckinfo,
    errors: errors.map((error) => ({
      type: error.type,
      cardName: error.cardName,
      count: error.count,
      message: formatValidationErrorMessage(error),
    })),
  };
}

/** Historical name; live maintenance work shares the host-wide SorceryTCG limiter. */
export function createCuriosaClient(options = {}) {
  // Tests inject an entirely offline transport, never a faster live interval.
  return options.fetchImpl ? createSorceryClient({
    fetchImpl: options.fetchImpl, nowImpl: options.nowImpl, sleepImpl: options.sleepImpl,
  }) : nodeSorceryClient;
}

export async function fetchCuriosaDeckFromCuriosa(urlOrId, client, options = {}) {
  const deckId = extractDeckId(urlOrId);
  if (!deckId) throw new Error(`Invalid SorceryTCG or Curiosa deck ID or URL: ${urlOrId}`);
  const baseUrl = trimBaseUrl(options.curiosaBaseUrl ?? CURIOSA_ORIGIN);
  const input = encodeURIComponent(JSON.stringify(buildDeckRequestInput(deckId)));
  const response = await client.fetch(
    `${baseUrl}/api/trpc/deck.get?batch=1&input=${input}`,
    { headers: defaultHeaders({ accept: 'application/json' }) },
    { ...options, deckId, requestKind: 'deck-trpc' },
  );
  if (!response.ok) {
    const message = await readCuriosaError(response);
    throw new Error(`SorceryTCG API error ${response.status}: ${message}`);
  }
  return parseSorceryDeck(readDeckResponse(await response.json()), deckId);
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readJsonFileIfPresent(filePath) {
  try {
    return await readJsonFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextFile(filePath, lines) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${lines.join('\n')}\n`);
}

function parsePositiveInt(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flagName}: ${value}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Fetch SorceryTCG decks into a local archive JSON.

Usage:
  node scripts/fetch-curiosa-decks.mjs --input tmp/Search_SCG.json --input tmp/decks.json --output tmp/deckArchive.test.json --limit-per-file 2

Options:
  -i, --input <file>          Input JSON file. Can be repeated.
  -o, --output <file>         Output archive JSON file.
      --log <file>            Log file path. Defaults to <output>.log.
      --skipped-output <file> Save failed/invalid decks. Defaults to <output>.skipped.json.
      --card-data <file>      Card catalog JSON. Defaults to ${DEFAULT_CARD_DATA_PATH}.
      --sorcery-base-url <url> Defaults to ${CURIOSA_ORIGIN}.
      --limit-per-file <n>    Process only the first n entries from each input file.
      --skip-processed        Skip IDs already in the output or skipped-output archives.
      --rebuild-lookup        Rebuild the app deck lookup after archiving.
      --no-rebuild-lookup     Skip the automatic rebuild for offlineData/deckArchive.json.
  -h, --help                  Show this help.
`);
}

export function parseArgs(argv) {
  const options = {
    inputs: [],
    output: '',
    log: '',
    skippedOutput: '',
    cardData: DEFAULT_CARD_DATA_PATH,
    curiosaBaseUrl: CURIOSA_ORIGIN,
    limitPerFile: 0,
    skipProcessed: false,
    rebuildLookup: false,
    help: false,
  };
  let rebuildLookupOverride = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--skip-processed') {
      options.skipProcessed = true;
      continue;
    }

    if (arg === '--rebuild-lookup') {
      rebuildLookupOverride = true;
      continue;
    }

    if (arg === '--no-rebuild-lookup') {
      rebuildLookupOverride = false;
      continue;
    }

    const next = argv[index + 1];
    if (!next) throw new Error(`Missing value for ${arg}`);

    if (arg === '-i' || arg === '--input') {
      options.inputs.push(next);
      index += 1;
      continue;
    }

    if (arg === '--skipped-output') {
      options.skippedOutput = next;
      index += 1;
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      options.output = next;
      index += 1;
      continue;
    }

    if (arg === '--log') {
      options.log = next;
      index += 1;
      continue;
    }

    if (arg === '--card-data') {
      options.cardData = next;
      index += 1;
      continue;
    }

    if (arg === '--sorcery-base-url' || arg === '--curiosa-base-url') {
      options.curiosaBaseUrl = next;
      index += 1;
      continue;
    }

    if (arg === '--limit-per-file') {
      options.limitPerFile = parsePositiveInt(next, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.help) {
    if (options.inputs.length === 0) throw new Error('At least one --input file is required');
    if (!options.output) throw new Error('--output is required');
  }

  if (!options.log && options.output) {
    options.log = `${options.output}.log`;
  }

  if (!options.skippedOutput && options.output) {
    options.skippedOutput = `${options.output}.skipped.json`;
  }

  const targetsAppArchive = options.output
    ? path.resolve(options.output) === path.resolve(DEFAULT_APP_ARCHIVE_PATH)
    : false;
  options.rebuildLookup = rebuildLookupOverride ?? targetsAppArchive;

  return options;
}

function formatErrorLines(deckId, errors) {
  const lines = [];

  for (const error of errors) {
    if (error.type === 'UNKNOWN_MAINBOARD_CARD') {
      lines.push(`error ${deckId} unknown-mainboard-card "${error.cardName}"`);
    } else if (error.type === 'SPELLBOOK_TOO_SMALL') {
      lines.push(`error ${deckId} minimum-spellbook expected>=60 actual=${error.count}`);
    } else if (error.type === 'ATLAS_TOO_SMALL') {
      lines.push(`error ${deckId} minimum-atlas expected>=30 actual=${error.count}`);
    } else {
      lines.push(`error ${deckId} ${error.message}`);
    }
  }

  return lines;
}

function formatValidationErrorMessage(error) {
  if (error.type === 'UNKNOWN_MAINBOARD_CARD') {
    return `unknown-mainboard-card "${error.cardName}"`;
  }

  if (error.type === 'SPELLBOOK_TOO_SMALL') {
    return `minimum-spellbook expected>=60 actual=${error.count}`;
  }

  if (error.type === 'ATLAS_TOO_SMALL') {
    return `minimum-atlas expected>=30 actual=${error.count}`;
  }

  return error.message;
}

function formatValidationSummary(errors) {
  return errors.map((error) => formatValidationErrorMessage(error)).join('; ');
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';

  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, '0')}m`;
  }

  if (minutes > 0) {
    return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  }

  return `${seconds}s`;
}

function formatCardCountValue(value) {
  return Number.isFinite(value) ? String(value) : 'n/a';
}

function formatCardCounts(cardCount) {
  return [
    `spellbook=${formatCardCountValue(cardCount?.spellbook)}`,
    `atlas=${formatCardCountValue(cardCount?.atlas)}`,
    `collection=${formatCardCountValue(cardCount?.collection)}`,
    `maybe=${formatCardCountValue(cardCount?.maybe)}`,
  ].join(' ');
}

function formatNullable(value) {
  return value === null || value === undefined ? 'n/a' : String(value);
}

function formatMaybeIsoMs(value) {
  if (value === null || value === undefined) return 'n/a';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'n/a';
}

function formatMaybeSeconds(value) {
  if (value === null || value === undefined) return 'none';
  return `${Math.ceil(value / 1000)}s`;
}

export function formatCuriosaHealthLine(event) {
  if (event.type === 'connection') {
    return [
      'curiosa-health connection=direct',
      `host=${event.host}`,
      `origin=${JSON.stringify(event.origin)}`,
      `referer=${JSON.stringify(event.referer)}`,
      'serialized=true',
      `local-spacing=${event.localRefillMs}ms`,
      `low-remaining<=${event.lowRemainingThreshold}`,
      `safe-remaining-target=${event.safeRemainingTarget}`,
      'retry-after=honored',
    ].join(' ');
  }

  const rateLimit = event.rateLimitLimit !== null && event.rateLimitRemaining !== null
    ? `${event.rateLimitRemaining}/${event.rateLimitLimit}`
    : 'n/a';
  const proxyDelay = event.proxyDelayMs !== null && event.proxyDelayMs !== undefined
    ? `${event.proxyDelayMs}ms:${event.proxyDelayReason}`
    : 'none';

  return [
    'curiosa-health response',
    `deck=${formatNullable(event.deckId)}`,
    `request=${formatNullable(event.requestKind)}`,
    `status=${event.status}`,
    `ok=${event.ok}`,
    `rate-limit=${rateLimit}`,
    `reset=${formatMaybeIsoMs(event.rateLimitResetMs)}`,
    `retry-after=${formatMaybeSeconds(event.retryAfterMs)}`,
    `proxy-delay=${proxyDelay}`,
  ].join(' ');
}

export function formatProgressLine({
  processed,
  total,
  summary,
  lastDeck,
  elapsedMs,
}) {
  const remaining = Math.max(0, total - processed);
  const averageMs = processed > 0 ? elapsedMs / processed : 0;
  const etaMs = processed > 0 ? averageMs * remaining : Number.NaN;
  const lastDeckName = normalizeText(lastDeck?.name) || 'unknown';

  return [
    `progress ${processed}/${total}`,
    `elapsed=${formatDuration(elapsedMs)}`,
    `eta=${formatDuration(etaMs)}`,
    `added=${summary.added}`,
    `updated=${summary.updated}`,
    `annotated=${summary.annotated ?? 0}`,
    `skipped-up-to-date=${summary.skippedUpToDate}`,
    `skipped-invalid=${summary.skippedInvalid}`,
    `skipped-processed=${summary.skippedProcessed ?? 0}`,
    `failed=${summary.failed}`,
    `last=${JSON.stringify(lastDeckName)}`,
    formatCardCounts(lastDeck?.cardCount),
  ].join(' ');
}

function formatDashboardProgress({ processed, total, summary, elapsedMs }) {
  const remaining = Math.max(0, total - processed);
  const averageMs = processed > 0 ? elapsedMs / processed : 0;
  const etaMs = processed > 0 ? averageMs * remaining : Number.NaN;

  return [
    'Progress',
    `${processed}/${total}`,
    `elapsed=${formatDuration(elapsedMs)}`,
    `eta=${formatDuration(etaMs)}`,
    `added=${summary.added}`,
    `updated=${summary.updated}`,
    `annotated=${summary.annotated ?? 0}`,
    `skipped-up-to-date=${summary.skippedUpToDate}`,
    `skipped-invalid=${summary.skippedInvalid}`,
    `skipped-processed=${summary.skippedProcessed ?? 0}`,
    `failed=${summary.failed}`,
  ].join('\t');
}

function formatDashboardWaiting(waiting) {
  if (!waiting || waiting.remainingMs <= 0) {
    return ['Waiting', '-'].join('\t');
  }

  const seconds = Math.max(0, Math.ceil(waiting.remainingMs / 1000));
  const elapsedSeconds = Math.max(
    0,
    Math.floor((waiting.delayMs - waiting.remainingMs) / 1000),
  );
  const dots = '.'.repeat((elapsedSeconds % 3) + 1);

  return [
    'Waiting',
    'on curiosa',
    `deck=${formatNullable(waiting.deckId)}`,
    `${seconds}s${dots}`,
    `reason=${waiting.reason}`,
  ].join('\t');
}

function formatDashboardHealth(health) {
  if (!health) {
    return ['Curiosa', '-'].join('\t');
  }

  if (health.type === 'connection') {
    return [
      'Curiosa',
      'connection=direct',
      `host=${health.host}`,
      'serialized=true',
      `local-spacing=${health.localRefillMs}ms`,
      'retry-after=honored',
    ].join('\t');
  }

  const rateLimit = health.rateLimitLimit !== null && health.rateLimitRemaining !== null
    ? `${health.rateLimitRemaining}/${health.rateLimitLimit}`
    : 'n/a';
  const proxyDelay = health.proxyDelayMs !== null && health.proxyDelayMs !== undefined
    ? `${health.proxyDelayMs}ms:${health.proxyDelayReason}`
    : 'none';

  return [
    'Curiosa',
    `request=${formatNullable(health.requestKind)}`,
    `status=${health.status}`,
    `ok=${health.ok}`,
    `rate-limit=${rateLimit}`,
    `reset=${formatMaybeIsoMs(health.rateLimitResetMs)}`,
    `retry-after=${formatMaybeSeconds(health.retryAfterMs)}`,
    `proxy-delay=${proxyDelay}`,
  ].join('\t');
}

function formatDashboardLast(lastDeck) {
  if (!lastDeck) {
    return ['Last', '-'].join('\t');
  }

  return [
    'Last',
    formatNullable(lastDeck.id),
    JSON.stringify(normalizeText(lastDeck.name) || 'unknown'),
  ].join('\t');
}

function formatDashboardResult(result) {
  if (!result) {
    return ['Result', '-'].join('\t');
  }

  return [
    'Result',
    `${result.status}:`,
    result.message || '-',
  ].join('\t');
}

function formatDashboardDeck(lastDeck) {
  if (!lastDeck) {
    return ['Deck', '-'].join('\t');
  }

  return [
    'Deck',
    `avatar=${JSON.stringify(normalizeText(lastDeck.avatar) || '')}`,
    ...formatCardCounts(lastDeck.cardCount).split(' '),
  ].join('\t');
}

export function formatDashboardLines(state) {
  return [
    formatDashboardProgress(state),
    formatDashboardWaiting(state.waiting),
    formatDashboardHealth(state.health),
    formatDashboardLast(state.lastDeck),
    formatDashboardResult(state.result),
    formatDashboardDeck(state.lastDeck),
  ];
}

function createLiveDashboard({ enabled, stdout }) {
  let renderedLineCount = 0;

  return {
    enabled,
    render(lines) {
      if (!enabled) return;

      if (renderedLineCount > 0) {
        stdout.write(`\x1b[${renderedLineCount}A`);
      }

      for (const line of lines) {
        stdout.write(`\x1b[2K${line}\n`);
      }

      renderedLineCount = lines.length;
    },
  };
}

async function loadDeckInputs(inputPaths, limitPerFile) {
  const allInputs = [];

  for (const inputPath of inputPaths) {
    const inputJson = await readJsonFile(inputPath);
    allInputs.push(...extractDeckInputs(inputJson, inputPath, { limitPerFile }));
  }

  return dedupeDeckInputs(allInputs);
}

export async function runArchive(options, dependencies = {}) {
  const skippedOutput = options.skippedOutput || `${options.output}.skipped.json`;
  const logLines = [];
  const cardData = dependencies.cardData ?? await readJsonFile(options.cardData);
  const cardTypeLookup = buildCardTypeLookup(cardData);
  const loadedInputs = dependencies.inputs ?? await loadDeckInputs(options.inputs, options.limitPerFile);
  let archive = dependencies.archive ?? await readJsonFileIfPresent(options.output);
  let skippedArchive = dependencies.skippedArchive
    ?? await readJsonFileIfPresent(skippedOutput);

  if (!isRecord(archive)) {
    throw new Error(`Output archive is not a JSON object: ${options.output}`);
  }
  if (!isRecord(skippedArchive)) {
    throw new Error(`Skipped archive is not a JSON object: ${skippedOutput}`);
  }

  const inputs = prioritizeDeckInputs(loadedInputs, archive, skippedArchive);
  const writeJson = dependencies.writeJsonFile ?? writeJsonFile;
  const writeText = dependencies.writeTextFile ?? writeTextFile;
  const exitProcess = dependencies.exitProcess ?? ((code) => process.exit(code));

  const client = dependencies.curiosaClient ?? createCuriosaClient();
  const fetchDeck = dependencies.fetchDeck ?? fetchCuriosaDeckFromCuriosa;
  const summary = {
    added: 0,
    updated: 0,
    annotated: 0,
    skippedUpToDate: 0,
    skippedInvalid: 0,
    skippedProcessed: 0,
    failed: 0,
  };
  const nowImpl = dependencies.nowImpl ?? (() => Date.now());
  const startedAtMs = nowImpl();
  let processed = 0;
  const stdout = dependencies.stdout ?? process.stdout;
  const liveDashboard = createLiveDashboard({
    enabled: dependencies.liveDashboard ?? Boolean(stdout.isTTY && !process.env.CI),
    stdout,
  });
  const dashboardState = {
    processed,
    total: inputs.length,
    summary,
    elapsedMs: 0,
    waiting: null,
    health: null,
    lastDeck: null,
    result: null,
  };
  let flushPromise = Promise.resolve();

  function flushArchive() {
    const runFlush = async () => {
      await writeJson(options.output, archive);
      await writeJson(skippedOutput, skippedArchive);
      await writeText(options.log, logLines);
    };

    flushPromise = flushPromise.then(runFlush, runFlush);
    return flushPromise;
  }

  function renderDashboard() {
    dashboardState.processed = processed;
    dashboardState.elapsedMs = nowImpl() - startedAtMs;
    liveDashboard.render(formatDashboardLines(dashboardState));
  }

  function emitLine(line, stream = 'log') {
    logLines.push(line);
    if (liveDashboard.enabled) return;
    if (stream === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  function emitProgress(lastDeck) {
    processed += 1;
    dashboardState.waiting = null;
    dashboardState.lastDeck = lastDeck;
    emitLine(formatProgressLine({
      processed,
      total: inputs.length,
      summary,
      lastDeck,
      elapsedMs: nowImpl() - startedAtMs,
    }));
    renderDashboard();
  }

  function recordHealth(health) {
    if (health.type === 'response') {
      dashboardState.waiting = null;
    }
    dashboardState.health = health;
    emitLine(formatCuriosaHealthLine(health));
    renderDashboard();
  }

  function recordWaiting(waiting) {
    dashboardState.waiting = waiting.remainingMs > 0 ? waiting : null;
    renderDashboard();
  }

  const interrupt = sorceryInterrupt(dependencies.handleSignals);

  try {
    recordHealth({
      type: 'connection',
      host: new URL(CURIOSA_ORIGIN).host,
      origin: CURIOSA_ORIGIN,
      referer: `${CURIOSA_ORIGIN}/`,
      localRefillMs: LOCAL_REFILL_MS,
      lowRemainingThreshold: LOW_REMAINING_THRESHOLD,
      safeRemainingTarget: SAFE_REMAINING_TARGET,
    });
    dashboardState.result = {
      status: 'processing',
      message: `${inputs.length} decks queued (${loadedInputs.length} input IDs)`,
    };
    emitLine(`processing ${inputs.length} decks`);
    renderDashboard();

    for (const input of inputs) {
      interrupt.signal.throwIfAborted();
      if (options.skipProcessed && isPreviouslyProcessed(input, archive, skippedArchive)) {
        const existing = archive[input.id]?.deckinfo;
        const skippedEntry = skippedArchive[input.id];
        const line = `skipped-processed ${input.id}`;
        emitLine(line);
        summary.skippedProcessed += 1;
        dashboardState.result = {
          status: 'skipped-processed',
          message: existing ? 'already in output archive' : `already in skipped archive (${skippedEntry.status ?? 'skipped'})`,
        };
        emitProgress({
          id: input.id,
          name: existing?.name ?? skippedEntry?.deckinfo?.name ?? input.hint.name ?? input.id,
          avatar: existing?.avatar ?? skippedEntry?.deckinfo?.avatar ?? '',
          cardCount: existing?.cardCount ?? skippedEntry?.deckinfo?.cardCount ?? null,
        });
        await flushArchive();
        continue;
      }

      let existing = archive[input.id]?.deckinfo;
      let annotationChanged = false;
      if (existing) {
        const annotation = mergeCompetitiveAnnotation(existing, input.hint);
        if (annotation.changed) {
          existing = annotation.deckinfo;
          archive = {
            ...archive,
            [input.id]: { deckinfo: existing },
          };
          annotationChanged = true;
          summary.annotated += 1;
        }
      }
      if (
        existing &&
        input.hint.updatedAt &&
        compareDates(input.hint.updatedAt, existing.updatedAt) <= 0
      ) {
        const line = `skipped-up-to-date ${input.id}`;
        emitLine(line);
        summary.skippedUpToDate += 1;
        if (skippedArchive[input.id]) {
          skippedArchive = { ...skippedArchive };
          delete skippedArchive[input.id];
        }
        dashboardState.result = {
          status: 'skipped-up-to-date',
          message: annotationChanged
            ? 'competitive metadata refreshed; source updatedAt is not newer'
            : 'source updatedAt is not newer',
        };
        emitProgress({
          id: input.id,
          name: existing.name ?? input.hint.name ?? input.id,
          avatar: existing.avatar,
          cardCount: existing.cardCount,
        });
        await flushArchive();
        continue;
      }

      try {
        const fetchedDeck = await fetchDeck(input.raw || input.id, client, {
          curiosaBaseUrl: options.curiosaBaseUrl,
          signal: interrupt.signal,
          onHealth: (health) => {
            recordHealth(health);
          },
          onDelay: (delay) => {
            const seconds = Math.ceil(delay.delayMs / 1000);
            const line = `wait ${input.id} ${seconds}s ${delay.reason}`;
            emitLine(line);
          },
          onWait: (waiting) => {
            recordWaiting(waiting);
          },
        });
        interrupt.signal.throwIfAborted();
        const { deckinfo, errors } = buildArchiveDeck(fetchedDeck, input.hint, cardTypeLookup);

        if (errors.length > 0) {
          const line = `skipped-invalid ${input.id} "${deckinfo.name}"`;
          emitLine(line);
          for (const errorLine of formatErrorLines(input.id, errors)) {
            emitLine(errorLine);
          }
          summary.skippedInvalid += 1;
          skippedArchive = {
            ...skippedArchive,
            [input.id]: buildSkippedDeckEntry({
              input,
              status: 'skipped-invalid',
              reason: formatValidationSummary(errors),
              errors,
              deckinfo,
              previousEntry: skippedArchive[input.id],
              now: new Date(nowImpl()).toISOString(),
            }),
          };
          dashboardState.result = {
            status: 'skipped-invalid',
            message: formatValidationSummary(errors),
          };
          emitProgress({
            id: input.id,
            name: deckinfo.name,
            avatar: deckinfo.avatar,
            cardCount: deckinfo.cardCount,
          });
          await flushArchive();
          continue;
        }

        const result = mergeDeckIntoArchive(archive, deckinfo);
        archive = result.archive;
        if (result.changed && skippedArchive[input.id]) {
          skippedArchive = { ...skippedArchive };
          delete skippedArchive[input.id];
        }
        const countText = formatCardCounts(deckinfo.cardCount);
        const line = `${result.status} ${input.id} "${deckinfo.name}" ${countText}`;
        emitLine(line);

        if (result.status === 'added') summary.added += 1;
        if (result.status === 'updated') summary.updated += 1;
        if (result.status === 'skipped-up-to-date') summary.skippedUpToDate += 1;
        dashboardState.result = {
          status: result.status,
          message: result.changed ? 'archive written' : 'source updatedAt is not newer',
        };
        emitProgress({
          id: input.id,
          name: deckinfo.name,
          avatar: deckinfo.avatar,
          cardCount: deckinfo.cardCount,
        });
        await flushArchive();
      } catch (error) {
        if (interrupt.signal.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        const line = `failed ${input.id} ${message}`;
        emitLine(line, 'error');
        summary.failed += 1;
        skippedArchive = {
          ...skippedArchive,
          [input.id]: buildSkippedDeckEntry({
            input,
            status: 'failed',
            reason: message,
            previousEntry: skippedArchive[input.id],
            now: new Date(nowImpl()).toISOString(),
          }),
        };
        dashboardState.result = {
          status: 'failed',
          message,
        };
        emitProgress({
          id: input.id,
          name: input.hint.name ?? input.id,
          avatar: '',
          cardCount: null,
        });
        await flushArchive();
      }
    }

    await flushArchive();
    interrupt.signal.throwIfAborted();

    return {
      archive,
      skippedArchive,
      logLines,
      summary,
    };
  } catch (error) {
    if (!interrupt.signal.aborted) throw error;
    emitLine('interrupted: flushing archives after request cleanup', 'error');
    await flushArchive();
    exitProcess(interrupt.exitCode);
    throw interrupt.signal.reason;
  } finally {
    interrupt.dispose();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await runArchive(options, { handleSignals: true });
  let lookupResult = null;
  if (options.rebuildLookup) {
    const module = await import('./build-deck-style-associations.mjs');
    lookupResult = await module.runDeckStyleAssociationBuild({
      archivePath: options.output,
      cardDataPath: options.cardData,
    });
  }
  console.log(
    `Done: added=${result.summary.added} updated=${result.summary.updated} annotated=${result.summary.annotated} skipped-up-to-date=${result.summary.skippedUpToDate} skipped-invalid=${result.summary.skippedInvalid} skipped-processed=${result.summary.skippedProcessed} failed=${result.summary.failed}`,
  );
  console.log(`Wrote ${options.output}`);
  console.log(`Wrote ${options.skippedOutput}`);
  console.log(`Wrote ${options.log}`);
  if (lookupResult) {
    const scoring = lookupResult.output.styleScoring;
    console.log(
      `Rebuilt public/assets/sorcery_deck_style_associations.json: source=${scoring.sourceDeckCount} inferred=${scoring.inferredDeckCount} unscored=${scoring.unscoredDeckCount}`,
    );
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
