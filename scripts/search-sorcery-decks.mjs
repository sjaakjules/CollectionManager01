#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildSorceryDeckSearchPageInput,
  parseSorceryDeckSearchPage,
} from '../src/data/sorceryDeckService.ts';
import {
  COMPETITIVE_PRESETS,
  classifyAndFilterCompetitiveDeck,
  normalizeSearchQueries,
} from './lib/competitive-decks.mjs';
import {
  createSorceryDeckClient,
  formatSorceryHealthLine,
  runArchive,
} from './fetch-sorcery-decks.mjs';

import { SORCERY_DECK_ORIGIN } from '../src/data/sorceryDeckSource.ts';
import { sorceryInterrupt } from './lib/sorcery-interrupt.mjs';
const DEFAULT_SORCERY_BASE_URL = SORCERY_DECK_ORIGIN;
const DEFAULT_PAGE_SIZE = 30;
const SEARCH_SNAPSHOT_VERSION = 'sorcery-deck-search-v2';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseNonNegativeInt(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flagName}: ${value}`);
  }
  return parsed;
}

function parsePositiveInt(value, flagName) {
  const parsed = parseNonNegativeInt(value, flagName);
  if (parsed < 1) throw new Error(`${flagName} must be at least 1`);
  return parsed;
}

function trimBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/gu, '');
}

function compareDates(left, right) {
  const leftMs = Date.parse(left ?? '');
  const rightMs = Date.parse(right ?? '');
  const safeLeft = Number.isFinite(leftMs) ? leftMs : 0;
  const safeRight = Number.isFinite(rightMs) ? rightMs : 0;
  return safeLeft - safeRight;
}

export function buildSorceryTrpcUrl(baseUrl, procedure, input) {
  return `${trimBaseUrl(baseUrl)}/api/trpc/${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
}

function defaultHeaders(extraHeaders = {}) {
  return {
    accept: 'application/json',
    origin: SORCERY_DECK_ORIGIN,
    referer: `${SORCERY_DECK_ORIGIN}/decks`,
    'user-agent': 'SorceryStacks/1.0',
    ...extraHeaders,
  };
}

async function readSorceryError(response) {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      const record = isRecord(entry) ? entry : null;
      const error = isRecord(record?.error) ? record.error : null;
      const errorJson = isRecord(error?.json) ? error.json : null;
      const message = typeof errorJson?.message === 'string' ? errorJson.message : '';
      if (message) return message;
    }
  } catch {
    // Fall through to the raw response body.
  }
  return body.trim() || response.statusText || 'Unknown error';
}

function readTrpcJson(entry, procedure) {
  const record = isRecord(entry) ? entry : null;
  const error = isRecord(record?.error) ? record.error : null;
  const errorJson = isRecord(error?.json) ? error.json : null;
  const errorMessage = typeof errorJson?.message === 'string' ? errorJson.message : '';
  if (errorMessage) throw new Error(`SorceryTCG ${procedure} error: ${errorMessage}`);

  const result = isRecord(record?.result) ? record.result : null;
  const data = isRecord(result?.data) ? result.data : null;
  if (!data || !('json' in data)) {
    throw new Error(`Unexpected SorceryTCG response for ${procedure}`);
  }
  return data.json;
}

async function fetchSorceryTrpcJson({
  client,
  baseUrl,
  procedure,
  input,
  requestKind,
  signal,
  onHealth,
  onDelay,
  onWait,
}) {
  const url = buildSorceryTrpcUrl(baseUrl, procedure, input);
  const response = await client.fetch(
    url,
    { headers: defaultHeaders() },
    { requestKind, signal, onHealth, onDelay, onWait },
  );
  if (!response.ok) {
    const message = await readSorceryError(response);
    throw new Error(`SorceryTCG API error ${response.status}: ${message}`);
  }
  const results = await response.json();
  if (!Array.isArray(results) || results.length !== 1) {
    throw new Error(`Unexpected response format from SorceryTCG for ${procedure}`);
  }
  return readTrpcJson(results[0], procedure);
}

