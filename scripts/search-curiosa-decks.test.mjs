import { describe, expect, it, vi } from 'vitest';

import {
  buildCuriosaDeckSearchCountInput,
  buildCuriosaDeckSearchPageInput,
  parseCuriosaDeckSearchCount,
  parseCuriosaDeckSearchPage,
} from '../src/data/curiosaService.ts';
import {
  buildCuriosaTrpcUrl,
  classifySearchDecks,
  collectCuriosaDeckSearch,
  deckSummariesToArchiveInputs,
  filterSearchDecks,
  mergeSearchDeck,
  parseArgs,
  runSearchToArchive,
} from './search-curiosa-decks.mjs';
import {
  classifyCompetitiveDeck,
  stripPrimerHtml,
} from './lib/competitive-decks.mjs';

const SEARCH_PAGE = [
  {
    id: 'deck-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    name: 'Deck A',
    format: 'Constructed',
    primer: '<p>1st Place Cornerstone Melbourne 2026, undefeated 5-0.</p>',
    hotscore: 5,
    user: { id: 'user-a', username: 'Alice' },
    elements: ['Fire'],
    _count: { likes: 10, views: 100 },
  },
  {
    id: 'deck-b',
    name: 'Deck B',
    _count: { likes: 2, views: 20 },
  },
];

describe('Curiosa deck search helpers', () => {
  it('builds compact count and first-page tRPC inputs', () => {
    expect(buildCuriosaDeckSearchCountInput({ query: ' cornerstone ' })).toEqual({
      '0': {
        json: {
          query: 'cornerstone',
          avatar: '*',
          divider: 'all',
          filters: [],
        },
      },
    });

    expect(buildCuriosaDeckSearchPageInput({
      query: 'cornerstone',
      limit: 30,
      cursor: 0,
    })).toEqual({
      '0': {
        json: {
          query: 'cornerstone',
          sort: 'relevance',
          avatar: '*',
          divider: 'all',
          filters: [],
          limit: 30,
          direction: 'forward',
        },
      },
    });
  });

  it('includes cursor on later pages', () => {
    expect(buildCuriosaDeckSearchPageInput({
      query: 'cornerstone',
      limit: 30,
      cursor: 60,
    })['0'].json.cursor).toBe(60);
  });

  it('parses count and search page summaries', () => {
    expect(parseCuriosaDeckSearchCount({ count: 123 })).toBe(123);
    expect(parseCuriosaDeckSearchPage({ decks: SEARCH_PAGE })).toEqual([
      {
        id: 'deck-a',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        name: 'Deck A',
        format: 'Constructed',
        primer: '<p>1st Place Cornerstone Melbourne 2026, undefeated 5-0.</p>',
        hotscore: 5,
        user: { id: 'user-a', username: 'Alice' },
        elements: ['Fire'],
        likes: 10,
        views: 100,
      },
      {
        id: 'deck-b',
        createdAt: undefined,
        updatedAt: undefined,
        name: 'Deck B',
        format: undefined,
        primer: undefined,
        hotscore: undefined,
        user: undefined,
        elements: undefined,
        likes: 2,
        views: 20,
      },
    ]);
  });

  it('builds Curiosa tRPC URLs for direct or proxy base URLs', () => {
    expect(buildCuriosaTrpcUrl(
      'https://curiosa.io',
      'deck.search',
      { '0': { json: { query: 'cornerstone' } } },
    )).toContain('https://curiosa.io/api/trpc/deck.search?batch=1&input=');

    expect(buildCuriosaTrpcUrl(
      'http://localhost:3000/api/curiosa/',
      'deck.search',
      { '0': { json: { query: 'cornerstone' } } },
    )).toContain('http://localhost:3000/api/curiosa/api/trpc/deck.search');
  });
});

