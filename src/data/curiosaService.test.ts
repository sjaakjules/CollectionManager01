/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

const EXAMPLE_ID = 'cmm45q5mu00dh04l7mzhl477o';
const EXAMPLE_URL = `https://curiosa.io/decks/${EXAMPLE_ID}`;

interface FetchCall {
  url: string;
  time: number;
  signal: AbortSignal | null;
}

function htmlFixture(name = 'Heavier than a Duck - 2nd place SCGCon DC Grand Contest') {
  return `<!doctype html>
    <html>
      <head>
        <title>${name} | by @emperorigor.</title>
      </head>
      <body>
        <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          props: {
            pageProps: {
              trpcState: {
                json: {
                  queries: [
                    {
                      state: {
                        data: {
                          id: EXAMPLE_ID,
                          name,
                          user: { username: 'emperorigor' },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        })}</script>
      </body>
    </html>`;
}

function boardEntries(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    card: {
      name:
        index === 0 && prefix === 'mainboard'
          ? 'Colicky Dragonettes'
          : `${prefix} card ${index + 1}`,
    },
    quantity: index === 0 ? 3 : 1,
  }));
}

function trpcFixture() {
  return [
    { result: { data: { json: boardEntries('mainboard', 50) } } },
    { result: { data: { json: [{ card: { name: 'Persecutor' }, quantity: 1 }] } } },
    { result: { data: { json: boardEntries('sideboard', 9) } } },
    { result: { data: { json: [] } } },
  ];
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-limit': '30',
      'x-ratelimit-remaining': '29',
      ...(init.headers ?? {}),
    },
  });
}

function htmlResponse(
  body = htmlFixture(),
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      'content-type': 'text/html',
      ...(init.headers ?? {}),
    },
  });
}

function mockFetchSequence(responses: Response[]) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), time: Date.now(), signal: init?.signal ?? null });
    const response = responses.shift();
    if (!response) {
      throw new Error(`Unexpected fetch call: ${String(url)}`);
    }
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function loadService() {
  vi.resetModules();
  return import('@/data/curiosaService');
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await flushMicrotasks();
}

