import { describe, expect, it, vi } from 'vitest';

import {
  buildArchiveDeck,
  buildCardTypeLookup,
  createCuriosaClient,
  extractDeckInputs,
  fetchCuriosaDeckFromCuriosa,
  formatCuriosaHealthLine,
  formatDashboardLines,
  formatProgressLine,
  mergeCompetitiveAnnotation,
  mergeDeckIntoArchive,
  parseArgs,
  prioritizeDeckInputs,
  runArchive,
  splitDeckBoards,
} from './fetch-curiosa-decks.mjs';

const DECK_ID = 'cmkczpwgh00f304js9feygkpr';

describe('Curiosa archive CLI options', () => {
  it('automatically rebuilds styles for the app archive and allows an override', () => {
    expect(parseArgs([
      '--input',
      'tmp/decks.json',
      '--output',
      'offlineData/deckArchive.json',
    ]).rebuildLookup).toBe(true);
    expect(parseArgs([
      '--input',
      'tmp/decks.json',
      '--output',
      'offlineData/deckArchive.json',
      '--no-rebuild-lookup',
    ]).rebuildLookup).toBe(false);
    expect(parseArgs([
      '--input',
      'tmp/decks.json',
      '--output',
      'tmp/test-archive.json',
    ]).rebuildLookup).toBe(false);
  });
});

function response(body, init = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      'content-type': init.contentType ?? 'application/json',
      'x-ratelimit-limit': '30',
      'x-ratelimit-remaining': '29',
      ...(init.headers ?? {}),
    },
  });
}

function jsonResponse(body, init) {
  return response(JSON.stringify(body), init);
}

function htmlFixture() {
  return `<!doctype html>
    <html>
      <head>
        <title>Fallback Title | Curiosa</title>
      </head>
      <body>
        <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          props: {
            pageProps: {
              deck: {
                id: DECK_ID,
                createdAt: '2026-01-13T19:34:05.954Z',
                updatedAt: '2026-01-14T08:03:19.525Z',
                name: 'SCG Atlanta 4th',
                format: 'Constructed',
                hotscore: 1,
                user: { id: 'user-1', username: 'PeterTheGreat' },
                elements: ['Earth', 'Fire'],
              },
            },
          },
        })}</script>
      </body>
    </html>`;
}

function trpcFixture() {
  return [
    {
      result: {
        data: {
          json: [
            { card: { name: 'Site A' }, quantity: 30 },
            { card: { name: 'Spell A' }, quantity: 60 },
          ],
        },
      },
    },
    { result: { data: { json: [{ card: { name: 'Druid' }, quantity: 1 }] } } },
    { result: { data: { json: [{ card: { name: 'Sideboard A' }, quantity: 2 }] } } },
    { result: { data: { json: [{ card: { name: 'Maybe A' }, quantity: 3 }] } } },
  ];
}

describe('Curiosa archive input extraction', () => {
  it('extracts first search result IDs and hints when limited per file', () => {
    const inputs = extractDeckInputs(
      {
        decks: [
          {
            id: 'deck-a',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            name: 'Deck A',
            format: 'Constructed',
            user: { id: 'user-a', username: 'Alice' },
            elements: ['Fire'],
          },
          { id: 'https://curiosa.io/decks/deck-b?tab=list', name: 'Deck B' },
          { id: 'deck-c', name: 'Deck C' },
        ],
      },
      'tmp/Search_SCG.json',
      { limitPerFile: 2 },
    );

    expect(inputs.map((input) => input.id)).toEqual(['deck-a', 'deck-b']);
    expect(inputs[0].hint).toMatchObject({
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      name: 'Deck A',
      user: { id: 'user-a', username: 'Alice' },
    });
  });

  it('extracts first URL-list deck IDs when limited per file', () => {
    const inputs = extractDeckInputs(
      {
        Decks: [
          'https://curiosa.io/decks/deck-a',
          'curiosa.io/decks/deck-b?tab=list',
          'https://example.com/decks/not-curiosa',
        ],
      },
      'tmp/decks.json',
      { limitPerFile: 2 },
    );

    expect(inputs.map((input) => input.id)).toEqual(['deck-a', 'deck-b']);
  });
});