export async function fetchSearchPage({
  client,
  baseUrl,
  query,
  pageSize,
  cursor,
  sort,
  signal,
  onHealth,
  onDelay,
  onWait,
}) {
  const input = buildSorceryDeckSearchPageInput({
    query,
    limit: pageSize,
    cursor,
    direction: 'forward',
    sort,
  });
  const json = await fetchSorceryTrpcJson({
    client,
    baseUrl,
    procedure: 'deck.search',
    input,
    requestKind: 'search-page',
    signal,
    onHealth,
    onDelay,
    onWait,
  });
  const decks = parseSorceryDeckSearchPage(json);
  const nextCursor = json.nextCursor;
  if (nextCursor != null && (!Number.isSafeInteger(nextCursor) || nextCursor <= (cursor ?? 0))) {
    throw new Error('Unexpected SorceryTCG search cursor; stopping to avoid repeated downloads');
  }
  // Do not archive the full response: new search results include every card's
  // printing metadata. Keep only the deck summaries needed by these tools.
  return { cursor, decks, nextCursor: nextCursor ?? null, raw: { decks, nextCursor: nextCursor ?? null } };
}

function mergeDefined(preferred, fallback, key) {
  return preferred?.[key] !== undefined ? preferred[key] : fallback?.[key];
}

export function mergeSearchDeck(existing, incoming, query) {
  const incomingIsNewer = compareDates(incoming.updatedAt, existing?.updatedAt) > 0;
  const preferred = !existing || incomingIsNewer ? incoming : existing;
  const fallback = preferred === incoming ? existing : incoming;
  return {
    id: incoming.id,
    createdAt: mergeDefined(preferred, fallback, 'createdAt'),
    updatedAt: mergeDefined(preferred, fallback, 'updatedAt'),
    name: mergeDefined(preferred, fallback, 'name'),
    format: mergeDefined(preferred, fallback, 'format'),
    primer: mergeDefined(preferred, fallback, 'primer'),
    hotscore: mergeDefined(preferred, fallback, 'hotscore'),
    user: mergeDefined(preferred, fallback, 'user'),
    elements: mergeDefined(preferred, fallback, 'elements'),
    likes: Math.max(existing?.likes ?? 0, incoming.likes ?? 0),
    views: Math.max(existing?.views ?? 0, incoming.views ?? 0),
    matchedQueries: normalizeSearchQueries([
      ...(existing?.matchedQueries ?? []),
      ...(incoming?.matchedQueries ?? []),
      query,
    ]),
  };
}

function sortSearchDecks(decks, sort) {
  if (sort !== 'latest') return decks;
  return [...decks].sort((left, right) => {
    const dateDelta = compareDates(
      right.updatedAt ?? right.createdAt,
      left.updatedAt ?? left.createdAt,
    );
    if (dateDelta !== 0) return dateDelta;
    return String(left.name ?? left.id).localeCompare(String(right.name ?? right.id));
  });
}

function dedupeSearchDecks(decks) {
  const byId = new Map();
  for (const deck of decks) {
    if (!deck?.id) continue;
    byId.set(deck.id, mergeSearchDeck(byId.get(deck.id), deck, ''));
  }
  return [...byId.values()];
}

export function classifySearchDecks(decks, options = {}) {
  return sortSearchDecks(dedupeSearchDecks(decks), options.sort).map((deck) => {
    const evaluation = classifyAndFilterCompetitiveDeck(deck, options);
    return {
      ...deck,
      competitive: evaluation.competitive,
      included: evaluation.included,
      exclusionReasons: evaluation.exclusionReasons,
    };
  });
}

export function filterSearchDecks(decks, options = {}) {
  const filtered = classifySearchDecks(decks, options).filter((deck) => deck.included);
  return options.maxDecks > 0 ? filtered.slice(0, options.maxDecks) : filtered;
}

