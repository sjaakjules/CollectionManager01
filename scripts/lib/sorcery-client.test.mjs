import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSorceryClient } from '../../src/data/sorceryRequest.ts';
import { filesystemSorceryRateState } from './sorcery-client.ts';

const directories = [];
const execute = promisify(execFile);
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), 'sorcery-limiter-test-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('maintenance/dev host budget (offline)', () => {
  it('keeps one budget across two independent Node processes', async () => {
    const directory = await temporary();
    const coreUrl = new URL('../../src/data/sorceryRequest.ts', import.meta.url).href;
    const hostUrl = new URL('./sorcery-client.ts', import.meta.url).href;
    const source = `
      import { createSorceryClient } from ${JSON.stringify(coreUrl)};
      import { filesystemSorceryRateState } from ${JSON.stringify(hostUrl)};
      let started;
      const client = createSorceryClient({
        withRateState: filesystemSorceryRateState(process.argv[1]),
        fetchImpl: async () => { started = Date.now(); return new Response('{}'); }
      });
      await client.fetch('https://sorcerytcg.com/offline-test');
      console.log(started);
    `;
    const responses = await Promise.all([1, 2].map(() => execute(process.execPath, ['--input-type=module', '-e', source, directory])));
    const times = responses.map(({ stdout }) => Number(stdout.trim())).sort((a, b) => a - b);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(3000);
    const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
    expect(state.nextAllowedAtMs).toBeGreaterThanOrEqual(times[1] + 3000);
  }, 15_000);

  it('preserves Retry-After across new client instances', async () => {
    const directory = await temporary();
    let time = 0;
    const transport = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '30' } }))
      .mockResolvedValueOnce(new Response('{}'));
    const options = { fetchImpl: transport, nowImpl: () => time,
      sleepImpl: async (ms) => { time += ms; }, withRateState: filesystemSorceryRateState(directory) };
    await createSorceryClient(options).fetch('/cards', {}, { retry: false });
    expect(time).toBe(0);
    await createSorceryClient(options).fetch('/deck');
    expect(time).toBe(30_000);
  });

  it('fails closed if saved limiter state is damaged', async () => {
    const directory = await temporary();
    await writeFile(join(directory, 'state.json'), '{broken');
    const fetchImpl = vi.fn();
    const client = createSorceryClient({ fetchImpl, withRateState: filesystemSorceryRateState(directory) });
    await expect(client.fetch('/cards')).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
