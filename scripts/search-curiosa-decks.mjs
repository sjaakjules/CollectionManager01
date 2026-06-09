#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildCuriosaDeckSearchCountInput,
  buildCuriosaDeckSearchPageInput,
  parseCuriosaDeckSearchCount,
  parseCuriosaDeckSearchPage,
} from '../src/data/curiosaService.ts';
import {
  createCuriosaClient,
  formatCuriosaHealthLine,
  runArchive,
} from './fetch-curiosa-decks.mjs';

const DEFAULT_CURIOSA_BASE_URL = 'https://curiosa.io';
const DEFAULT_PAGE_SIZE = 30;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeQuery(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
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
  return baseUrl.replace(/\/+$/g, '');
}

export function buildCuriosaTrpcUrl(baseUrl, procedure, input) {
  return `${trimBaseUrl(baseUrl)}/api/trpc/${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
}

function defaultHeaders(extraHeaders = {}) {
  return {
    accept: 'application/json',
    origin: 'https://curiosa.io',
    referer: 'https://curiosa.io/decks',
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
  if (errorMessage) {
    throw new Error(`Curiosa ${procedure} error: ${errorMessage}`);
  }

  const result = isRecord(record?.result) ? record.result : null;
  const data = isRecord(result?.data) ? result.data : null;
  if (!data || !('json' in data)) {
    throw new Error(`Unexpected Curiosa response for ${procedure}`);
  }

  return data.json;
}

async function fetchCuriosaTrpcJson({
  client,
  baseUrl,
  procedure,
  input,
  requestKind,
  onHealth,
  onDelay,
  onWait,
}) {
  const url = buildCuriosaTrpcUrl(baseUrl, procedure, input);
  const response = await client.fetch(
    url,
    { headers: defaultHeaders() },
    {
      requestKind,
      onHealth,
      onDelay,
      onWait,
    },
  );

  if (!response.ok) {
    const message = await readCuriosaError(response);
    throw new Error(`Curiosa API error ${response.status}: ${message}`);
  }

  const results = await response.json();
  if (!Array.isArray(results) || results.length !== 1) {
    throw new Error(`Unexpected response format from curiosa.io for ${procedure}`);
  }

  return readTrpcJson(results[0], procedure);
}

export async function fetchSearchCount({ client, baseUrl, query, onHealth, onDelay, onWait }) {
  const json = await fetchCuriosaTrpcJson({
    client,
    baseUrl,
    procedure: 'deck.count',
    input: buildCuriosaDeckSearchCountInput({ query }),
    requestKind: 'search-count',
    onHealth,
    onDelay,
    onWait,
  });

  return {
    count: parseCuriosaDeckSearchCount(json),
    raw: json,
  };
}

export async function fetchSearchPage({
  client,
  baseUrl,
  query,
  pageSize,
  cursor,
  onHealth,
  onDelay,
  onWait,
}) {
  const input = buildCuriosaDeckSearchPageInput({
    query,
    limit: pageSize,
    cursor,
    direction: 'forward',
    sort: 'relevance',
  });
  const json = await fetchCuriosaTrpcJson({
    client,
    baseUrl,
    procedure: 'deck.search',
    input,
    requestKind: 'search-page',
    onHealth,
    onDelay,
    onWait,
  });

  return {
    cursor,
    decks: parseCuriosaDeckSearchPage(json),
    raw: json,
  };
}

export function filterSearchDecks(decks, { minViews = 0, minLikes = 0, maxDecks = 0 } = {}) {
  const filtered = [];
  const seen = new Set();

  for (const deck of decks) {
    if (seen.has(deck.id)) continue;
    seen.add(deck.id);

    if ((deck.views ?? 0) < minViews) continue;
    if ((deck.likes ?? 0) < minLikes) continue;

    filtered.push(deck);
    if (maxDecks > 0 && filtered.length >= maxDecks) break;
  }

  return filtered;
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
    },
  }));
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createSearchSnapshot({
  query,
  count,
  pageSize,
  pages,
  decks,
  filteredDecks,
  options,
  fetchedAt,
}) {
  return {
    query,
    fetchedAt,
    count,
    pageSize,
    filters: {
      minViews: options.minViews,
      minLikes: options.minLikes,
      maxDecks: options.maxDecks,
    },
    totalFound: decks.length,
    totalFiltered: filteredDecks.length,
    decks,
    filteredDecks,
    pages: pages.map((page) => ({
      cursor: page.cursor,
      returned: page.decks.length,
      raw: page.raw,
    })),
  };
}

export async function collectCuriosaDeckSearch(options, dependencies = {}) {
  const query = normalizeQuery(options.query);
  if (!query) throw new Error('--query is required');

  const client = dependencies.curiosaClient ?? createCuriosaClient();
  const baseUrl = options.curiosaBaseUrl ?? DEFAULT_CURIOSA_BASE_URL;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const nowImpl = dependencies.nowImpl ?? (() => Date.now());
  const writeJson = dependencies.writeJsonFile ?? writeJsonFile;
  const fetchCount = dependencies.fetchSearchCount ?? fetchSearchCount;
  const fetchPage = dependencies.fetchSearchPage ?? fetchSearchPage;
  const pages = [];
  const decks = [];

  const onHealth = (health) => {
    dependencies.onHealth?.(health);
  };
  const onDelay = (delay) => {
    dependencies.onDelay?.(delay);
  };
  const onWait = (wait) => {
    dependencies.onWait?.(wait);
  };

  const countResult = await fetchCount({
    client,
    baseUrl,
    query,
    onHealth,
    onDelay,
    onWait,
  });
  const totalCount = countResult.count;

  for (let cursor = 0; cursor < totalCount; cursor += pageSize) {
    const page = await fetchPage({
      client,
      baseUrl,
      query,
      pageSize,
      cursor,
      onHealth,
      onDelay,
      onWait,
    });

    if (page.decks.length === 0) break;

    pages.push(page);
    decks.push(...page.decks);

    const filteredDecks = filterSearchDecks(decks, options);
    await writeJson(options.searchOutput, createSearchSnapshot({
      query,
      count: totalCount,
      pageSize,
      pages,
      decks,
      filteredDecks,
      options,
      fetchedAt: new Date(nowImpl()).toISOString(),
    }));

    if (options.maxDecks > 0 && filteredDecks.length >= options.maxDecks) break;
    if (decks.length >= totalCount) break;
  }

  const filteredDecks = filterSearchDecks(decks, options);
  const snapshot = createSearchSnapshot({
    query,
    count: totalCount,
    pageSize,
    pages,
    decks,
    filteredDecks,
    options,
    fetchedAt: new Date(nowImpl()).toISOString(),
  });
  await writeJson(options.searchOutput, snapshot);

  return snapshot;
}

function printHelp() {
  console.log(`Search Curiosa decks and archive matching decklists.

Usage:
  node scripts/search-curiosa-decks.mjs --query cornerstone --output tmp/cornerstone-decks.json --min-views 100 --min-likes 5

Options:
  -q, --query <term>             Search term.
  -o, --output <file>            Output archive JSON file.
      --search-output <file>     Search summary JSON. Defaults to <output>.search.json.
      --skipped-output <file>    Failed/invalid deck JSON. Defaults to <output>.skipped.json.
      --log <file>               Archive log path. Defaults to <output>.log.
      --card-data <file>         Card catalog JSON. Defaults to docs/Sorcery_CardInfo.json.
      --curiosa-base-url <url>   Defaults to ${DEFAULT_CURIOSA_BASE_URL}.
      --min-views <n>            Download only decks with at least n views.
      --min-likes <n>            Download only decks with at least n likes.
      --max-decks <n>            Cap downloads after filtering.
      --page-size <n>            Search page size. Defaults to ${DEFAULT_PAGE_SIZE}.
      --skip-processed           Skip IDs already in output or skipped-output.
  -h, --help                     Show this help.
`);
}

export function parseArgs(argv) {
  const options = {
    query: '',
    output: '',
    searchOutput: '',
    skippedOutput: '',
    log: '',
    cardData: 'docs/Sorcery_CardInfo.json',
    curiosaBaseUrl: DEFAULT_CURIOSA_BASE_URL,
    minViews: 0,
    minLikes: 0,
    maxDecks: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    skipProcessed: false,
    help: false,
  };

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

    const next = argv[index + 1];
    if (!next) throw new Error(`Missing value for ${arg}`);

    if (arg === '-q' || arg === '--query') {
      options.query = next;
      index += 1;
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      options.output = next;
      index += 1;
      continue;
    }

    if (arg === '--search-output') {
      options.searchOutput = next;
      index += 1;
      continue;
    }

    if (arg === '--skipped-output') {
      options.skippedOutput = next;
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

    if (arg === '--curiosa-base-url') {
      options.curiosaBaseUrl = next;
      index += 1;
      continue;
    }

    if (arg === '--min-views') {
      options.minViews = parseNonNegativeInt(next, arg);
      index += 1;
      continue;
    }

    if (arg === '--min-likes') {
      options.minLikes = parseNonNegativeInt(next, arg);
      index += 1;
      continue;
    }

    if (arg === '--max-decks') {
      options.maxDecks = parseNonNegativeInt(next, arg);
      index += 1;
      continue;
    }

    if (arg === '--page-size') {
      options.pageSize = parsePositiveInt(next, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.help) {
    if (!normalizeQuery(options.query)) throw new Error('--query is required');
    if (!options.output) throw new Error('--output is required');
  }

  if (!options.searchOutput && options.output) {
    options.searchOutput = `${options.output}.search.json`;
  }
  if (!options.skippedOutput && options.output) {
    options.skippedOutput = `${options.output}.skipped.json`;
  }
  if (!options.log && options.output) {
    options.log = `${options.output}.log`;
  }

  return options;
}

export async function runSearchToArchive(options, dependencies = {}) {
  const search = await collectCuriosaDeckSearch(options, {
    ...dependencies,
    onHealth: (health) => {
      const line = formatCuriosaHealthLine(health);
      dependencies.onHealth?.(health);
      if (!dependencies.quiet) console.log(line);
    },
    onDelay: (delay) => {
      dependencies.onDelay?.(delay);
      if (!dependencies.quiet) {
        console.log(`search wait ${Math.ceil(delay.delayMs / 1000)}s ${delay.reason}`);
      }
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
      curiosaBaseUrl: options.curiosaBaseUrl,
      limitPerFile: 0,
      skipProcessed: options.skipProcessed,
    },
    {
      inputs: archiveInputs,
      handleSignals: true,
    },
  );

  return {
    search,
    archiveResult,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await runSearchToArchive(options);
  console.log(
    `Search done: found=${result.search.totalFound} filtered=${result.search.totalFiltered}`,
  );
  console.log(`Wrote ${options.searchOutput}`);
  console.log(`Wrote ${options.output}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
