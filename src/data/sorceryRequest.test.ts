import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSorceryClient } from './sorceryRequest';

const ok = () => new Response('{}');
function harness(responses: (Response | Error)[]) {
  let time = 0;
  const times: number[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    times.push(time);
    const response = responses.shift();
    if (!response) throw new Error('Unexpected request');
    if (response instanceof Error) throw response;
    return response;
  });
  const client = createSorceryClient({ fetchImpl, nowImpl: () => time, sleepImpl: async (ms) => { time += ms; } });
  return { client, fetchImpl, times, advance: (ms: number) => { time += ms; } };
}

afterEach(() => vi.useRealTimers());

describe('shared SorceryTCG request limits (offline transport)', () => {
  it('spaces mixed concurrent requests and never accumulates burst credits while idle', async () => {
    const { client, times, advance } = harness([ok(), ok(), ok()]);
    await client.fetch('/cards');
    advance(5500);
    await Promise.all([client.fetch('/deck'), client.fetch('/search')]);
    expect(times).toEqual([0, 5500, 8500]);
  });

  it('holds the queue while the response body is still downloading', async () => {
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; } });
    const { client, times, advance } = harness([new Response(stream), ok()]);
    const first = client.fetch('/cards');
    const second = client.fetch('/deck');
    await vi.waitFor(() => expect(times).toHaveLength(1));
    advance(5000);
    expect(times).toHaveLength(1);
    body?.close();
    await Promise.all([first, second]);
    expect(times).toEqual([0, 8000]);
  });

  it('uses the longer reset deadline even when Retry-After is shorter', async () => {
    const limited = new Response('wait', { status: 429, headers: {
      'retry-after': '2', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '20',
    } });
    const { client, times } = harness([limited, ok()]);
    expect((await client.fetch('/deck')).ok).toBe(true);
    expect(times).toEqual([0, 20_000]);
  });

  it('accepts Retry-After dates and retries at most once', async () => {
    const limited = () => new Response('wait', { status: 503, headers: { 'retry-after': new Date(10_000).toUTCString() } });
    const { client, times } = harness([limited(), limited()]);
    expect((await client.fetch('/deck')).status).toBe(503);
    expect(times).toEqual([0, 10_000]);
  });

  it('does not retry headerless 429/503 responses and pauses the shared queue for a minute', async () => {
    const { client, times } = harness([new Response(null, { status: 429 }), ok()]);
    expect((await client.fetch('/search')).status).toBe(429);
    expect(times).toEqual([0]);
    await client.fetch('/cards');
    expect(times).toEqual([0, 60_000]);
  });

  it('does not retry network failures and still spaces the next request', async () => {
    const { client, times } = harness([new Error('offline'), ok()]);
    await expect(client.fetch('/cards')).rejects.toThrow('offline');
    await client.fetch('/deck');
    expect(times).toEqual([0, 3000]);
  });

  it('treats a negative Retry-After as invalid instead of a date or permission to retry', async () => {
    const { client, times } = harness([new Response(null, { status: 503, headers: { 'retry-after': '-1' } }), ok()]);
    expect((await client.fetch('/deck')).status).toBe(503);
    expect(times).toEqual([0]);
    await client.fetch('/cards');
    expect(times).toEqual([0, 60_000]);
  });

  it('does not follow redirects that could bypass the queue', async () => {
    const { client, fetchImpl } = harness([ok()]);
    await client.fetch('/cards', { redirect: 'follow' });
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('waits for a low budget once rather than repeatedly moving its deadline', async () => {
    const { client, times } = harness([new Response('{}', { headers: { 'x-ratelimit-remaining': '2' } }), ok(), ok()]);
    await client.fetch('/cards');
    await client.fetch('/search');
    await client.fetch('/deck');
    expect(times).toEqual([0, 9000, 12_000]);
  });

  it('leaves proxy retry decisions to the caller', async () => {
    const { client, times } = harness([new Response(null, { status: 429, headers: { 'retry-after': '1' } }), ok()]);
    expect((await client.fetch('/proxy', {}, { retry: false })).status).toBe(429);
    await client.fetch('/proxy', {}, { retry: false });
    expect(times).toEqual([0, 3000]);
  });

  it('aborts an active fetch and stops the retry sequence', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const client = createSorceryClient({ fetchImpl });
    const result = expect(client.fetch('/cards', {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();
    await result;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects cancelled queued work before the active download completes', async () => {
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; } });
    const { client, fetchImpl, times } = harness([new Response(stream), ok()]);
    const active = client.fetch('/cards');
    const controller = new AbortController();
    const cancelled = client.fetch('/cancelled', {}, { signal: controller.signal });
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(fetchImpl).toHaveBeenCalledOnce();
    body?.close();
    await active;
    await client.fetch('/next');
    expect(times).toEqual([0, 3000]);
  });

  it('limits a stalled download and spaces the next attempt after the timeout', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const times: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce((_url, init) => {
        times.push(Date.now());
        return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
      })
      .mockImplementationOnce(async () => { times.push(Date.now()); return ok(); });
    const client = createSorceryClient({ fetchImpl });
    const first = expect(client.fetch('/cards')).rejects.toMatchObject({ name: 'TimeoutError' });
    const second = client.fetch('/deck');
    await vi.advanceTimersByTimeAsync(30_000);
    await first;
    expect(times).toEqual([0]);
    await vi.advanceTimersByTimeAsync(3000);
    await second;
    expect(times).toEqual([0, 33_000]);
  });
});
