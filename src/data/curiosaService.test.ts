import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/sorcery-deck.json';
import { extractDeckId, parseSorceryDeck, readDeckPrimer } from './sorceryDeckSource';

const ID = fixture.id;
const DECK_URL = `https://sorcerytcg.com/decks/${ID}`;

function response(data: unknown = fixture, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify([{ result: { data: { json: data } } }]), {
    headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '29', ...headers },
  });
}

function mockFetchSequence(responses: Response[]) {
  const calls: { url: string; time: number; signal?: AbortSignal | null }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), time: Date.now(), signal: init?.signal });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request: ${String(url)}`);
    return next;
  }));
  return calls;
}

async function loadService() {
  vi.resetModules();
  return import('./curiosaService');
}

describe('SorceryTCG deck compatibility', () => {
  it.each([
    DECK_URL, `${DECK_URL}/?tab=list#top`, `sorcerytcg.com/decks/${ID}`,
    `https://www.sorcerytcg.com/decks/${ID}`, `https://curiosa.io/decks/${ID}`,
    `www.curiosa.io/decks/${ID}`, ID,
  ])('accepts current and legacy deck links: %s', (input) => {
    expect(extractDeckId(input)).toBe(ID);
  });

  it.each([
    'https://example.com/decks/a', 'https://sorcerytcg.com.evil.test/decks/a',
    'https://curiosa.io@evil.test/decks/a', 'https://user@sorcerytcg.com/decks/a',
    'ftp://sorcerytcg.com/decks/a', 'https://sorcerytcg.com:8443/decks/a',
    'https://sorcerytcg.com/cards/a', 'https://sorcerytcg.com/other/decks/a',
    'https://sorcerytcg.com/decks/a/extra', 'javascript:alert(1)', '',
  ])('rejects unrelated or malformed links: %s', (input) => {
    expect(extractDeckId(input)).toBe('');
  });

  it('preserves every board and quantity from the supplied live example', () => {
    const deck = parseSorceryDeck(fixture, ID);
    expect(deck.metadata.name).toBe('Heeeey Red');
    expect(deck.metadata.user?.username).toBe('sjaak');
    expect(deck.boards.avatar).toEqual([{ name: 'Bladedancer', quantity: 1 }]);
    const boards = ['mainboard', 'avatar', 'collection', 'maybeboard'] as const;
    expect(Object.fromEntries(boards.map((board) => [
      board, deck.boards[board].reduce((total, card) => total + card.quantity, 0),
    ]))).toEqual({ mainboard: 106, avatar: 1, collection: 10, maybeboard: 30 });
  });

  it('combines printings without losing quantities or unknown card names', () => {
    const deck = parseSorceryDeck({ ...fixture, decklist: [
      { board: 'Main', quantity: 2, card: { name: 'Future Trap' } },
      { board: 'Main', quantity: 1, card: { name: 'Future Trap' } },
    ] }, ID);
    expect(deck.boards.mainboard).toEqual([{ name: 'Future Trap', quantity: 3 }]);
  });

  it.each([
    { ...fixture, id: 'different-deck' }, { ...fixture, decklist: undefined },
    { ...fixture, decklist: [{ board: 'New Board', quantity: 1, card: { name: 'A' } }] },
    { ...fixture, decklist: [null] },
    { ...fixture, decklist: [{ board: 'Main', quantity: 0, card: { name: 'A' } }] },
    { ...fixture, decklist: [{ board: 'Main', quantity: 1, card: null }] },
  ])('rejects incompatible data instead of importing an incomplete deck', (data) => {
    expect(() => parseSorceryDeck(data, ID)).toThrow();
  });

  it('reads the new primer format and preserves existing text primers', () => {
    expect(readDeckPrimer([{ children: [{ text: '1st Place ' }, { text: 'Melbourne' }] },
      { children: [{ text: 'Grand Contest' }] }])).toBe('1st Place Melbourne\nGrand Contest');
    expect(readDeckPrimer('<p>Old primer</p>')).toBe('<p>Old primer</p>');
  });
});