describe('Curiosa archive deck shaping', () => {
  it('splits mainboard sites into atlas and other known types into spellbook', () => {
    const lookup = buildCardTypeLookup([
      { name: 'Site A', guardian: { type: 'Site' } },
      { name: 'Spell A', guardian: { type: 'Magic' } },
      { name: 'Minion A', guardian: { type: 'Minion' } },
    ]);

    const split = splitDeckBoards(
      {
        mainboard: [
          { name: 'Site A', quantity: 2 },
          { name: 'Spell A', quantity: 3 },
          { name: 'Minion A', quantity: 4 },
        ],
        sideboard: [{ name: 'Sideboard A', quantity: 1 }],
        maybeboard: [{ name: 'Maybe A', quantity: 2 }],
      },
      lookup,
    );

    expect(split.cards).toEqual({
      spellbook: { 'Spell A': 3, 'Minion A': 4 },
      atlas: { 'Site A': 2 },
      collection: { 'Sideboard A': 1 },
      maybe: { 'Maybe A': 2 },
    });
    expect(split.cardCount).toEqual({
      spellbook: 7,
      atlas: 2,
      collection: 1,
      maybe: 2,
    });
  });

  it('collects all unknown mainboard cards and minimum-count errors before skipping', () => {
    const lookup = buildCardTypeLookup([
      { name: 'Known Spell', guardian: { type: 'Magic' } },
      { name: 'Known Site', guardian: { type: 'Site' } },
    ]);

    const result = buildArchiveDeck(
      {
        id: 'deck-a',
        metadata: { name: 'Too Small' },
        boards: {
          mainboard: [
            { name: 'Known Spell', quantity: 1 },
            { name: 'Known Site', quantity: 1 },
            { name: 'Unknown One', quantity: 1 },
            { name: 'Unknown Two', quantity: 1 },
          ],
          avatar: [],
          sideboard: [],
          maybeboard: [],
        },
      },
      { id: 'deck-a' },
      lookup,
    );

    expect(result.errors.map((error) => error.type)).toEqual([
      'UNKNOWN_MAINBOARD_CARD',
      'UNKNOWN_MAINBOARD_CARD',
      'SPELLBOOK_TOO_SMALL',
      'ATLAS_TOO_SMALL',
    ]);
    expect(result.errors.map((error) => error.cardName).filter(Boolean)).toEqual([
      'Unknown One',
      'Unknown Two',
    ]);
  });
});

describe('Curiosa archive merging', () => {
  const existingArchive = {
    'deck-a': {
      deckinfo: {
        id: 'deck-a',
        updatedAt: '2026-01-10T00:00:00.000Z',
        name: 'Existing',
      },
    },
  };

  it('adds new decks', () => {
    const result = mergeDeckIntoArchive(existingArchive, {
      id: 'deck-b',
      updatedAt: '2026-01-09T00:00:00.000Z',
      name: 'New',
    });

    expect(result.status).toBe('added');
    expect(result.archive['deck-b'].deckinfo.name).toBe('New');
  });

  it('skips older or equal existing decks', () => {
    expect(
      mergeDeckIntoArchive(existingArchive, {
        id: 'deck-a',
        updatedAt: '2026-01-09T00:00:00.000Z',
        name: 'Older',
      }).status,
    ).toBe('skipped-up-to-date');

    expect(
      mergeDeckIntoArchive(existingArchive, {
        id: 'deck-a',
        updatedAt: '2026-01-10T00:00:00.000Z',
        name: 'Equal',
      }).status,
    ).toBe('skipped-up-to-date');
  });

  it('updates existing decks when the candidate is newer', () => {
    const result = mergeDeckIntoArchive(existingArchive, {
      id: 'deck-a',
      updatedAt: '2026-01-11T00:00:00.000Z',
      name: 'Newer',
    });

    expect(result.status).toBe('updated');
    expect(result.archive['deck-a'].deckinfo.name).toBe('Newer');
  });
});

