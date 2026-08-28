/**
 * Curiosa.io deck fetching service
 *
 * Fetches public deck data from curiosa.io through same-origin proxy paths:
 *   1. HTML page fetch for public deck existence and metadata.
 *   2. One batched tRPC request for mainboard, avatar, sideboard, maybeboard.
 *
 * The upstream tRPC endpoint is not a published API, so this service keeps
 * requests serialized and deliberately slower than normal browser interaction.
 *
 * Related files:
 * - `src/ui/BottomPanel.tsx` (deck URL import flow)
 * - `vite.config.ts` and deployed Apache/PHP routes (proxy routing)
 */

import type { Deck, DeckCard } from "./dataModels";

const PROXY_PREFIX = "/api/curiosa";
const CURIOSA_HOSTS = new Set(["curiosa.io", "www.curiosa.io"]);

const LOCAL_BUCKET_CAPACITY = 1;
const LOCAL_REFILL_MS = 3000;
const LOW_REMAINING_THRESHOLD = 2;
const SAFE_REMAINING_TARGET = 5;
const KIND_DELAY_MESSAGE_THRESHOLD_MS = 1000;

export interface CuriosaFetchDelay {
  delayMs: number;
  reason: string;
  source: "client" | "server";
}

export interface FetchCuriosaDeckOptions {
  signal?: AbortSignal;
  onDelay?: (delay: CuriosaFetchDelay) => void;
}

export interface CuriosaDeckSearchSummary {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  name?: string;
  format?: string;
  primer?: string | null;
  hotscore?: number;
  user?: { id?: string; username?: string };
  elements?: string[];
  likes: number;
  views: number;
}

export interface CuriosaDeckSearchBaseOptions {
  query: string;
  avatar?: string;
  divider?: string;
  filters?: unknown[];
}

export interface CuriosaDeckSearchPageOptions extends CuriosaDeckSearchBaseOptions {
  sort?: string;
  limit?: number;
  cursor?: number;
  direction?: "forward" | "backward";
}

export interface FetchCuriosaDeckSearchCountOptions
  extends CuriosaDeckSearchBaseOptions,
    FetchCuriosaDeckOptions {}

export interface FetchCuriosaDeckSearchPageOptions
  extends CuriosaDeckSearchPageOptions,
    FetchCuriosaDeckOptions {}

// ============================================================================
// Rate limiting
// ============================================================================

interface RateLimitState {
  remaining: number | null;
  limit: number | null;
  resetMs: number | null;
  retryAfterUntilMs: number | null;
}

const rateLimit: RateLimitState = {
  remaining: null,
  limit: null,
  resetMs: null,
  retryAfterUntilMs: null,
};

let requestQueue: Promise<void> = Promise.resolve();
let localTokens = LOCAL_BUCKET_CAPACITY;
let lastTokenRefillMs: number | null = null;

function abortError(): DOMException {
  return new DOMException("Curiosa import cancelled", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;

  const reason: unknown = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw abortError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      signal?.removeEventListener("abort", handleAbort);
    };

    const handleAbort = () => {
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : abortError());
    };

    timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

function notifyDelay(
  delayMs: number,
  reason: string,
  source: CuriosaFetchDelay["source"],
  onDelay?: FetchCuriosaDeckOptions["onDelay"],
): void {
  if (delayMs < KIND_DELAY_MESSAGE_THRESHOLD_MS) return;
  onDelay?.({ delayMs: Math.ceil(delayMs), reason, source });
}

function parseNumericHeader(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseResetMs(value: string | null, now = Date.now()): number | null {
  const parsed = parseNumericHeader(value);
  if (parsed === null) return null;

  // Most rate-limit reset headers are epoch seconds; very small values are
  // treated as relative seconds to keep the client conservative if that changes.
  if (parsed > 1_000_000_000) return parsed * 1000;
  return now + parsed * 1000;
}

function parseRetryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - now);
  }

  return null;
}

