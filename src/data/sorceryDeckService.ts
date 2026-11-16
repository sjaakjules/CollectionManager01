/** Public SorceryTCG deck imports and search through the shared request queue. */
import type { Deck } from "./dataModels";
import {
  SORCERY_DECK_PROXY, buildDeckRequestInput, extractDeckId,
  parseSorceryDeck, readDeckPrimer,
} from "./sorceryDeckSource.ts";
import { sorceryClient, type SorceryDelay } from "./sorceryRequest.ts";
export { extractDeckId } from "./sorceryDeckSource.ts";

const PROXY_PREFIX = SORCERY_DECK_PROXY;

export type SorceryFetchDelay = SorceryDelay;

export interface FetchSorceryDeckOptions {
  signal?: AbortSignal;
  onDelay?: (delay: SorceryFetchDelay) => void;
}

export interface SorceryDeckSearchSummary {
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

export interface SorceryDeckSearchBaseOptions {
  query: string;
  avatar?: string;
  elements?: string[];
  notElements?: string[];
  formats?: string[];
  inclusions?: string[];
  exclusions?: string[];
}

export interface SorceryDeckSearchPageOptions extends SorceryDeckSearchBaseOptions {
  sort?: string;
  limit?: number;
  cursor?: number;
  direction?: "forward" | "backward";
}

export interface FetchSorceryDeckSearchPageOptions
  extends SorceryDeckSearchPageOptions,
    FetchSorceryDeckOptions {}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
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

function readTrpcJson(entry: unknown, procedure: string): unknown {
  const record = asRecord(entry);
  const error = asRecord(record?.error);
  const errorJson = asRecord(error?.json);
  const errorMessage = readString(errorJson?.message);
  if (errorMessage) {
    throw new Error(`SorceryTCG ${procedure} error: ${errorMessage}`);
  }

  const result = asRecord(record?.result);
  const data = asRecord(result?.data);
  if (!data || !("json" in data)) {
    throw new Error(`Unexpected SorceryTCG response for ${procedure}`);
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

export function buildSorceryDeckSearchPageInput(
  options: SorceryDeckSearchPageOptions,
): Record<string, { json: Record<string, unknown> }> {
  const json: Record<string, unknown> = {
    query: normalizeSearchQuery(options.query),
    scope: "all",
    sort: options.sort === "relevance" ? "PopularityDesc"
      : options.sort === "latest" ? "UpdatedDesc" : options.sort ?? "UpdatedDesc",
    avatar: options.avatar && options.avatar !== "*" ? options.avatar : null,
    elements: options.elements ?? [], notElements: options.notElements ?? [],
    formats: options.formats ?? [], inclusions: options.inclusions ?? [],
    exclusions: options.exclusions ?? [],
    limit: normalizeSearchLimit(options.limit),
  };

  if (options.cursor !== undefined && options.cursor > 0) {
    json.cursor = Math.floor(options.cursor);
  }

  return { "0": { json } };
}

function normalizeSearchUser(value: unknown): SorceryDeckSearchSummary["user"] {
  const record = asRecord(value);
  if (!record) return undefined;

  const id = readString(record.id);
  const username = readString(record.username);
  if (!id && !username) return undefined;

  return { id, username };
}

function parseSearchSummary(entry: unknown): SorceryDeckSearchSummary | null {
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
    primer: readDeckPrimer(record.primer),
    hotscore: readNumber(record.popularity) ?? readNumber(record.hotscore),
    user: normalizeSearchUser(record.owner ?? record.user),
    elements,
    likes,
    views,
  };
}

export function parseSorceryDeckSearchPage(raw: unknown): SorceryDeckSearchSummary[] {
  const record = asRecord(raw);
  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray(record?.decks)
      ? record.decks
      : Array.isArray(record?.items)
        ? record.items
        : Array.isArray(record?.results)
          ? record.results
          : null;
  if (!entries) throw new Error("Unexpected SorceryTCG deck search response");

  return entries
    .map((entry) => parseSearchSummary(entry))
    .filter((entry): entry is SorceryDeckSearchSummary => entry !== null);
}

async function readSorceryError(response: Response): Promise<string> {
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
 * Deterministic app deck id for a Sorcery deck.
 *
 * Re-importing the same Sorcery URL (or seeding the same deck via
 * `scripts/build-guest-seed-decks.mjs`, which uses the same convention)
 * resolves to the same deck instead of creating a duplicate.
 */
export function buildSorceryDeckId(deckId: string): string {
  return `sorcery-${deckId}`;
}

async function fetchSorceryTrpcJson(
  procedure: string,
  input: Record<string, unknown>,
  options: FetchSorceryDeckOptions,
): Promise<unknown> {
  const encodedInput = encodeURIComponent(JSON.stringify(input));
  const trpcUrl = `${PROXY_PREFIX}/api/trpc/${procedure}?batch=1&input=${encodedInput}`;
  const response = await sorceryClient.fetch(trpcUrl, {
    headers: { accept: "application/json" },
  }, options);

  if (!response.ok) {
    const message = await readSorceryError(response);
    throw new Error(`SorceryTCG API error ${response.status}: ${message}`);
  }

  throwIfAborted(options.signal);
  const results = (await response.json()) as unknown;
  if (!Array.isArray(results) || results.length !== 1) {
    throw new Error(`Unexpected response format from SorceryTCG for ${procedure}`);
  }

  return readTrpcJson(results[0], procedure);
}

export async function fetchSorceryDeckSearchPage(
  options: FetchSorceryDeckSearchPageOptions,
): Promise<SorceryDeckSearchSummary[]> {
  const json = await fetchSorceryTrpcJson(
    "deck.search",
    buildSorceryDeckSearchPageInput(options),
    options,
  );
  return parseSorceryDeckSearchPage(json);
}

/** Fetch a deck in one request, including its name, author and all boards. */
export async function fetchSorceryDeck(
  urlOrId: string,
  options: FetchSorceryDeckOptions = {},
): Promise<Deck> {
  const deckId = extractDeckId(urlOrId);
  if (!deckId) throw new Error("Enter a SorceryTCG deck URL, or a deck ID");
  throwIfAborted(options.signal);
  const raw = await fetchSorceryTrpcJson("deck.get", buildDeckRequestInput(deckId), options);
  throwIfAborted(options.signal);
  const deck = parseSorceryDeck(raw, deckId);
  const now = new Date().toISOString();
  return {
    id: buildSorceryDeckId(deckId),
    name: deck.metadata.name,
    author: deck.metadata.user?.username,
    boards: deck.boards,
    createdAt: now,
    updatedAt: now,
  };
}
