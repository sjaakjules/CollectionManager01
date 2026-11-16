import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importPlaySorceryAnalytics } from './import-play-sorcery-analytics.mjs';
import { analyticsResponseFixture } from '../src/data/__fixtures__/playSorceryAnalytics.ts';

vi.mock('./lib/card-catalog.mjs', () => ({ readCardCatalog: async () => ({ cards: [{ name: 'Toolbox' }], issues: [] }) }));
const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('offline analytics archive command', () => {
  it('writes an owner-only, credential-free snapshot and reports unknown names without any network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No live requests')));
    const directory = await mkdtemp(join(tmpdir(), 'sorcery-analytics-test-')); directories.push(directory);
    const input = join(directory, 'cards'); const output = join(directory, 'archive', 'constructed.json');
    await writeFile(input, JSON.stringify({ ...analyticsResponseFixture(), cookie: 'synthetic-secret' }));
    const result = await importPlaySorceryAnalytics(input, output);
    expect(result).toMatchObject({ cards: 2, matched: 1, unmatched: ['Unknown Card'] });
    expect(await readFile(output, 'utf8')).not.toContain('synthetic-secret');
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the last archive on invalid input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sorcery-analytics-test-')); directories.push(directory);
    const input = join(directory, 'cards'); const output = join(directory, 'constructed.json');
    await writeFile(input, '<html>Sign in</html>'); await writeFile(output, 'previous snapshot');
    await expect(importPlaySorceryAnalytics(input, output)).rejects.toThrow('not JSON');
    expect(await readFile(output, 'utf8')).toBe('previous snapshot');
  });
});