describe('Curiosa deck search collection', () => {
  it('filters search decks by views, likes, max, and dedupes by ID', () => {
    expect(filterSearchDecks(
      [
        { id: 'deck-a', views: 100, likes: 10 },
        { id: 'deck-b', views: 90, likes: 1 },
        { id: 'deck-a', views: 100, likes: 10 },
        { id: 'deck-c', views: 200, likes: 20 },
      ],
      { minViews: 100, minLikes: 5, maxDecks: 1 },
    )).toEqual([
      expect.objectContaining({ id: 'deck-a', views: 100, likes: 10, included: true }),
    ]);
  });

  it('paginates search results and writes the search snapshot as pages arrive', async () => {
    const writes = [];
    const fetchSearchCount = vi.fn(async () => ({ count: 3, raw: { count: 3 } }));
    const fetchSearchPage = vi.fn(async ({ cursor }) => ({
      cursor,
      raw: { cursor },
      decks: cursor === 0
        ? [
            { id: 'deck-a', views: 100, likes: 10 },
            { id: 'deck-b', views: 20, likes: 2 },
          ]
        : [{ id: 'deck-c', views: 200, likes: 20 }],
    }));

    const result = await collectCuriosaDeckSearch(
      {
        query: 'cornerstone',
        output: 'archive.json',
        searchOutput: 'search.json',
        curiosaBaseUrl: 'https://curiosa.io',
        minViews: 50,
        minLikes: 5,
        maxDecks: 0,
        pageSize: 2,
      },
      {
        fetchSearchCount,
        fetchSearchPage,
        writeJsonFile: async (filePath, value) => writes.push({ filePath, value }),
        nowImpl: () => Date.parse('2026-01-01T00:00:00.000Z'),
      },
    );

    expect(fetchSearchPage).toHaveBeenCalledTimes(2);
    expect(fetchSearchPage.mock.calls.map(([arg]) => arg.cursor)).toEqual([0, 2]);
    expect(result.totalFound).toBe(3);
    expect(result.filteredDecks.map((deck) => deck.id)).toEqual(['deck-a', 'deck-c']);
    expect(writes).toHaveLength(4);
    expect(writes.at(-1).value).toMatchObject({
      query: 'cornerstone',
      count: 3,
      totalFound: 3,
      totalFiltered: 2,
    });
  });

  it('converts search summaries to archive inputs preserving metadata hints', () => {
    expect(deckSummariesToArchiveInputs([
      {
        id: 'deck-a',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        name: 'Deck A',
        format: 'Constructed',
        hotscore: 5,
        user: { id: 'user-a', username: 'Alice' },
        elements: ['Fire'],
        likes: 10,
        views: 100,
      },
    ], 'search.json')).toEqual([
      {
        id: 'deck-a',
        sourcePath: 'search.json',
        sourceIndex: 0,
        raw: 'deck-a',
        hint: {
          id: 'deck-a',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          name: 'Deck A',
          format: 'Constructed',
          hotscore: 5,
          user: { id: 'user-a', username: 'Alice' },
          elements: ['Fire'],
        },
      },
    ]);
  });

  it('passes filtered deck IDs into the archive runner', async () => {
    const runArchive = vi.fn(async () => ({ summary: { added: 1 } }));

    const result = await runSearchToArchive(
      {
        query: 'cornerstone',
        output: 'archive.json',
        searchOutput: 'search.json',
        skippedOutput: 'archive.skipped.json',
        log: 'archive.log',
        cardData: 'cards.json',
        curiosaBaseUrl: 'http://localhost:3000/api/curiosa',
        minViews: 50,
        minLikes: 5,
        maxDecks: 0,
        pageSize: 30,
        skipProcessed: true,
      },
      {
        quiet: true,
        runArchive,
        fetchSearchCount: async () => ({ count: 2, raw: { count: 2 } }),
        fetchSearchPage: async () => ({
          cursor: 0,
          raw: SEARCH_PAGE,
          decks: parseCuriosaDeckSearchPage({ decks: SEARCH_PAGE }),
        }),
        writeJsonFile: async () => undefined,
      },
    );

    expect(result.search.filteredDecks.map((deck) => deck.id)).toEqual(['deck-a']);
    expect(runArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        output: 'archive.json',
        skippedOutput: 'archive.skipped.json',
        log: 'archive.log',
        cardData: 'cards.json',
        curiosaBaseUrl: 'http://localhost:3000/api/curiosa',
        skipProcessed: true,
      }),
      expect.objectContaining({
        inputs: [expect.objectContaining({ id: 'deck-a' })],
        handleSignals: true,
      }),
    );
  });

  it('parses CLI arguments and defaults output companion paths', () => {
    expect(parseArgs([
      '--query',
      'cornerstone',
      '--output',
      'tmp/cornerstone.json',
      '--min-views',
      '10',
      '--min-likes',
      '2',
      '--max-decks',
      '5',
      '--skip-processed',
    ])).toMatchObject({
      query: 'cornerstone',
      output: 'tmp/cornerstone.json',
      searchOutput: 'tmp/cornerstone.json.search.json',
      skippedOutput: 'tmp/cornerstone.json.skipped.json',
      log: 'tmp/cornerstone.json.log',
      minViews: 10,
      minLikes: 2,
      maxDecks: 5,
      skipProcessed: true,
    });
  });

  it('applies the competitive preset while allowing extra queries', () => {
    const options = parseArgs([
      '--preset',
      'competitive-2026',
      '--query',
      'Local 2K',
      '--output',
      'offlineData/deckArchive.json',
    ]);

    expect(options).toMatchObject({
      preset: 'competitive-2026',
      sort: 'latest',
      since: '2026-01-01',
      format: 'Constructed',
      season: 2026,
      competitiveOnly: true,
      rebuildLookup: true,
    });
    expect(options.queries).toContain('Grand Contest');
    expect(options.queries).toContain('Local 2K');
    expect(parseArgs([
      '--preset',
      'competitive-2026',
      '--output',
      'offlineData/deckArchive.json',
      '--no-rebuild-lookup',
    ]).rebuildLookup).toBe(false);
  });

  it('deduplicates multiple query pages and keeps newest metadata and peak counts', async () => {
    const result = await collectCuriosaDeckSearch(
      {
        queries: ['Grand Contest', 'Cornerstone'],
        output: 'archive.json',
        searchOutput: 'search.json',
        curiosaBaseUrl: 'https://curiosa.io',
        sort: 'latest',
        format: 'all',
        competitiveOnly: false,
        minViews: 0,
        minLikes: 0,
        maxDecks: 0,
        pageSize: 30,
      },
      {
        fetchSearchCount: async () => ({ count: 1, raw: { count: 1 } }),
        fetchSearchPage: async ({ query, cursor }) => ({
          cursor,
          raw: { query },
          decks: [{
            id: 'same-deck',
            name: query === 'Cornerstone' ? 'New name' : 'Old name',
            updatedAt: query === 'Cornerstone'
              ? '2026-02-01T00:00:00.000Z'
              : '2026-01-01T00:00:00.000Z',
            likes: query === 'Cornerstone' ? 2 : 9,
            views: query === 'Cornerstone' ? 200 : 100,
          }],
        }),
        writeJsonFile: async () => undefined,
      },
    );

    expect(result.totalFound).toBe(1);
    expect(result.decks[0]).toMatchObject({
      id: 'same-deck',
      name: 'New name',
      likes: 9,
      views: 200,
      matchedQueries: ['Grand Contest', 'Cornerstone'],
    });
    expect(result.queries).toHaveLength(2);
  });
});