describe('Curiosa archive queueing and processed skips', () => {
  it('refreshes competitive metadata without changing the online deck revision', async () => {
    const fetchDeck = vi.fn();
    const competitive = {
      isCompetitive: true,
      confidence: 'high',
      events: ['Grand Contest'],
      locations: ['Melbourne'],
      resultTags: ['winner'],
      placements: [1],
      topCuts: [],
      records: ['5-0'],
      seasons: [2026],
      matchedQueries: ['Grand Contest'],
      matchedSignals: ['event:grand-contest'],
      likes: 10,
      views: 100,
    };
    const merged = mergeCompetitiveAnnotation(
      { id: 'deck-a', name: 'Existing' },
      { competitive },
    );
    expect(merged).toEqual({
      changed: true,
      deckinfo: { id: 'deck-a', name: 'Existing', competitive },
    });

    const result = await runArchive(
      {
        inputs: [],
        output: 'archive.json',
        skippedOutput: 'archive.skipped.json',
        log: 'archive.log',
        cardData: 'cards.json',
        limitPerFile: 0,
        skipProcessed: false,
      },
      {
        inputs: [{
          id: 'deck-a',
          raw: 'deck-a',
          hint: {
            id: 'deck-a',
            updatedAt: '2026-01-01T00:00:00.000Z',
            competitive,
          },
        }],
        archive: {
          'deck-a': {
            deckinfo: {
              id: 'deck-a',
              name: 'Existing',
              updatedAt: '2026-01-01T00:00:00.000Z',
              cardCount: { spellbook: 60, atlas: 30, collection: 0, maybe: 0 },
            },
          },
        },
        skippedArchive: {},
        cardData: [],
        fetchDeck,
        liveDashboard: false,
        writeJsonFile: async () => undefined,
        writeTextFile: async () => undefined,
      },
    );

    expect(fetchDeck).not.toHaveBeenCalled();
    expect(result.summary).toMatchObject({ annotated: 1, skippedUpToDate: 1 });
    expect(result.archive['deck-a'].deckinfo.competitive).toEqual(competitive);
  });

  it('orders new decks first, archived decks second, and skipped decks last', () => {
    const inputs = [
      { id: 'skipped-deck' },
      { id: 'archived-deck' },
      { id: 'new-deck' },
    ];

    expect(prioritizeDeckInputs(
      inputs,
      { 'archived-deck': { deckinfo: { id: 'archived-deck' } } },
      { 'skipped-deck': { id: 'skipped-deck', status: 'failed' } },
    ).map((input) => input.id)).toEqual([
      'new-deck',
      'archived-deck',
      'skipped-deck',
    ]);
  });

  it('can skip archived and skipped decks without calling Curiosa', async () => {
    const fetchDeck = vi.fn();
    const writes = new Map();
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    console.log = vi.fn();
    console.error = vi.fn();

    try {
      const result = await runArchive(
        {
          inputs: [],
          output: 'archive.json',
          skippedOutput: 'archive.skipped.json',
          log: 'archive.log',
          cardData: 'cards.json',
          limitPerFile: 0,
          skipProcessed: true,
        },
        {
          inputs: [
            { id: 'archived-deck', raw: 'archived-deck', hint: { id: 'archived-deck' } },
            { id: 'skipped-deck', raw: 'skipped-deck', hint: { id: 'skipped-deck' } },
          ],
          archive: {
            'archived-deck': {
              deckinfo: {
                id: 'archived-deck',
                name: 'Archived',
                avatar: 'Avatar',
                cardCount: {
                  spellbook: 60,
                  atlas: 30,
                  collection: 10,
                  maybe: 0,
                },
              },
            },
          },
          skippedArchive: {
            'skipped-deck': {
              id: 'skipped-deck',
              status: 'failed',
              reason: 'old failure',
              deckinfo: null,
            },
          },
          cardData: [],
          fetchDeck,
          liveDashboard: false,
          nowImpl: () => 0,
          writeJsonFile: async (filePath, value) => {
            writes.set(filePath, value);
          },
          writeTextFile: async (filePath, lines) => {
            writes.set(filePath, lines);
          },
        },
      );

      expect(fetchDeck).not.toHaveBeenCalled();
      expect(result.summary.skippedProcessed).toBe(2);
      expect(result.logLines).toContain('skipped-processed archived-deck');
      expect(result.logLines).toContain('skipped-processed skipped-deck');
    } finally {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    }
  });

  it('stores invalid decks in the skipped archive', async () => {
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    console.log = vi.fn();
    console.error = vi.fn();

    try {
      const result = await runArchive(
        {
          inputs: [],
          output: 'archive.json',
          skippedOutput: 'archive.skipped.json',
          log: 'archive.log',
          cardData: 'cards.json',
          limitPerFile: 0,
          skipProcessed: false,
        },
        {
          inputs: [
            { id: 'invalid-deck', raw: 'invalid-deck', hint: { id: 'invalid-deck' } },
          ],
          archive: {},
          skippedArchive: {},
          cardData: [
            { name: 'Known Spell', guardian: { type: 'Magic' } },
          ],
          fetchDeck: async () => ({
            id: 'invalid-deck',
            metadata: { name: 'Invalid Deck' },
            boards: {
              mainboard: [{ name: 'Known Spell', quantity: 1 }],
              avatar: [{ name: 'Avatar', quantity: 1 }],
              sideboard: [],
              maybeboard: [],
            },
          }),
          liveDashboard: false,
          nowImpl: () => Date.parse('2026-01-01T00:00:00.000Z'),
          writeJsonFile: async () => undefined,
          writeTextFile: async () => undefined,
        },
      );

      expect(result.archive).toEqual({});
      expect(result.skippedArchive['invalid-deck']).toMatchObject({
        id: 'invalid-deck',
        status: 'skipped-invalid',
        reason: 'minimum-spellbook expected>=60 actual=1; minimum-atlas expected>=30 actual=0',
        skippedAt: '2026-01-01T00:00:00.000Z',
        attempts: 1,
        deckinfo: {
          id: 'invalid-deck',
          name: 'Invalid Deck',
          avatar: 'Avatar',
          cardCount: {
            spellbook: 1,
            atlas: 0,
            collection: 0,
            maybe: 0,
          },
        },
      });
      expect(result.skippedArchive['invalid-deck'].errors.map((error) => error.type)).toEqual([
        'SPELLBOOK_TOO_SMALL',
        'ATLAS_TOO_SMALL',
      ]);
    } finally {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    }
  });

  it('flushes archives after each processed deck before starting the next fetch', async () => {
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    console.log = vi.fn();
    console.error = vi.fn();
    let latestArchive = null;

    try {
      await runArchive(
        {
          inputs: [],
          output: 'archive.json',
          skippedOutput: 'archive.skipped.json',
          log: 'archive.log',
          cardData: 'cards.json',
          limitPerFile: 0,
          skipProcessed: false,
        },
        {
          inputs: [
            { id: 'deck-1', raw: 'deck-1', hint: { id: 'deck-1' } },
            { id: 'deck-2', raw: 'deck-2', hint: { id: 'deck-2' } },
          ],
          archive: {},
          skippedArchive: {},
          cardData: [
            { name: 'Site A', guardian: { type: 'Site' } },
            { name: 'Spell A', guardian: { type: 'Magic' } },
          ],
          fetchDeck: async (id) => {
            if (id === 'deck-2') {
              expect(latestArchive?.['deck-1']?.deckinfo?.name).toBe('Deck 1');
            }

            return {
              id,
              metadata: { name: id === 'deck-1' ? 'Deck 1' : 'Deck 2' },
              boards: {
                mainboard: [
                  { name: 'Spell A', quantity: 60 },
                  { name: 'Site A', quantity: 30 },
                ],
                avatar: [{ name: 'Avatar', quantity: 1 }],
                sideboard: [],
                maybeboard: [],
              },
            };
          },
          liveDashboard: false,
          nowImpl: () => Date.parse('2026-01-01T00:00:00.000Z'),
          writeJsonFile: async (filePath, value) => {
            if (filePath === 'archive.json') {
              latestArchive = structuredClone(value);
            }
          },
          writeTextFile: async () => undefined,
        },
      );

      expect(latestArchive?.['deck-2']?.deckinfo?.name).toBe('Deck 2');
    } finally {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    }
  });
});