describe('SorceryTCG deck requests', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

  it('imports the example with one request and retains stable saved deck IDs', async () => {
    const calls = mockFetchSequence([response()]);
    const { fetchCuriosaDeck } = await loadService();
    const deck = await fetchCuriosaDeck(DECK_URL);
    expect(deck.id).toBe(`curiosa-${ID}`);
    expect(deck.name).toBe('Heeeey Red');
    expect(deck.author).toBe('sjaak');
    expect(calls).toHaveLength(1);
    const request = new URL(calls[0]?.url ?? '', 'http://localhost');
    expect(request.pathname).toBe('/api/decks/api/trpc/deck.get');
    expect(JSON.parse(request.searchParams.get('input') ?? 'null')).toEqual({
      '0': { json: { id: ID, collectionTracking: false } },
    });
  });

  it('does not fetch an invalid URL', async () => {
    const calls = mockFetchSequence([]);
    const { fetchCuriosaDeck } = await loadService();
    await expect(fetchCuriosaDeck('https://example.com/decks/a')).rejects.toThrow('deck URL');
    expect(calls).toHaveLength(0);
  });

  it.each([403, 404, 410])('stops for unavailable decks (%s)', async (status) => {
    const calls = mockFetchSequence([new Response('Deck unavailable', { status })]);
    const { fetchCuriosaDeck } = await loadService();
    await expect(fetchCuriosaDeck(DECK_URL)).rejects.toThrow('Deck unavailable');
    expect(calls).toHaveLength(1);
  });

  it('rejects tRPC errors and null/private deck responses', async () => {
    const { fetchCuriosaDeck } = await loadService();
    mockFetchSequence([new Response(JSON.stringify([{ error: { json: { message: 'Not found' } } }]))]);
    await expect(fetchCuriosaDeck(DECK_URL)).rejects.toThrow('Not found');
    expect(() => parseSorceryDeck(null, ID)).toThrow('unavailable or private');
  });

  it('serializes concurrent imports, including legacy URLs, with three-second spacing', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const calls = mockFetchSequence([response(), response()]);
    const { fetchCuriosaDeck } = await loadService();
    const first = fetchCuriosaDeck(DECK_URL);
    const second = fetchCuriosaDeck(`https://curiosa.io/decks/${ID}`);
    await first;
    await vi.advanceTimersByTimeAsync(3000);
    const decks = await Promise.all([first, second]);
    expect(decks[0].id).toBe(decks[1].id);
    expect(calls.map((call) => call.time)).toEqual([0, 3000]);
  });

  it('waits longer when the remaining server budget is low', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const calls = mockFetchSequence([response(fixture, { 'x-ratelimit-remaining': '2' }), response()]);
    const { fetchCuriosaDeck } = await loadService();
    await fetchCuriosaDeck(DECK_URL);
    const next = fetchCuriosaDeck(DECK_URL);
    await vi.advanceTimersByTimeAsync(8999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await next;
    expect(calls.map((call) => call.time)).toEqual([0, 9000]);
  });

  it('honours Retry-After with only one retry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const limited = () => new Response('Too many requests', { status: 429, headers: { 'retry-after': '2' } });
    const calls = mockFetchSequence([limited(), limited()]);
    const { fetchCuriosaDeck } = await loadService();
    const result = expect(fetchCuriosaDeck(DECK_URL)).rejects.toThrow('429');
    await vi.advanceTimersByTimeAsync(3000);
    await result;
    expect(calls.map((call) => call.time)).toEqual([0, 3000]);
  });

  it('cancels queued imports before they reach the server', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const calls = mockFetchSequence([response()]);
    const { fetchCuriosaDeck } = await loadService();
    await fetchCuriosaDeck(DECK_URL);
    const controller = new AbortController();
    const result = expect(fetchCuriosaDeck(DECK_URL, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await result;
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toHaveLength(1);
  });

  it('reports client and server waits and passes the cancellation signal through', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const calls = mockFetchSequence([response(fixture, { 'x-sorcery-proxy-delay-ms': '1500' }), response()]);
    const { fetchCuriosaDeck } = await loadService();
    const onDelay = vi.fn();
    const controller = new AbortController();
    await fetchCuriosaDeck(DECK_URL, { onDelay, signal: controller.signal });
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    const next = fetchCuriosaDeck(DECK_URL, { onDelay });
    await vi.advanceTimersByTimeAsync(3000); await next;
    expect(onDelay).toHaveBeenCalledWith(expect.objectContaining({ source: 'server', delayMs: 1500 }));
    expect(onDelay).toHaveBeenCalledWith(expect.objectContaining({ source: 'client', delayMs: 3000 }));
  });
});
