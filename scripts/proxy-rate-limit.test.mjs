import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const phpAvailable = spawnSync('php', ['--version']).status === 0;
const proxy = fileURLToPath(new URL('../server/php/api/shared/proxy.php', import.meta.url));
const directories = [];
async function php(code, directory) {
  const { stdout } = await execute('php', ['-d', `sys_temp_dir=${directory}`, '-r', `require ${JSON.stringify(proxy)}; ${code}`]);
  return JSON.parse(stdout);
}
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), 'sorcery-php-test-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe.skipIf(!phpAvailable)('PHP upstream throttle (local files only)', () => {
  it('enforces the shared namespace and a minimum 3-second interval', async () => {
    const config = await php(`echo json_encode(sorcery_proxy_rate_config([
      'min_interval_ms' => 0, 'namespace' => 'cards',
      'low_remaining_threshold' => 0, 'safe_remaining_target' => 1
    ]));`, await temporary());
    expect(config).toMatchObject({ namespace: 'sorcerytcg', minIntervalMs: 3000,
      lowRemainingThreshold: 2, safeRemainingTarget: 5, maxSleepMs: 8000 });
  });

  it('uses the longest of spacing, Retry-After and reset deadlines', async () => {
    const delay = await php(`
      $state = ['nextAllowedAtMs' => 13000, 'retryAfterUntilMs' => 15000, 'remaining' => 0, 'resetMs' => 20000];
      echo json_encode(sorcery_proxy_rate_delay($state, sorcery_proxy_rate_config([]), 10000));
    `, await temporary());
    expect(delay[0]).toBe(10_000);
  });

  it('does not turn invalid Retry-After values into permission for an immediate retry', async () => {
    const delays = await php(`echo json_encode([
      sorcery_proxy_retry_after_ms('-1', 0),
      sorcery_proxy_retry_after_ms('1e100', 0),
      sorcery_proxy_retry_after_ms('0', 0)
    ]);`, await temporary());
    expect(delays).toEqual([null, null, 0]);
  });

  it('allows a depleted budget to recover instead of returning 429 forever', async () => {
    const delays = await php(`
      $state = ['remaining' => 2, 'updatedAtMs' => 10000];
      $config = sorcery_proxy_rate_config([]);
      $first = sorcery_proxy_rate_delay($state, $config, 10000);
      $second = sorcery_proxy_rate_delay($state, $config, 19000);
      echo json_encode([$first[0], $second[0]]);
    `, await temporary());
    expect(delays).toEqual([9000, 0]);
  });

  it('persists a minute cooldown for a headerless 503', async () => {
    const state = await php(`
      $limiter = sorcery_proxy_rate_limit_begin([]);
      sorcery_proxy_rate_limit_finish($limiter, '', 503);
      echo json_encode(sorcery_proxy_read_rate_state($limiter['statePath']));
    `, await temporary());
    expect(state.retryAfterUntilMs - state.updatedAtMs).toBe(60_000);
    expect(state.nextAllowedAtMs - state.updatedAtMs).toBe(3000);
  });

  it('serializes independent PHP processes through the same filesystem lock', async () => {
    const directory = await temporary();
    const code = `
      $limiter = sorcery_proxy_rate_limit_begin([]);
      $started = sorcery_proxy_millis();
      usleep(100000);
      sorcery_proxy_rate_limit_finish($limiter, '');
      echo json_encode($started);
    `;
    const times = (await Promise.all([php(code, directory), php(code, directory)])).sort((a, b) => a - b);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(3100);
  }, 15_000);
});