describe('Curiosa archive progress output', () => {
  it('formats processed count, ETA, totals, and last deck card counts', () => {
    expect(formatProgressLine({
      processed: 2,
      total: 5,
      elapsedMs: 120_000,
      summary: {
        added: 1,
        updated: 1,
        skippedUpToDate: 0,
        skippedInvalid: 0,
        skippedProcessed: 0,
        failed: 0,
      },
      lastDeck: {
        name: 'Deck "Two"',
        cardCount: {
          spellbook: 60,
          atlas: 30,
          collection: 10,
          maybe: 2,
        },
      },
    })).toBe(
      'progress 2/5 elapsed=2m00s eta=3m00s added=1 updated=1 annotated=0 skipped-up-to-date=0 skipped-invalid=0 skipped-processed=0 failed=0 last="Deck \\"Two\\"" spellbook=60 atlas=30 collection=10 maybe=2',
    );
  });

  it('uses n/a card counts when a deck fails before board data is known', () => {
    expect(formatProgressLine({
      processed: 1,
      total: 2,
      elapsedMs: 3000,
      summary: {
        added: 0,
        updated: 0,
        skippedUpToDate: 0,
        skippedInvalid: 0,
        skippedProcessed: 0,
        failed: 1,
      },
      lastDeck: {
        name: 'deck-a',
        cardCount: null,
      },
    })).toContain(
      'last="deck-a" spellbook=n/a atlas=n/a collection=n/a maybe=n/a',
    );
  });

  it('formats tab-aligned dashboard rows for live terminal updates', () => {
    expect(formatDashboardLines({
      processed: 79,
      total: 378,
      elapsedMs: 460_000,
      summary: {
        added: 16,
        updated: 0,
        skippedUpToDate: 4,
        skippedInvalid: 59,
        skippedProcessed: 0,
        failed: 0,
      },
      waiting: {
        delayMs: 3000,
        remainingMs: 2000,
        reason: 'local-spacing',
        deckId: 'cme5x329q00k9jo04ouuycsek',
      },
      health: {
        type: 'response',
        deckId: 'cmgy3144l00lkjp04d2mv3bvq',
        requestKind: 'deck-page',
        status: 200,
        ok: true,
        rateLimitLimit: null,
        rateLimitRemaining: null,
        rateLimitResetMs: null,
        retryAfterMs: null,
        proxyDelayMs: null,
        proxyDelayReason: 'proxy-throttle',
      },
      lastDeck: {
        id: 'cmgy3144l00lkjp04d2mv3bvq',
        name: 'Top8 SCG Con Houston Crossroads 2025 by Chris Florczak',
        avatar: 'Avatar Name',
        cardCount: {
          spellbook: 50,
          atlas: 30,
          collection: 0,
          maybe: 0,
        },
      },
      result: {
        status: 'skipped-invalid',
        message: 'minimum-spellbook expected>=60 actual=50',
      },
    })).toEqual([
      'Progress\t79/378\telapsed=7m40s\teta=29m01s\tadded=16\tupdated=0\tannotated=0\tskipped-up-to-date=4\tskipped-invalid=59\tskipped-processed=0\tfailed=0',
      'Waiting\ton curiosa\tdeck=cme5x329q00k9jo04ouuycsek\t2s..\treason=local-spacing',
      'Curiosa\trequest=deck-page\tstatus=200\tok=true\trate-limit=n/a\treset=n/a\tretry-after=none\tproxy-delay=none',
      'Last\tcmgy3144l00lkjp04d2mv3bvq\t"Top8 SCG Con Houston Crossroads 2025 by Chris Florczak"',
      'Result\tskipped-invalid:\tminimum-spellbook expected>=60 actual=50',
      'Deck\tavatar="Avatar Name"\tspellbook=50\tatlas=30\tcollection=0\tmaybe=0',
    ]);
  });
});

