import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, set } from 'idb-keyval';
import engineCards from './__fixtures__/sorcery-engine-cards.json';
import { normalizeCardCatalog } from './cardCatalog';
import { provisionalCards, withProvisionalCards } from './provisionalCards';
import { CARD_CATALOGUE_REVISION } from './cardService';
import { cardNameToOrientationMap } from '@/canvas/canvasAreas';

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn() }));

const normalized = normalizeCardCatalog(engineCards).cards;
const supplemented = withProvisionalCards(normalized);
const fetchMock = vi.fn<typeof fetch>();
const warning = vi.fn<(message: string) => void>();
let fetchCards: typeof import('./cardService').fetchCards;
const json = (value: unknown) => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json' },
});

beforeEach(async () => {
  vi.resetModules();
  ({ fetchCards } = await import('./cardService'));
  vi.resetAllMocks();
  vi.mocked(get).mockResolvedValue(undefined);
  vi.mocked(set).mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('card catalog loading and recovery', () => {
  it('shows a shared-cache outage notice without giving stale metadata a fresh browser TTL', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(engineCards), {
      headers: { 'content-type': 'application/json', 'x-sorcery-catalogue-cache': 'stale' },
    }));
    expect(await fetchCards(warning)).toEqual(supplemented);
    expect(set).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('last verified shared catalogue'));
  });
  it('replaces a trailer transcription with the official record and caches only upstream data', async () => {
    const official = {
      name: 'Chosen One',
      engine: { type: 'Magic', rarity: 'Ordinary', rules: 'Official corrected text.', cost: 4, air: 1 },
      printings: [{ slug: 'official-chosen-one', set: { name: 'Official Release' }, meta: { finish: 'Standard' } }],
    };
    fetchMock.mockResolvedValueOnce(json([...engineCards, official]));
    const cards = await fetchCards(warning);
    expect(cards.filter((card) => card.name === 'Chosen One')).toHaveLength(1);
    expect(cards.find((card) => card.name === 'Chosen One')).toMatchObject({
      guardian: { rulesText: 'Official corrected text.', cost: 4, thresholds: { air: 1 } },
      sets: [{ name: 'Official Release' }],
    });
    expect(cards.find((card) => card.name === 'Chosen One')?.provisional).toBeUndefined();
    expect(cards.filter((card) => card.provisional)).toHaveLength(provisionalCards.length - 1);
    const saved = vi.mocked(set).mock.calls[0]?.[1] as { cards: typeof cards };
    expect(saved.cards).toHaveLength(normalized.length + 1);
    expect(saved.cards.every((card) => !card.provisional)).toBe(true);
  });

  it('refreshes a pre-release cache even when its timestamp is fresh', async () => {
    vi.mocked(get).mockResolvedValue({ timestamp: Date.now(), cards: normalized });
    fetchMock.mockResolvedValueOnce(json(engineCards));
    expect(await fetchCards()).toEqual(supplemented);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('sorcery_card_cache', expect.objectContaining({ revision: CARD_CATALOGUE_REVISION }));
  });

  it('shares one upstream download between concurrent catalogue loads', async () => {
    fetchMock.mockResolvedValueOnce(json(engineCards));
    const results = await Promise.all([fetchCards(), fetchCards()]);
    expect(results).toEqual([supplemented, supplemented]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back without rapid retries when upstream is unavailable', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(json(normalized));
    expect(await fetchCards(warning)).toEqual(supplemented);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sorcery/cards', '/assets/sorcery_cards.json']);
  });

  it('shares the catalogue throttle with deck imports', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const fixture = (await import('./__fixtures__/sorcery-deck.json')).default;
    const { fetchSorceryDeck } = await import('./sorceryDeckService');
    fetchMock.mockResolvedValueOnce(json(engineCards))
      .mockResolvedValueOnce(json([{ result: { data: { json: fixture } } }]));
    await fetchCards();
    const deck = fetchSorceryDeck(fixture.id);
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await deck).name).toBe(fixture.name);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('normalizes the API response before it reaches startup or the cache', async () => {
    fetchMock.mockResolvedValueOnce(json(engineCards));
    const cards = await fetchCards(warning);
    expect(cards).toEqual(supplemented);
    expect(() => cardNameToOrientationMap(cards)).not.toThrow();
    expect(set).toHaveBeenCalledWith('sorcery_card_cache', expect.objectContaining({ cards: normalized }));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('provisional trailer details'));
  });

  it.each([{ payload: engineCards }, { payload: normalized }])('repairs a fresh legacy or raw engine cache without requiring a reset', async ({ payload }) => {
    vi.mocked(get).mockResolvedValue({ revision: CARD_CATALOGUE_REVISION, timestamp: Date.now(), cards: payload });
    expect(await fetchCards(warning)).toEqual(supplemented);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([{}, { cards: null }, { cards: [{ name: 'Broken' }], timestamp: Date.now() }])(
    'ignores unusable cached data and fetches a usable catalog: %j', async (cache) => {
      vi.mocked(get).mockResolvedValue(cache);
      fetchMock.mockResolvedValueOnce(json(engineCards));
      expect(await fetchCards(warning)).toEqual(supplemented);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('falls back to validated stale cards after an incompatible API change', async () => {
    vi.mocked(get).mockResolvedValue({ revision: CARD_CATALOGUE_REVISION, timestamp: 1, cards: engineCards });
    fetchMock.mockResolvedValueOnce(json({ newFormat: [] }));
    expect(await fetchCards(warning)).toEqual(supplemented);
    expect(set).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Using saved cards'));
  });

  it('falls back to the bundled snapshot for first-time offline use', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(json(normalized));
    expect(await fetchCards(warning)).toEqual(supplemented);
    expect(fetchMock).toHaveBeenLastCalledWith('/assets/sorcery_cards.json');
    expect(set).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Using bundled cards'));
  });

  it('reports broken records, keeps valid previews and preserves the last good cache', async () => {
    fetchMock.mockResolvedValueOnce(json([
      ...engineCards, { name: 'Missing metadata' },
      { name: 'Preview', engine: { type: 'Trap' } },
    ]));
    const cards = await fetchCards(warning);
    expect(cards).toHaveLength(supplemented.length + 1);
    expect(cards.find((card) => card.name === 'Preview')?.guardian.type).toBe('Trap');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Missing metadata'));
    expect(set).not.toHaveBeenCalled();
  });

  it('handles unavailable browser storage without blocking a valid API response', async () => {
    vi.mocked(get).mockRejectedValue(new Error('Storage unavailable'));
    vi.mocked(set).mockRejectedValue(new Error('Storage unavailable'));
    fetchMock.mockResolvedValueOnce(json(engineCards));
    expect(await fetchCards(warning)).toEqual(supplemented);
  });

  it('rejects completely unusable sources so startup can show a recoverable error', async () => {
    fetchMock.mockResolvedValueOnce(json([{ name: 'Broken' }]))
      .mockResolvedValueOnce(json([]));
    await expect(fetchCards(warning)).rejects.toThrow(/no supported card records/);
    expect(set).not.toHaveBeenCalled();
  });
});
