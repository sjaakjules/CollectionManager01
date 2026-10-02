import { describe, expect, it, vi } from 'vitest';
import { downloadSorceryResponse } from './sorcery-request.mjs';

describe('manual SorceryTCG download helper', () => {
  it.each(['http://sorcerytcg.com/api', 'https://example.com/api', 'https://user@sorcerytcg.com/api'])('rejects an unapproved URL before the transport: %s', async (url) => {
    const client = { fetch: vi.fn() };
    await expect(downloadSorceryResponse(url, '/unused', { client })).rejects.toThrow('HTTPS URL');
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('uses the shared client and preserves an existing output on an upstream error', async () => {
    const client = { fetch: vi.fn().mockResolvedValue(new Response('stop', { status: 429 })) };
    await expect(downloadSorceryResponse('https://api.sorcerytcg.com/api/cards', '/unused', { client })).rejects.toThrow('output was not replaced');
    expect(client.fetch).toHaveBeenCalledTimes(1);
  });
});