describe('Curiosa archive health output', () => {
  it('formats connection and response health lines', () => {
    expect(formatCuriosaHealthLine({
      type: 'connection',
      host: 'curiosa.io',
      origin: 'https://curiosa.io',
      referer: 'https://curiosa.io/',
      localRefillMs: 3000,
      lowRemainingThreshold: 2,
      safeRemainingTarget: 5,
    })).toBe(
      'curiosa-health connection=direct host=curiosa.io origin="https://curiosa.io" referer="https://curiosa.io/" serialized=true local-spacing=3000ms low-remaining<=2 safe-remaining-target=5 retry-after=honored',
    );

    expect(formatCuriosaHealthLine({
      type: 'response',
      deckId: 'deck-a',
      requestKind: 'deck-trpc',
      status: 200,
      ok: true,
      rateLimitLimit: 30,
      rateLimitRemaining: 28,
      rateLimitResetMs: Date.parse('2026-01-01T00:00:00.000Z'),
      retryAfterMs: null,
      proxyDelayMs: 1500,
      proxyDelayReason: 'spacing',
    })).toBe(
      'curiosa-health response deck=deck-a request=deck-trpc status=200 ok=true rate-limit=28/30 reset=2026-01-01T00:00:00.000Z retry-after=none proxy-delay=1500ms:spacing',
    );
  });
});