describe('Curiosa deck service', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('extracts only raw IDs and Curiosa deck URLs', async () => {
    const { extractDeckId } = await loadService();

    expect(extractDeckId(EXAMPLE_URL)).toBe(EXAMPLE_ID);
    expect(extractDeckId(`${EXAMPLE_URL}?tab=list#top`)).toBe(EXAMPLE_ID);
    expect(extractDeckId(`curiosa.io/decks/${EXAMPLE_ID}`)).toBe(EXAMPLE_ID);
    expect(extractDeckId(EXAMPLE_ID)).toBe(EXAMPLE_ID);
    expect(extractDeckId('https://example.com/decks/not-this')).toBe('');
    expect(extractDeckId('curiosa.io/cards/persecutor')).toBe('');
  });

  it('parses the example deck shape and metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { calls, fetchMock } = mockFetchSequence([
      htmlResponse(),
      jsonResponse(trpcFixture()),
    ]);
    const { fetchCuriosaDeck } = await loadService();

    const deckPromise = fetchCuriosaDeck(EXAMPLE_URL);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(3000);

    const deck = await deckPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls.map((call) => call.time)).toEqual([0, 3000]);
    expect(deck.name).toBe('Heavier than a Duck - 2nd place SCGCon DC Grand Contest');
    expect(deck.author).toBe('emperorigor');
    expect(deck.boards.mainboard).toHaveLength(50);
    expect(deck.boards.mainboard[0]).toEqual({
      name: 'Colicky Dragonettes',
      quantity: 3,
    });
    expect(deck.boards.avatar).toEqual([{ name: 'Persecutor', quantity: 1 }]);
    expect(deck.boards.sideboard).toHaveLength(9);
    expect(deck.boards.maybeboard).toHaveLength(0);
  });

  it('does not request tRPC data for unavailable deck pages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { fetchMock } = mockFetchSequence([htmlResponse('', { status: 404 })]);
    const { fetchCuriosaDeck } = await loadService();

    const deckPromise = fetchCuriosaDeck(EXAMPLE_URL);
    await flushMicrotasks();

    await expect(deckPromise).rejects.toThrow('Curiosa deck is unavailable (404)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces invalid-origin tRPC failures', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mockFetchSequence([
      htmlResponse(),
      jsonResponse(
        [
          {
            error: {
              json: {
                message: 'Forbidden: Invalid origin',
                data: { path: 'deck.getDecklistById' },
              },
            },
          },
        ],
        { status: 403, headers: { 'x-ratelimit-remaining': '29' } },
      ),
    ]);
    const { fetchCuriosaDeck } = await loadService();

    const deckPromise = fetchCuriosaDeck(EXAMPLE_URL);
    const rejection = expect(deckPromise).rejects.toThrow('Invalid origin');
    await flushMicrotasks();
    await advance(3000);

    await rejection;
  });

  it('surfaces per-entry tRPC errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const results: unknown[] = trpcFixture();
    results[2] = {
      error: {
        json: {
          message: 'Deck sideboard failed',
          data: { path: 'deck.getSideboardById' },
        },
      },
    };
    mockFetchSequence([htmlResponse(), jsonResponse(results)]);
    const { fetchCuriosaDeck } = await loadService();

    const deckPromise = fetchCuriosaDeck(EXAMPLE_URL);
    const rejection = expect(deckPromise).rejects.toThrow('Deck sideboard failed');
    await flushMicrotasks();
    await advance(3000);

    await rejection;
  });

  it('serializes concurrent Curiosa requests and spaces them by local refill ticks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { calls, fetchMock } = mockFetchSequence([
      htmlResponse(),
      htmlResponse(),
      jsonResponse(trpcFixture()),
      jsonResponse(trpcFixture()),
    ]);
    const { fetchCuriosaDeck } = await loadService();

    const firstDeck = fetchCuriosaDeck(`${EXAMPLE_URL}?first=true`);
    const secondDeck = fetchCuriosaDeck(`curiosa.io/decks/${EXAMPLE_ID}`);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(3000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(3000);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await Promise.all([firstDeck, secondDeck]);
    expect(calls.map((call) => call.time)).toEqual([0, 3000, 6000, 9000]);
  });

  it('waits for local replenishment when Curiosa remaining budget is low', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { calls, fetchMock } = mockFetchSequence([
      htmlResponse(htmlFixture(), {
        headers: { 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '2' },
      }),
      jsonResponse(trpcFixture()),
    ]);
    const { fetchCuriosaDeck } = await loadService();

    const deckPromise = fetchCuriosaDeck(EXAMPLE_URL);
    await flushMicrotasks();

    await advance(8999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    await deckPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls.map((call) => call.time)).toEqual([0, 9000]);
  });

  it('retries once when Curiosa supplies Retry-After', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { calls, fetchMock } = mockFetchSequence([
      htmlResponse(),
      jsonResponse(
        [{ error: { json: { message: 'Too Many Requests' } } }],
        {
          status: 429,
          headers: { 'retry-after': '2', 'x-ratelimit-remaining': '0' },
        },
      ),
      jsonResponse(trpcFixture()),
    ]);
    const { fetchCuriosaDeck } = await loadService();

    const deckPromise = fetchCuriosaDeck(EXAMPLE_URL);
    await flushMicrotasks();
    await advance(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(3000);

    await deckPromise;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls.map((call) => call.time)).toEqual([0, 3000, 6000]);
  });

  it('cancels queued import work with AbortController', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { calls, fetchMock } = mockFetchSequence([
      htmlResponse(),
      jsonResponse(trpcFixture()),
    ]);
    const { fetchCuriosaDeck } = await loadService();
    const controller = new AbortController();

    const deckPromise = fetchCuriosaDeck(EXAMPLE_URL, { signal: controller.signal });
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]?.signal).toBe(controller.signal);
    controller.abort();

    await expect(deckPromise).rejects.toMatchObject({ name: 'AbortError' });
    await advance(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports client and server throttle delays', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mockFetchSequence([
      htmlResponse(htmlFixture(), {
        headers: {
          'x-sorcery-proxy-delay-ms': '1500',
          'x-sorcery-proxy-delay-reason': 'spacing',
        },
      }),
      jsonResponse(trpcFixture()),
    ]);
    const { fetchCuriosaDeck } = await loadService();
    const delays: unknown[] = [];

    const deckPromise = fetchCuriosaDeck(EXAMPLE_URL, {
      onDelay: (delay) => delays.push(delay),
    });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(delays).toContainEqual({
      delayMs: 1500,
      reason: 'spacing',
      source: 'server',
    });

    await advance(3000);
    await deckPromise;

    expect(delays).toContainEqual({
      delayMs: 3000,
      reason: 'local-spacing',
      source: 'client',
    });
  });
});
