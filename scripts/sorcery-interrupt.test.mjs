import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSorceryClient } from '../src/data/sorceryRequest.ts';
import { filesystemSorceryRateState } from './lib/sorcery-client.ts';
import { runArchive } from './fetch-sorcery-decks.mjs';
import { collectSorceryDeckSearch } from './search-sorcery-decks.mjs';

afterEach(() => vi.restoreAllMocks());

describe('maintenance command interruption (offline)', () => {
  it.each(['archive', 'search'])('releases the %s request lock before flushing and exiting', async (kind) => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const directory = await mkdtemp(join(tmpdir(), 'sorcery-interrupt-test-'));
    const initialListeners = process.listenerCount('SIGINT');
    const client = createSorceryClient({
      withRateState: filesystemSorceryRateState(directory),
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        queueMicrotask(() => process.emit('SIGINT'));
      }),
    });
    const writeJsonFile = vi.fn(async () => {
      expect(existsSync(join(directory, 'active.lock'))).toBe(false);
    });
    const exitProcess = vi.fn(() => {
      expect(writeJsonFile).toHaveBeenCalled();
      expect(existsSync(join(directory, 'active.lock'))).toBe(false);
    });
    const dependencies = {
      sorceryClient: client, handleSignals: true, exitProcess, writeJsonFile,
      writeTextFile: async () => undefined, liveDashboard: false,
      cardData: [], archive: {}, skippedArchive: {},
      inputs: [{ id: 'deck-id', raw: 'deck-id', hint: {} }],
    };
    try {
      const result = kind === 'archive'
        ? runArchive({ output: 'archive.json', log: 'archive.log' }, dependencies)
        : collectSorceryDeckSearch({ query: 'event', searchOutput: 'search.json' }, dependencies);
      await expect(result).rejects.toMatchObject({ name: 'AbortError' });
      expect(exitProcess).toHaveBeenCalledWith(130);
      expect(process.listenerCount('SIGINT')).toBe(initialListeners);
      const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
      expect(state.nextAllowedAtMs).toBeGreaterThan(Date.now());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