describe('competitive deck classification', () => {
  it('extracts event, location, result, top-cut, undefeated, and record signals', () => {
    const result = classifyCompetitiveDeck({
      name: '1st Place Grand Contest Melbourne 2026 Top 8',
      primer: '<p>Finished undefeated at 9-0 &amp; won the finals.</p>',
      updatedAt: '2026-08-01T00:00:00.000Z',
      likes: 12,
      views: 345,
      matchedQueries: ['Grand Contest', 'Winner'],
    }, { season: 2026 });

    expect(stripPrimerHtml('<p>A &amp; B</p>')).toBe('A & B');
    expect(result).toMatchObject({
      isCompetitive: true,
      confidence: 'high',
      seasons: [2026],
      events: ['Grand Contest'],
      locations: ['Melbourne'],
      placements: [1],
      topCuts: [8],
      records: ['9-0'],
      likes: 12,
      views: 345,
    });
    expect(result.resultTags).toEqual(['winner', 'placed', 'top-cut', 'undefeated', 'record']);
  });

  it('rejects broad false positives unless another competition signal is present', () => {
    for (const name of ['GC deck', 'My 2026 deck', 'Eternal Champions']) {
      expect(classifyCompetitiveDeck({ name }).isCompetitive).toBe(false);
    }

    expect(classifyCompetitiveDeck({
      name: '1st Place Melbourne 2026',
    }).isCompetitive).toBe(true);
  });

  it('recognizes official location shorthand and live regional wording', () => {
    expect(classifyCompetitiveDeck({
      name: 'Tsunami (AKL GC deck)',
    })).toMatchObject({
      isCompetitive: true,
      locations: ['Auckland'],
    });

    expect(classifyCompetitiveDeck({
      name: 'Lil Dru [Akl_GC_3-3]',
    })).toMatchObject({
      isCompetitive: true,
      locations: ['Auckland'],
      records: ['3-3'],
    });

    expect(classifyCompetitiveDeck({
      name: 'Tumatarau whakataetae o Aotearoa 2026 - 1st - Antony V',
    })).toMatchObject({
      isCompetitive: true,
      locations: ['New Zealand'],
      placements: [1],
    });

    expect(classifyCompetitiveDeck({
      name: 'Ring Combo | Tournament Grounds Montreal 2026',
    })).toMatchObject({
      isCompetitive: true,
      locations: ['Montreal'],
    });
  });

  it('recognizes narrow event families without promoting vague result terms', () => {
    expect(classifyCompetitiveDeck({
      name: 'Summit S5 Top 8 - New Court Who Dis?',
      updatedAt: '2026-07-24T00:00:00.000Z',
    })).toMatchObject({
      isCompetitive: true,
      events: ['Sorcerers Summit'],
      topCuts: [8],
    });

    expect(classifyCompetitiveDeck({
      name: 'Control Persecutor (5:th place Lincon 2026)',
    })).toMatchObject({
      isCompetitive: true,
      events: ['Lincon'],
      placements: [5],
    });

    expect(classifyCompetitiveDeck({
      name: 'dromai? - POG Cornerstore May 2026 - Top 8',
    })).toMatchObject({
      isCompetitive: true,
      events: ['Cornerstone'],
      topCuts: [8],
    });

    expect(classifyCompetitiveDeck({
      name: '1st Place Forja Hobby Store Sorcery 1K',
    }).isCompetitive).toBe(true);

    expect(classifyCompetitiveDeck({
      name: 'Saturday tournament',
    }).isCompetitive).toBe(false);
  });

  it('prioritizes title signals over supporting primer history', () => {
    expect(classifyCompetitiveDeck({
      name: '5th Place GenCon 2026',
      primer: '<p>Previously finished 3rd at the Melbourne Grand Contest.</p>',
    })).toMatchObject({
      events: ['Gen Con', 'Grand Contest'],
      locations: ['Melbourne'],
      placements: [5, 3],
    });
  });

  it('does not treat routine game wins or contractions as event wins', () => {
    expect(classifyCompetitiveDeck({
      name: '20th Place Grand Contest Melbourne 2026',
      primer: '<p>I won every game with this site, and they won\'t have time to recover.</p>',
    })).toMatchObject({
      isCompetitive: true,
      resultTags: ['placed'],
      placements: [20],
    });

    expect(classifyCompetitiveDeck({
      name: 'Grand Contest Melbourne 2026',
      primer: '<p>I won the finals.</p>',
    }).resultTags).toContain('winner');
  });

  it('filters old seasons and non-constructed formats while retaining audit metadata', () => {
    const classified = classifySearchDecks([
      {
        id: 'old',
        name: 'Cornerstone Winner 2025',
        format: 'Constructed',
        updatedAt: '2026-02-01T00:00:00.000Z',
        likes: 0,
        views: 0,
      },
      {
        id: 'limited',
        name: 'GenCon Grand Contest 2026',
        format: 'Draft',
        updatedAt: '2026-08-01T00:00:00.000Z',
        likes: 0,
        views: 0,
      },
    ], {
      sort: 'latest',
      since: '2026-01-01',
      season: 2026,
      format: 'Constructed',
      competitiveOnly: true,
    });

    expect(classified.find((deck) => deck.id === 'limited')?.exclusionReasons).toContain('format:Draft');
    expect(classified.find((deck) => deck.id === 'old')?.exclusionReasons).toContain('season-before:2026');
  });

  it('merges duplicate helpers without losing query provenance', () => {
    expect(mergeSearchDeck(
      { id: 'deck', updatedAt: '2026-01-01', likes: 7, views: 5, matchedQueries: ['GC'] },
      { id: 'deck', updatedAt: '2026-02-01', name: 'Latest', likes: 2, views: 20 },
      'Grand Contest',
    )).toMatchObject({
      id: 'deck',
      name: 'Latest',
      likes: 7,
      views: 20,
      matchedQueries: ['GC', 'Grand Contest'],
    });
  });
});
