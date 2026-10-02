import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sorceryDevProxy } from './sorcery-dev-proxy.ts';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('./sorcery-client.ts', () => ({ nodeSorceryClient: { fetch: mocks.fetch } }));
beforeEach(() => mocks.fetch.mockReset());

function context(url, method = 'GET') {
  let middleware;
  sorceryDevProxy().configureServer({ middlewares: { use: (handler) => { middleware = handler; } } });
  const request = Object.assign(Readable.from(method === 'POST' ? ['{"test":true}'] : []), {
    url, method, headers: { accept: 'application/json', 'content-type': 'application/json' },
  });
  const response = Object.assign(new EventEmitter(), {
    headers: {}, writableEnded: false, statusCode: 200, body: '',
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.statusCode = status; return this; },
    end(body = '') { this.body = String(body); this.writableEnded = true; return this; },
  });
  const next = vi.fn();
  return { response, next, run: () => middleware(request, response, next) };
}

describe('throttled development proxy (mocked upstream)', () => {
  it.each([
    ['/api/sorcery/cards', 'https://api.sorcerytcg.com/api/cards'],
    ['/api/decks/api/trpc/deck.get?batch=1', 'https://sorcerytcg.com/api/trpc/deck.get?batch=1'],
    ['/api/curiosa/api/trpc/deck.search', 'https://sorcerytcg.com/api/trpc/deck.search'],
  ])('routes %s through the shared host client without a nested retry', async (url, target) => {
    mocks.fetch.mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '20' } }));
    const test = context(url);
    await test.run();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(target, expect.objectContaining({ method: 'GET' }), expect.objectContaining({ retry: false, signal: expect.any(AbortSignal) }));
    expect(test.response.statusCode).toBe(429);
    expect(test.response.headers['retry-after']).toBe('20');
    expect(test.response.headers['X-Sorcery-Proxy-Min-Interval-Ms']).toBe('3000');
  });

  it('preserves POST bodies and required deck Origin headers', async () => {
    mocks.fetch.mockResolvedValue(new Response('{}'));
    await context('/api/decks/api/trpc/deck.get', 'POST').run();
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({
      body: '{"test":true}', headers: { origin: 'https://sorcerytcg.com', referer: 'https://sorcerytcg.com/' },
    });
  });

  it('does not send upstream requests for assets or preflight', async () => {
    const asset = context('/assets/sorcery_cards.json');
    await asset.run();
    expect(asset.next).toHaveBeenCalledOnce();
    const options = context('/api/sorcery/cards', 'OPTIONS');
    await options.run();
    expect(options.response.statusCode).toBe(204);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
