/** Maintenance-only parser. Never imported by the website; no transport or credentials. */
export const PLAY_SORCERY_CARDS_URL = 'https://playsorceryonline.com/api/game-analytics/cards?format=constructed';
export const ANALYTICS_MAX_BYTES = 10 * 1024 * 1024;
export const ANALYTICS_METRICS = ['inDeck', 'played', 'openingHand', 'inHand', 'notInHand', 'inDeckUnplayed'] as const;
export type AnalyticsMetric = typeof ANALYTICS_METRICS[number];

export interface AnalyticsSample {
  playerGames: number | null;
  matches: number | null;
  wins: number | null;
  winRate: number | null;
}

export interface AnalyticsCard {
  cardKey: string;
  cardName: string;
  deckShare: number;
  inDeck: AnalyticsSample;
  played: AnalyticsSample;
  openingHand: AnalyticsSample;
  inHand: AnalyticsSample;
  notInHand: AnalyticsSample;
  inDeckUnplayed: AnalyticsSample;
}

export interface AnalyticsResponse {
  releasedThrough: string;
  dataAvailable: boolean;
  totalGames: number;
  generatedAt: number;
  totalPlayerGames: number;
  cards: AnalyticsCard[];
}

export interface AnalyticsSnapshot {
  version: 1;
  source: typeof PLAY_SORCERY_CARDS_URL;
  format: 'constructed';
  importedAt: string;
  data: AnalyticsResponse;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a card analytics JSON object. Export the response body, not a HAR or request headers.');
  return value as Record<string, unknown>;
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${field}: expected a non-negative integer.`);
  return value;
}

function probability(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid ${field}: expected a rate from 0 to 1.`);
  return value;
}

function label(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || [...value].some((character) => character.charCodeAt(0) < 32)) throw new Error(`Invalid ${field}.`);
  return value.trim();
}

function sample(value: unknown, field: string, totalPlayerGames: number): AnalyticsSample {
  const data = record(value);
  const playerGames = data.playerGames === null ? null : count(data.playerGames, `${field}.playerGames`);
  const matches = data.matches === null ? null : count(data.matches, `${field}.matches`);
  const wins = data.wins === null ? null : count(data.wins, `${field}.wins`);
  const winRate = data.winRate === null ? null : probability(data.winRate, `${field}.winRate`);
  if ((playerGames !== null && playerGames > totalPlayerGames)
    || (matches !== null && playerGames !== null && matches > playerGames)
    || (wins !== null && playerGames !== null && wins > playerGames)
    || (winRate !== null && playerGames === 0)) throw new Error(`Inconsistent counts in ${field}.`);
  // Preserve suppressed values, including counts. Do not infer them from other cohorts.
  return { playerGames, matches, wins, winRate };
}

export function analyticsNameKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
}

/** Allowlist fields so request headers, cookies and unrelated identity data cannot be saved. */
export function parseAnalyticsSnapshot(input: unknown, now = new Date()): AnalyticsSnapshot {
  const root = record(input);
  const wrapped = 'version' in root;
  if (wrapped && (root.version !== 1 || root.source !== PLAY_SORCERY_CARDS_URL || root.format !== 'constructed')) {
    throw new Error('Unsupported analytics snapshot. Import the full constructed card response.');
  }
  const data = wrapped ? record(root.data) : root;
  const releasedThrough = data.releasedThrough;
  if (typeof releasedThrough !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(releasedThrough)
    || !Number.isFinite(Date.parse(releasedThrough)) || new Date(releasedThrough).toISOString().slice(0, 10) !== releasedThrough) {
    throw new Error('Missing or invalid release date. Import the card analytics response body.');
  }
  if (typeof data.dataAvailable !== 'boolean') throw new Error('Missing data availability flag.');
  if (!data.dataAvailable) throw new Error('This response has no released analytics. Your previous snapshot has been kept.');
  const totalGames = count(data.totalGames, 'totalGames');
  const totalPlayerGames = count(data.totalPlayerGames, 'totalPlayerGames');
  const generatedAt = count(data.generatedAt, 'generatedAt');
  if (!Number.isFinite(new Date(generatedAt).getTime())) throw new Error('Invalid generation date.');
  if (!Array.isArray(data.cards) || data.cards.length === 0 || data.cards.length > 10000) throw new Error('Expected a non-empty card analytics list (maximum 10,000 cards).');
  const keys = new Set<string>();
  const names = new Set<string>();
  const cards = data.cards.map((entry, index): AnalyticsCard => {
    const row = record(entry);
    const cardKey = label(row.cardKey, `card ${index + 1} key`);
    const cardName = label(row.cardName, `card ${index + 1} name`);
    const nameKey = analyticsNameKey(cardName);
    if (keys.has(cardKey) || names.has(nameKey)) throw new Error(`Duplicate analytics card at row ${index + 1}.`);
    keys.add(cardKey);
    names.add(nameKey);
    return {
      cardKey, cardName, deckShare: probability(row.deckShare, 'deckShare'),
      inDeck: sample(row.inDeck, 'inDeck', totalPlayerGames),
      played: sample(row.played, 'played', totalPlayerGames),
      openingHand: sample(row.openingHand, 'openingHand', totalPlayerGames),
      inHand: sample(row.inHand, 'inHand', totalPlayerGames),
      notInHand: sample(row.notInHand, 'notInHand', totalPlayerGames),
      inDeckUnplayed: sample(row.inDeckUnplayed, 'inDeckUnplayed', totalPlayerGames),
    };
  });
  const importedAt = wrapped && typeof root.importedAt === 'string' ? root.importedAt : now.toISOString();
  if (!Number.isFinite(Date.parse(importedAt))) throw new Error('Invalid import date.');
  return {
    version: 1, source: PLAY_SORCERY_CARDS_URL, format: 'constructed', importedAt: new Date(importedAt).toISOString(),
    data: { releasedThrough, dataAvailable: true, totalGames, totalPlayerGames, generatedAt, cards },
  };
}

export function parseAnalyticsText(text: string): AnalyticsSnapshot {
  if (new TextEncoder().encode(text).byteLength > ANALYTICS_MAX_BYTES) throw new Error('Analytics files must be smaller than 10 MB.');
  let input: unknown;
  try { input = JSON.parse(text); }
  catch { throw new Error('This file is not JSON. Save the analytics response body, not the login page or request headers.'); }
  return parseAnalyticsSnapshot(input);
}

/** Join by name only; never copy the catalogue into the analytics snapshot. */
export function matchAnalyticsCards(snapshot: AnalyticsSnapshot, catalogue: ReadonlyArray<{ name: string }>) {
  const byName = new Map<string, string | null>();
  for (const { name } of catalogue) {
    const key = analyticsNameKey(name);
    byName.set(key, byName.has(key) && byName.get(key) !== name ? null : name);
  }
  return snapshot.data.cards.map((stats) => ({ stats, catalogueName: byName.get(analyticsNameKey(stats.cardName)) ?? null }));
}

export function drawnDifference(card: AnalyticsCard): number | null {
  return card.inHand.winRate === null || card.notInHand.winRate === null
    ? null : (card.inHand.winRate - card.notInHand.winRate) * 100;
}