export function deckSummariesToArchiveInputs(decks, sourcePath) {
  return decks.map((deck, index) => ({
    id: deck.id,
    sourcePath,
    sourceIndex: index,
    raw: deck.id,
    hint: {
      id: deck.id,
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt,
      name: deck.name,
      format: deck.format,
      hotscore: deck.hotscore,
      user: deck.user,
      elements: deck.elements,
      ...(deck.primer !== undefined ? { primer: deck.primer } : {}),
      ...(isRecord(deck.competitive) ? { competitive: deck.competitive } : {}),
    },
  }));
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createSearchSnapshot({ queryRuns, decks, options, fetchedAt }) {
  const classifiedDecks = classifySearchDecks(decks, options);
  const eligibleDecks = classifiedDecks.filter((deck) => deck.included);
  const filteredDecks = options.maxDecks > 0
    ? eligibleDecks.slice(0, options.maxDecks)
    : eligibleDecks;
  const queries = queryRuns.map((run) => ({
    query: run.query,
    count: run.count,
    pages: run.pages.map((page) => ({
      cursor: page.cursor,
      returned: page.decks.length,
      raw: page.raw,
    })),
  }));

  return {
    version: SEARCH_SNAPSHOT_VERSION,
    preset: options.preset || null,
    ...(queries.length === 1 ? { query: queries[0].query } : {}),
    fetchedAt,
    count: queries.length === 1
      ? queries[0].count
      : queries.reduce((sum, query) => sum + query.count, 0),
    pageSize: options.pageSize,
    sort: options.sort,
    filters: {
      since: options.since || null,
      season: options.season ?? null,
      format: options.format,
      competitiveOnly: options.competitiveOnly,
      minViews: options.minViews,
      minLikes: options.minLikes,
      maxDecks: options.maxDecks,
    },
    totalFound: classifiedDecks.length,
    totalEligible: eligibleDecks.length,
    totalFiltered: filteredDecks.length,
    decks: classifiedDecks,
    filteredDecks,
    queries,
    ...(queries.length === 1 ? { pages: queries[0].pages } : {}),
  };
}

export async function collectSorceryDeckSearch(options, dependencies = {}) {
  const queries = normalizeSearchQueries(
    options.queries?.length > 0 ? options.queries : [options.query],
  );
  if (queries.length === 0) throw new Error('At least one --query or --preset is required');

  const client = dependencies.sorceryClient ?? createSorceryDeckClient();
  const baseUrl = options.sorceryBaseUrl ?? DEFAULT_SORCERY_BASE_URL;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const nowImpl = dependencies.nowImpl ?? (() => Date.now());
  const writeJson = dependencies.writeJsonFile ?? writeJsonFile;
  const fetchPage = dependencies.fetchSearchPage ?? fetchSearchPage;
  const queryRuns = [];
  const deckById = new Map();
  let completedRequests = 0;
  let estimatedRequests = queries.length;
  let latestSnapshot = createSearchSnapshot({
    queryRuns,
    decks: [],
    options: { ...options, pageSize },
    fetchedAt: new Date(nowImpl()).toISOString(),
  });

  const snapshotAndWrite = async () => {
    latestSnapshot = createSearchSnapshot({
      queryRuns,
      decks: [...deckById.values()],
      options: { ...options, pageSize },
      fetchedAt: new Date(nowImpl()).toISOString(),
    });
    await writeJson(options.searchOutput, latestSnapshot);
  };

  const interrupt = sorceryInterrupt(dependencies.handleSignals);

  try {
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
      const query = queries[queryIndex];
      const run = { query, count: 0, pages: [] };
      queryRuns.push(run);
      let cursor = 0;
      while (true) {
        interrupt.signal.throwIfAborted();
        const page = await fetchPage({
          client,
          baseUrl,
          query,
          pageSize,
          cursor,
          sort: options.sort,
          signal: interrupt.signal,
          onHealth: dependencies.onHealth,
          onDelay: dependencies.onDelay,
          onWait: dependencies.onWait,
        });
        interrupt.signal.throwIfAborted();
        completedRequests += 1;
        if (page.decks.length === 0) break;
        const nextCursor = page.nextCursor ?? null;
        if (nextCursor !== null && (!Number.isSafeInteger(nextCursor) || nextCursor <= cursor)) {
          throw new Error('Unexpected SorceryTCG search cursor; stopping to avoid repeated downloads');
        }
        run.count += page.decks.length;
        estimatedRequests = completedRequests + (nextCursor !== null ? 1 : 0) + queries.length - queryIndex - 1;

        run.pages.push(page);
        for (const deck of page.decks) {
          deckById.set(deck.id, mergeSearchDeck(deckById.get(deck.id), deck, query));
        }
        await snapshotAndWrite();
        const lastDeck = latestSnapshot.decks.find(
          (deck) => deck.id === page.decks.at(-1)?.id,
        ) ?? null;
        dependencies.onProgress?.({
          phase: 'page',
          query,
          queryIndex,
          queryTotal: queries.length,
          page: run.pages.length,
          pageTotal: run.pages.length + (nextCursor !== null ? 1 : 0),
          unique: deckById.size,
          filtered: latestSnapshot.totalFiltered,
          completedRequests,
          estimatedRequests,
          lastDeck,
        });

        if (nextCursor === null) break;
        cursor = nextCursor;
      }
    }

    await snapshotAndWrite();
    interrupt.signal.throwIfAborted();
    return latestSnapshot;
  } catch (error) {
    if (!interrupt.signal.aborted) throw error;
    await writeJson(options.searchOutput, latestSnapshot);
    (dependencies.exitProcess ?? ((code) => process.exit(code)))(interrupt.exitCode);
    throw interrupt.signal.reason;
  } finally {
    interrupt.dispose();
  }
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}