function refillLocalTokens(now = Date.now()): void {
  if (lastTokenRefillMs === null) {
    lastTokenRefillMs = now;
    return;
  }

  const elapsed = now - lastTokenRefillMs;
  if (elapsed < LOCAL_REFILL_MS) return;

  const refillCount = Math.floor(elapsed / LOCAL_REFILL_MS);
  localTokens = Math.min(LOCAL_BUCKET_CAPACITY, localTokens + refillCount);
  lastTokenRefillMs += refillCount * LOCAL_REFILL_MS;
}

async function waitForLocalToken(options?: FetchCuriosaDeckOptions): Promise<void> {
  while (true) {
    throwIfAborted(options?.signal);
    const now = Date.now();
    refillLocalTokens(now);

    if (localTokens > 0) {
      localTokens -= 1;
      return;
    }

    const nextRefillAt = (lastTokenRefillMs ?? now) + LOCAL_REFILL_MS;
    const delay = Math.max(0, nextRefillAt - now);
    notifyDelay(delay, "local-spacing", "client", options?.onDelay);
    await sleep(delay, options?.signal);
  }
}

async function waitForServerBudget(options?: FetchCuriosaDeckOptions): Promise<void> {
  throwIfAborted(options?.signal);
  const now = Date.now();

  if (rateLimit.retryAfterUntilMs !== null && rateLimit.retryAfterUntilMs > now) {
    const delay = rateLimit.retryAfterUntilMs - now;
    console.warn(`[curiosa] retry-after requested, waiting ${delay}ms`);
    notifyDelay(delay, "retry-after", "client", options?.onDelay);
    await sleep(delay, options?.signal);
    rateLimit.retryAfterUntilMs = null;
    return;
  }

  if (rateLimit.remaining === null || rateLimit.remaining > LOW_REMAINING_THRESHOLD) {
    return;
  }

  const resetDelay =
    rateLimit.resetMs !== null && rateLimit.resetMs > now
      ? rateLimit.resetMs - now
      : null;
  const replenishmentTicks = Math.max(0, SAFE_REMAINING_TARGET - rateLimit.remaining);
  const replenishmentDelay = replenishmentTicks * LOCAL_REFILL_MS;
  const delay = resetDelay ?? replenishmentDelay;

  if (delay > 0) {
    console.warn(
      `[curiosa] rate limit low (${rateLimit.remaining} remaining), waiting ${delay}ms`,
    );
    notifyDelay(delay, "rate-limit-low", "client", options?.onDelay);
    await sleep(delay, options?.signal);
  }
}

function updateRateLimit(
  response: Response,
  onDelay?: FetchCuriosaDeckOptions["onDelay"],
): number | null {
  const now = Date.now();
  const limit = parseNumericHeader(response.headers.get("x-ratelimit-limit"));
  const remaining = parseNumericHeader(response.headers.get("x-ratelimit-remaining"));
  const resetMs = parseResetMs(response.headers.get("x-ratelimit-reset"), now);
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), now);
  const proxyDelayMs = parseNumericHeader(
    response.headers.get("x-sorcery-proxy-delay-ms"),
  );
  const proxyDelayReason =
    response.headers.get("x-sorcery-proxy-delay-reason") ?? "proxy-throttle";

  if (limit !== null) rateLimit.limit = limit;
  if (remaining !== null) rateLimit.remaining = remaining;
  if (resetMs !== null) rateLimit.resetMs = resetMs;
  if (retryAfterMs !== null) rateLimit.retryAfterUntilMs = now + retryAfterMs;

  if (rateLimit.remaining !== null && rateLimit.limit !== null) {
    console.debug(
      `[curiosa] rate limit: ${rateLimit.remaining}/${rateLimit.limit} remaining`,
    );
  }

  if (proxyDelayMs !== null) {
    notifyDelay(proxyDelayMs, proxyDelayReason, "server", onDelay);
  }

  return retryAfterMs;
}