describe('Curiosa archive fetching', () => {
  it('fetches metadata and board cards through mocked Curiosa responses', async () => {
    const calls = [];
    const healthEvents = [];
    const fetchMock = vi.fn(async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return response(htmlFixture(), { contentType: 'text/html' });
      }
      return jsonResponse(trpcFixture());
    });
    const client = createCuriosaClient({
      fetchImpl: fetchMock,
      localRefillMs: 0,
      nowImpl: () => 0,
      sleepImpl: async () => undefined,
    });

    const deck = await fetchCuriosaDeckFromCuriosa(DECK_ID, client, {
      onHealth: (health) => healthEvents.push(health),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[0].url).toBe(`https://curiosa.io/decks/${DECK_ID}`);
    expect(calls[1].url).toContain('/api/trpc/deck.getDecklistById');
    expect(calls[0].init.headers).toMatchObject({
      origin: 'https://curiosa.io',
      referer: 'https://curiosa.io/',
    });
    expect(deck.metadata).toMatchObject({
      id: DECK_ID,
      createdAt: '2026-01-13T19:34:05.954Z',
      updatedAt: '2026-01-14T08:03:19.525Z',
      name: 'SCG Atlanta 4th',
      user: { id: 'user-1', username: 'PeterTheGreat' },
    });
    expect(deck.boards.mainboard).toEqual([
      { name: 'Site A', quantity: 30 },
      { name: 'Spell A', quantity: 60 },
    ]);
    expect(healthEvents).toMatchObject([
      { type: 'response', deckId: DECK_ID, requestKind: 'deck-page', status: 200 },
      { type: 'response', deckId: DECK_ID, requestKind: 'deck-trpc', status: 200 },
    ]);
  });

  it('can fetch deck details through a supplied Curiosa proxy base URL', async () => {
    const calls = [];
    const fetchMock = vi.fn(async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return response(htmlFixture(), { contentType: 'text/html' });
      }
      return jsonResponse(trpcFixture());
    });
    const client = createCuriosaClient({
      fetchImpl: fetchMock,
      localRefillMs: 0,
      nowImpl: () => 0,
      sleepImpl: async () => undefined,
    });

    await fetchCuriosaDeckFromCuriosa(DECK_ID, client, {
      curiosaBaseUrl: 'http://localhost:3000/api/curiosa',
    });

    expect(calls[0].url).toBe(`http://localhost:3000/api/curiosa/decks/${DECK_ID}`);
    expect(calls[1].url).toContain(
      'http://localhost:3000/api/curiosa/api/trpc/deck.getDecklistById',
    );
  });
});
