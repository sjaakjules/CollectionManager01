import { describe, expect, it, vi } from 'vitest';

import {
  buildCuriosaDeckSearchCountInput,
  buildCuriosaDeckSearchPageInput,
  parseCuriosaDeckSearchCount,
  parseCuriosaDeckSearchPage,
} from '../src/data/curiosaService.ts';
import {
  buildCuriosaTrpcUrl,
  collectCuriosaDeckSearch,
  deckSummariesToArchiveInputs,
  filterSearchDecks,
  parseArgs,
  runSearchToArchive,
} from './search-curiosa-decks.mjs';

const SEARCH_PAGE = [
  {
    id: 'deck-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    name: 'Deck A',
    format: 'Constructed',
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
    )).toEqual([{ id: 'deck-a', views: 100, likes: 10 }]);
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
    expect(writes).toHaveLength(3);
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
});