function createSearchDashboard({ enabled, stdout, nowImpl, quiet }) {
  const startedAt = nowImpl();
  let renderedLines = 0;
  const state = { progress: null, waiting: null, health: null };

  const render = () => {
    if (!enabled || !state.progress) return;
    const progress = state.progress;
    const elapsed = nowImpl() - startedAt;
    const average = progress.completedRequests > 0 ? elapsed / progress.completedRequests : 0;
    const eta = average * Math.max(0, progress.estimatedRequests - progress.completedRequests);
    const waitingSeconds = state.waiting ? Math.ceil(state.waiting.remainingMs / 1000) : 0;
    const dots = state.waiting
      ? '.'.repeat((Math.floor((state.waiting.delayMs - state.waiting.remainingMs) / 1000) % 3) + 1)
      : '';
    const last = progress.lastDeck;
    const result = last
      ? `${last.included ? 'included' : 'excluded'}${last.exclusionReasons.length ? `: ${last.exclusionReasons.join(', ')}` : ''}`
      : '-';
    const lines = [
      ['Search', `query=${progress.queryIndex + 1}/${progress.queryTotal}`, JSON.stringify(progress.query), `page=${progress.page}/${progress.pageTotal}`, `elapsed=${formatDuration(elapsed)}`, `eta=${formatDuration(eta)}`, `unique=${progress.unique}`, `eligible=${progress.filtered}`].join('\t'),
      state.waiting
        ? ['Waiting', 'on sorcery', `${waitingSeconds}s${dots}`, `reason=${state.waiting.reason}`].join('\t')
        : ['Waiting', '-'].join('\t'),
      state.health ? formatSorceryHealthLine(state.health).replace(/ /gu, '\t') : ['Sorcery', '-'].join('\t'),
      last ? ['Last', last.id, JSON.stringify(last.name ?? last.id)].join('\t') : ['Last', '-'].join('\t'),
      ['Result', result].join('\t'),
    ];
    if (renderedLines > 0) stdout.write(`\x1b[${renderedLines}A`);
    for (const line of lines) stdout.write(`\x1b[2K${line}\n`);
    renderedLines = lines.length;
  };

  return {
    progress(progress) {
      state.progress = progress;
      state.waiting = null;
      if (!enabled && !quiet) {
        console.log(`search ${progress.queryIndex + 1}/${progress.queryTotal} ${JSON.stringify(progress.query)} page=${progress.page}/${progress.pageTotal} unique=${progress.unique} eligible=${progress.filtered}`);
      }
      render();
    },
    wait(waiting) {
      state.waiting = waiting.remainingMs > 0 ? waiting : null;
      render();
    },
    health(health) {
      state.health = health;
      if (!enabled && !quiet) console.log(formatSorceryHealthLine(health));
      render();
    },
  };
}