async function performCuriosaFetch(
  url: string,
  init: RequestInit | undefined,
  hasRetried: boolean,
  skipServerBudget = false,
  options?: FetchCuriosaDeckOptions,
): Promise<Response> {
  if (!skipServerBudget) {
    await waitForServerBudget(options);
  }
  await waitForLocalToken(options);

  throwIfAborted(options?.signal);
  const response = await fetch(url, { ...init, signal: options?.signal ?? init?.signal });
  const retryAfterMs = updateRateLimit(response, options?.onDelay);

  if (
    !hasRetried &&
    retryAfterMs !== null &&
    retryAfterMs > 0 &&
    (response.status === 429 || response.status === 503)
  ) {
    notifyDelay(retryAfterMs, "retry-after", "client", options?.onDelay);
    await sleep(retryAfterMs, options?.signal);
    rateLimit.retryAfterUntilMs = null;
    return performCuriosaFetch(url, init, true, true, options);
  }

  return response;
}

async function curiosaFetch(
  url: string,
  init?: RequestInit,
  options?: FetchCuriosaDeckOptions,
): Promise<Response> {
  const queued = requestQueue.then(() =>
    performCuriosaFetch(url, init, false, false, options),
  );
  requestQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

// ============================================================================
// General parsing helpers
// ============================================================================

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeMetaText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function sanitizeDeckName(value: string | null | undefined): string | undefined {
  const normalized = normalizeMetaText(value)
    .replace(/\s*(?:\||-|—|•)\s*curiosa(?:\.io)?(?:\s*deck builder)?\s*$/i, "")
    .trim();
  const text = (normalized.split("|")[0] ?? "")
    .replace(/\s*\|+\s*$/g, "")
    .trim();

  if (!text) return undefined;
  if (/^curiosa(?:\.io)?$/i.test(text)) return undefined;
  return text;
}

function sanitizeAuthor(value: string | null | undefined): string | undefined {
  const text = normalizeMetaText(value)
    .replace(/^by\s+/i, "")
    .replace(/[.]+$/g, "")
    .trim();
  if (!text) return undefined;
  if (/^curiosa(?:\.io)?$/i.test(text)) return undefined;
  return text;
}

function parseNameAuthorCandidate(
  candidate: string | null | undefined,
): { name?: string; author?: string } {
  const raw = normalizeMetaText(candidate);
  if (!raw) return {};

  const byMatch = raw.match(/^(.*?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return {
      name: sanitizeDeckName(byMatch[1]),
      author: sanitizeAuthor(byMatch[2]),
    };
  }

  const parts = raw
    .split("|")
    .map((part) => normalizeMetaText(part))
    .filter((part) => part && !/^curiosa(?:\.io)?$/i.test(part));

  if (parts.length >= 2) {
    return {
      name: sanitizeDeckName(parts[0]),
      author: sanitizeAuthor(parts[1]),
    };
  }

  if (parts.length === 1) {
    return { name: sanitizeDeckName(parts[0]) };
  }

  return { name: sanitizeDeckName(raw) };
}

// ============================================================================
// Deck metadata parsing
// ============================================================================

function parseDeckMetaFromNextData(root: unknown): { name?: string; author?: string } {
  const rootRecord = asRecord(root);
  const props = asRecord(rootRecord?.props);
  const pageProps = asRecord(props?.pageProps);
  const trpcState = asRecord(pageProps?.trpcState);
  const trpcJson = asRecord(trpcState?.json);
  const queries = Array.isArray(trpcJson?.queries) ? trpcJson.queries : [];

  for (const query of queries) {
    const queryRecord = asRecord(query);
    const state = asRecord(queryRecord?.state);
    const data = asRecord(state?.data);
    const name = sanitizeDeckName(readString(data?.name));
    if (!name) continue;

    const user = asRecord(data?.user);
    return {
      name,
      author: sanitizeAuthor(readString(user?.username) ?? readString(data?.author)),
    };
  }

  const deck = asRecord(pageProps?.deck);
  const name = sanitizeDeckName(readString(deck?.name));
  if (!name) return {};

  const user = asRecord(deck?.user);
  return {
    name,
    author: sanitizeAuthor(readString(user?.username) ?? readString(deck?.author)),
  };
}

function parseDeckMetaFromHtml(html: string): { name?: string; author?: string } {
  let name: string | undefined;
  let author: string | undefined;

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nextDataText = doc.querySelector("script#__NEXT_DATA__")?.textContent;

    if (nextDataText) {
      const parsed = parseDeckMetaFromNextData(JSON.parse(nextDataText) as unknown);
      if (parsed.name) name = parsed.name;
      if (parsed.author) author = parsed.author;
    }

    const titleCandidates = [
      doc.querySelector('meta[property="og:title"]')?.getAttribute("content"),
      doc.querySelector('meta[name="twitter:title"]')?.getAttribute("content"),
      doc.querySelector("title")?.textContent,
      doc.querySelector("h1")?.textContent,
    ];

    for (const candidate of titleCandidates) {
      const parsed = parseNameAuthorCandidate(candidate);
      if (!name && parsed.name) name = parsed.name;
      if (!author && parsed.author) author = parsed.author;
      if (name && author) break;
    }

    if (!author) {
      author = sanitizeAuthor(
        doc.querySelector('meta[name="author"]')?.getAttribute("content"),
      );
    }

    if (!author) {
      author = sanitizeAuthor(
        doc.querySelector('[rel="author"], .author, .deck-author')?.textContent,
      );
    }
  } catch {
    // Ignore parser failures and fall back to defaults.
  }

  return { name, author };
}

// ============================================================================
// tRPC response parsing
// ============================================================================

function readTrpcJson(entry: unknown, procedure: string): unknown {
  const record = asRecord(entry);
  const error = asRecord(record?.error);
  const errorJson = asRecord(error?.json);
  const errorMessage = readString(errorJson?.message);
  if (errorMessage) {
    throw new Error(`Curiosa ${procedure} error: ${errorMessage}`);
  }

  const result = asRecord(record?.result);
  const data = asRecord(result?.data);
  if (!data || !("json" in data)) {
    throw new Error(`Unexpected Curiosa response for ${procedure}`);
  }

  return data.json;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }

  return 0;
}

function normalizeSearchQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

function normalizeSearchLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit === undefined) return 30;
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

export function buildCuriosaDeckSearchCountInput(
  options: CuriosaDeckSearchBaseOptions,
): Record<string, { json: Record<string, unknown> }> {
  return {
    "0": {
      json: {
        query: normalizeSearchQuery(options.query),
        avatar: options.avatar ?? "*",
        divider: options.divider ?? "all",
        filters: options.filters ?? [],
      },
    },
  };
}

export function buildCuriosaDeckSearchPageInput(
  options: CuriosaDeckSearchPageOptions,
): Record<string, { json: Record<string, unknown> }> {
  const json: Record<string, unknown> = {
    query: normalizeSearchQuery(options.query),
    sort: options.sort ?? "relevance",
    avatar: options.avatar ?? "*",
    divider: options.divider ?? "all",
    filters: options.filters ?? [],
    limit: normalizeSearchLimit(options.limit),
    direction: options.direction ?? "forward",
  };

  if (options.cursor !== undefined && options.cursor > 0) {
    json.cursor = Math.floor(options.cursor);
  }

  return { "0": { json } };
}

export function parseCuriosaDeckSearchCount(raw: unknown): number {
  if (typeof raw === "number" || typeof raw === "string") return readCount(raw);

  const record = asRecord(raw);
  if (!record) return 0;

  return readCount(record.count ?? record.total ?? record._count);
}

function normalizeSearchUser(value: unknown): CuriosaDeckSearchSummary["user"] {
  const record = asRecord(value);
  if (!record) return undefined;

  const id = readString(record.id);
  const username = readString(record.username);
  if (!id && !username) return undefined;

  return { id, username };
}

