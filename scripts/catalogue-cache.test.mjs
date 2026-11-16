import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const phpAvailable = spawnSync('php', ['--version']).status === 0;
const modulePath = fileURLToPath(new URL('../server/php/api/shared/catalogue-cache.php', import.meta.url));
const directories = [];
const body = JSON.stringify([{ name: 'Frost Mage', engine: { type: 'Avatar' }, printings: [] }]);
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'sorcery-catalogue-cache-test-'));
  directories.push(directory);
  const snapshot = join(directory, 'snapshot.json');
  await writeFile(snapshot, body);
  await utimes(snapshot, 100, 100);
  return { directory, snapshot };
}
async function run(code, fixture) {
  const { stdout } = await execute('php', ['-d', `sys_temp_dir=${fixture.directory}`, '-r',
    `require ${JSON.stringify(modulePath)}; $snapshot = ${JSON.stringify(fixture.snapshot)}; ${code}`]);
  return JSON.parse(stdout);
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe.skipIf(!phpAvailable)('shared daily catalogue cache (offline)', () => {
  it('serves a new bundled snapshot without requesting an upstream refresh', async () => {
    const result = await run('$cache = sorcery_catalogue_begin($snapshot, 101); echo json_encode($cache);', await fixture());
    expect(result).toMatchObject({ refresh: false, state: 'fresh', body });
  });

  it('permits one refresh, serves stale data to concurrent visitors, then caches success for a day', async () => {
    const result = await run(`
      $first = sorcery_catalogue_begin($snapshot, 90000);
      $second = sorcery_catalogue_begin($snapshot, 90000);
      $finished = sorcery_catalogue_finish($first, $first['body'], 200, 90001);
      $third = sorcery_catalogue_begin($snapshot, 90002);
      echo json_encode([$first['refresh'], $second['refresh'], $second['body'], $finished, $third['refresh'], $third['saved']['retryAt']]);
    `, await fixture());
    expect(result).toEqual([true, false, body, { body, state: 'refreshed' }, false, 176401]);
  });

  it.each([['503', 503], ['malformed', 200], ['[]', 200]])('retains good data and backs off after %s', async (incoming, status) => {
    const result = await run(`
      $first = sorcery_catalogue_begin($snapshot, 90000);
      $finished = sorcery_catalogue_finish($first, ${JSON.stringify(incoming)}, ${status}, 90001);
      $next = sorcery_catalogue_begin($snapshot, 90002);
      echo json_encode([$finished, $next['refresh'], $next['saved']['retryAt']]);
    `, await fixture());
    expect(result).toEqual([{ body, state: 'stale' }, false, 93601]);
  });

  it('backs off on cold-start failures as well, without permitting a visitor retry storm', async () => {
    const test = await fixture();
    await rm(test.snapshot);
    const result = await run(`
      $first = sorcery_catalogue_begin($snapshot, 90000);
      $finished = sorcery_catalogue_finish($first, '', 502, 90001);
      $next = sorcery_catalogue_begin($snapshot, 90002);
      echo json_encode([$finished, $next['refresh']]);
    `, test);
    expect(result).toEqual([{ body: null, state: 'stale' }, false]);
  });
});