function printHelp() {
  console.log(`Search SorceryTCG decks and archive matching decklists.

Usage:
  node scripts/search-sorcery-decks.mjs --query cornerstone --output tmp/cornerstone-decks.json --min-views 100 --min-likes 5
  node scripts/search-sorcery-decks.mjs --preset competitive-2026 --output offlineData/deckArchive.json

Options:
  -q, --query <term>             Search term. Can be repeated.
      --preset <name>            Search preset. Available: ${Object.keys(COMPETITIVE_PRESETS).join(', ')}.
  -o, --output <file>            Output archive JSON file.
      --search-output <file>     Search audit JSON. Defaults to <output>.search.json.
      --skipped-output <file>    Failed/invalid deck JSON. Defaults to <output>.skipped.json.
      --log <file>               Archive log path. Defaults to <output>.log.
      --card-data <file>         Card catalog JSON. Defaults to public/assets/sorcery_cards.json.
      --sorcery-base-url <url>   Defaults to ${DEFAULT_SORCERY_BASE_URL}.
      --sort <mode>              relevance or latest.
      --since <date>             Keep decks updated/created on or after this date.
      --format <name>            Required format, or all.
      --include-unclassified     Include results without competitive evidence.
      --min-views <n>            Download only decks with at least n views.
      --min-likes <n>            Download only decks with at least n likes.
      --max-decks <n>            Cap downloads after all queries are deduplicated.
      --page-size <n>            Search page size. Defaults to ${DEFAULT_PAGE_SIZE}.
      --skip-processed           Skip IDs already in output or skipped-output.
      --rebuild-lookup           Rebuild the app deck lookup after archiving.
      --no-rebuild-lookup        Do not rebuild a lookup requested by a preset.
  -h, --help                     Show this help.
`);
}