function parseSearchSummary(entry: unknown): CuriosaDeckSearchSummary | null {
  const record = asRecord(entry);
  const id = readString(record?.id);
  if (!record || !id) return null;

  const count = asRecord(record._count);
  const likes = readCount(count?.likes ?? record.likes);
  const views = readCount(count?.views ?? record.views);
  const elements = Array.isArray(record.elements)
    ? record.elements.filter((value): value is string => typeof value === "string")
    : undefined;

  return {
    id,
    createdAt: readString(record.createdAt),
    updatedAt: readString(record.updatedAt),
    name: readString(record.name),
    format: readString(record.format),
    primer: record.primer === null ? null : readString(record.primer),
    hotscore: readNumber(record.hotscore),
    user: normalizeSearchUser(record.user),
    elements,
    likes,
    views,
  };
}

export function parseCuriosaDeckSearchPage(raw: unknown): CuriosaDeckSearchSummary[] {
  const record = asRecord(raw);
  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray(record?.decks)
      ? record.decks
      : Array.isArray(record?.items)
        ? record.items
        : Array.isArray(record?.results)
          ? record.results
          : [];

  return entries
    .map((entry) => parseSearchSummary(entry))
    .filter((entry): entry is CuriosaDeckSearchSummary => entry !== null);
}

function parseQuantity(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 1;
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.floor(parsed));
}

function parseBoardData(raw: unknown, boardName: string): DeckCard[] {
  const data = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const cards: DeckCard[] = [];

  for (const entry of data) {
    const record = asRecord(entry);
    if (!record) continue;

    const cardObj = asRecord(record.card);
    const name = readString(cardObj?.name) ?? readString(record.name);
    if (!name) {
      throw new Error(`Unexpected card entry in Curiosa ${boardName}`);
    }

    const quantity = parseQuantity(record.quantity ?? record.count ?? record.qty);
    cards.push({ name, quantity });
  }

  return cards;
}

async function readCuriosaError(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as unknown;
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      const record = asRecord(entry);
      const error = asRecord(record?.error);
      const errorJson = asRecord(error?.json);
      const message = readString(errorJson?.message);
      if (message) return message;
    }
  } catch {
    // Fall through to text body.
  }

  return body.trim() || response.statusText || "Unknown error";
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Extract deck ID from a curiosa.io URL or raw ID.
 */