export function parseArgs(argv) {
  const options = {
    query: '',
    queries: [],
    preset: '',
    output: '',
    searchOutput: '',
    skippedOutput: '',
    log: '',
    cardData: 'public/assets/sorcery_cards.json',
    sorceryBaseUrl: DEFAULT_SORCERY_BASE_URL,
    sort: '',
    since: '',
    format: '',
    season: null,
    competitiveOnly: false,
    includeUnclassified: false,
    minViews: 0,
    minLikes: 0,
    maxDecks: 0,
    pageSize: DEFAULT_PAGE_SIZE,
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
    if (arg === '--include-unclassified') {
      options.includeUnclassified = true;
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
    if (arg === '-q' || arg === '--query') options.queries.push(next);
    else if (arg === '--preset') options.preset = next;
    else if (arg === '-o' || arg === '--output') options.output = next;
    else if (arg === '--search-output') options.searchOutput = next;
    else if (arg === '--skipped-output') options.skippedOutput = next;
    else if (arg === '--log') options.log = next;
    else if (arg === '--card-data') options.cardData = next;
    else if (arg === '--sorcery-base-url') options.sorceryBaseUrl = next;
    else if (arg === '--sort') options.sort = next;
    else if (arg === '--since') options.since = next;
    else if (arg === '--format') options.format = next;
    else if (arg === '--min-views') options.minViews = parseNonNegativeInt(next, arg);
    else if (arg === '--min-likes') options.minLikes = parseNonNegativeInt(next, arg);
    else if (arg === '--max-decks') options.maxDecks = parseNonNegativeInt(next, arg);
    else if (arg === '--page-size') options.pageSize = parsePositiveInt(next, arg);
    else throw new Error(`Unknown argument: ${arg}`);
    index += 1;
  }

  const preset = options.preset ? COMPETITIVE_PRESETS[options.preset] : null;
  if (options.preset && !preset) throw new Error(`Unknown preset: ${options.preset}`);
  options.queries = normalizeSearchQueries([...(preset?.queries ?? []), ...options.queries]);
  options.query = options.queries[0] ?? '';
  options.sort = options.sort || preset?.sort || 'relevance';
  options.since = options.since || preset?.since || '';
  options.format = options.format || preset?.format || 'all';
  options.season = preset?.season ?? null;
  options.competitiveOnly = Boolean(preset) && !options.includeUnclassified;
  options.rebuildLookup = rebuildLookupOverride ?? Boolean(preset?.rebuildLookup);

  if (!['relevance', 'latest'].includes(options.sort)) {
    throw new Error('--sort must be relevance or latest');
  }
  if (options.since && !Number.isFinite(Date.parse(options.since))) {
    throw new Error(`Invalid value for --since: ${options.since}`);
  }
  if (!options.help) {
    if (options.queries.length === 0) throw new Error('At least one --query or --preset is required');
    if (!options.output) throw new Error('--output is required');
  }

  if (!options.searchOutput && options.output) options.searchOutput = `${options.output}.search.json`;
  if (!options.skippedOutput && options.output) options.skippedOutput = `${options.output}.skipped.json`;
  if (!options.log && options.output) options.log = `${options.output}.log`;
  return options;
}

export async function runSearchToArchive(options, dependencies = {}) {
  const client = dependencies.sorceryClient ?? createSorceryDeckClient();
  const nowImpl = dependencies.nowImpl ?? (() => Date.now());
  const stdout = dependencies.stdout ?? process.stdout;
  const dashboard = createSearchDashboard({
    enabled: dependencies.liveDashboard ?? Boolean(stdout.isTTY && !process.env.CI),
    stdout,
    nowImpl,
    quiet: dependencies.quiet,
  });
  const search = await collectSorceryDeckSearch(options, {
    ...dependencies,
    sorceryClient: client,
    handleSignals: dependencies.handleSignals ?? true,
    onProgress: (progress) => {
      dependencies.onProgress?.(progress);
      dashboard.progress(progress);
    },
    onHealth: (health) => {
      dependencies.onHealth?.(health);
      dashboard.health(health);
    },
    onDelay: (delay) => dependencies.onDelay?.(delay),
    onWait: (wait) => {
      dependencies.onWait?.(wait);
      dashboard.wait(wait);
    },
  });

  const archiveInputs = deckSummariesToArchiveInputs(search.filteredDecks, options.searchOutput);
  const archiveResult = await (dependencies.runArchive ?? runArchive)(
    {
      inputs: [],
      output: options.output,
      skippedOutput: options.skippedOutput,
      log: options.log,
      cardData: options.cardData,
      sorceryBaseUrl: options.sorceryBaseUrl,
      limitPerFile: 0,
      skipProcessed: options.skipProcessed,
    },
    {
      inputs: archiveInputs,
      sorceryClient: client,
      handleSignals: true,
    },
  );

  let lookupResult = null;
  if (options.rebuildLookup) {
    const rebuildLookup = dependencies.rebuildLookup ?? (async () => {
      const module = await import('./build-deck-style-associations.mjs');
      return module.runDeckStyleAssociationBuild({
        archivePath: options.output,
        ...(options.cardData ? { cardDataPath: options.cardData } : {}),
      });
    });
    lookupResult = await rebuildLookup();
  }
  return { search, archiveResult, lookupResult };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await runSearchToArchive(options);
  console.log(`Search done: found=${result.search.totalFound} eligible=${result.search.totalEligible} downloaded=${result.search.totalFiltered}`);
  console.log(`Wrote ${options.searchOutput}`);
  console.log(`Wrote ${options.output}`);
  if (result.lookupResult) {
    const scoring = result.lookupResult.output.styleScoring;
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