export function extractDeckId(urlOrId: string): string {
  const raw = urlOrId.trim();
  if (!raw) return "";

  let candidate = raw.replace(/[?#].*$/g, "").replace(/\/+$/g, "");

  const maybeUrl =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? raw
      : /^curiosa\.io\//i.test(raw) || /^www\.curiosa\.io\//i.test(raw)
        ? `https://${raw}`
        : null;

  if (maybeUrl) {
    try {
      const parsed = new URL(maybeUrl);
      if (!CURIOSA_HOSTS.has(parsed.hostname.toLowerCase())) return "";
      const parts = parsed.pathname.split("/").filter(Boolean);
      const deckIndex = parts.indexOf("decks");
      candidate = deckIndex >= 0 ? parts[deckIndex + 1] ?? "" : "";
    } catch {
      return "";
    }
  } else if (candidate.includes("/")) {
    return "";
  }

  return /^[a-zA-Z0-9_-]+$/.test(candidate) ? candidate : "";
}

/**
 * Deterministic app deck id for a Curiosa deck.
 *
 * Re-importing the same Curiosa URL (or seeding the same deck via
 * `scripts/build-guest-seed-decks.mjs`, which uses the same convention)
 * resolves to the same deck instead of creating a duplicate.
 */
export function buildCuriosaDeckId(deckId: string): string {
  return `curiosa-${deckId}`;
}

async function fetchCuriosaTrpcJson(
  procedure: string,
  input: Record<string, unknown>,
  options: FetchCuriosaDeckOptions,
): Promise<unknown> {
  const encodedInput = encodeURIComponent(JSON.stringify(input));
  const trpcUrl = `${PROXY_PREFIX}/api/trpc/${procedure}?batch=1&input=${encodedInput}`;
  const response = await curiosaFetch(trpcUrl, {
    headers: { accept: "application/json" },
  }, options);

  if (!response.ok) {
    const message = await readCuriosaError(response);
    throw new Error(`Curiosa API error ${response.status}: ${message}`);
  }

  throwIfAborted(options.signal);
  const results = (await response.json()) as unknown;
  if (!Array.isArray(results) || results.length !== 1) {
    throw new Error(`Unexpected response format from curiosa.io for ${procedure}`);
  }

  return readTrpcJson(results[0], procedure);
}

export async function fetchCuriosaDeckSearchCount(
  options: FetchCuriosaDeckSearchCountOptions,
): Promise<number> {
  const json = await fetchCuriosaTrpcJson(
    "deck.count",
    buildCuriosaDeckSearchCountInput(options),
    options,
  );
  return parseCuriosaDeckSearchCount(json);
}

export async function fetchCuriosaDeckSearchPage(
  options: FetchCuriosaDeckSearchPageOptions,
): Promise<CuriosaDeckSearchSummary[]> {
  const json = await fetchCuriosaTrpcJson(
    "deck.search",
    buildCuriosaDeckSearchPageInput(options),
    options,
  );
  return parseCuriosaDeckSearchPage(json);
}

/**
 * Fetch a public Curiosa deck by URL or deck ID.
 */
export async function fetchCuriosaDeck(
  urlOrId: string,
  options: FetchCuriosaDeckOptions = {},
): Promise<Deck> {
  const deckId = extractDeckId(urlOrId);
  if (!deckId) {
    throw new Error("Invalid Curiosa deck URL or ID");
  }
  throwIfAborted(options.signal);

  let name = "Imported Deck";
  let author: string | undefined;

  const htmlUrl = `${PROXY_PREFIX}/decks/${encodeURIComponent(deckId)}`;
  const htmlRes = await curiosaFetch(htmlUrl, undefined, options);

  if (htmlRes.status === 403 || htmlRes.status === 404 || htmlRes.status === 410) {
    throw new Error(`Curiosa deck is unavailable (${htmlRes.status})`);
  }

  if (htmlRes.ok) {
    throwIfAborted(options.signal);
    const html = await htmlRes.text();
    const parsed = parseDeckMetaFromHtml(html);
    if (parsed.name) name = parsed.name;
    if (parsed.author) author = parsed.author;
  }

  const query: Record<string, { json: { id: string } }> = {};
  for (let i = 0; i < 4; i += 1) {
    query[String(i)] = { json: { id: deckId } };
  }

  const procedures = [
    "deck.getDecklistById",
    "deck.getAvatarById",
    "deck.getSideboardById",
    "deck.getMaybeboardById",
  ];
  const input = encodeURIComponent(JSON.stringify(query));
  const trpcUrl = `${PROXY_PREFIX}/api/trpc/${procedures.join(",")}?batch=1&input=${input}`;

  const trpcRes = await curiosaFetch(trpcUrl, {
    headers: { accept: "application/json" },
  }, options);

  if (!trpcRes.ok) {
    const message = await readCuriosaError(trpcRes);
    throw new Error(`Curiosa API error ${trpcRes.status}: ${message}`);
  }

  throwIfAborted(options.signal);
  const results = (await trpcRes.json()) as unknown;
  if (!Array.isArray(results) || results.length !== procedures.length) {
    throw new Error("Unexpected response format from curiosa.io");
  }

  const now = new Date().toISOString();
  return {
    id: buildCuriosaDeckId(deckId),
    name,
    author,
    boards: {
      mainboard: parseBoardData(readTrpcJson(results[0], procedures[0] ?? ""), "mainboard"),
      avatar: parseBoardData(readTrpcJson(results[1], procedures[1] ?? ""), "avatar"),
      sideboard: parseBoardData(readTrpcJson(results[2], procedures[2] ?? ""), "sideboard"),
      maybeboard: parseBoardData(
        readTrpcJson(results[3], procedures[3] ?? ""),
        "maybeboard",
      ),
    },
    createdAt: now,
    updatedAt: now,
  };
}
