import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stagingSourceFingerprint, verifyStagingSource } from './staging-source.mjs';

const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function fixture() {
  const folder = await mkdtemp(path.join(tmpdir(), 'sorcery-staging-source-'));
  directories.push(folder);
  const root = path.join(folder, 'shared');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'public/assets'), { recursive: true });
  await writeFile(path.join(root, 'src/App.tsx'), 'existing app');
  await writeFile(path.join(root, 'public/assets/card.webp'), 'existing art');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init', '--quiet');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  return { root, folder, git };
}

describe('staging release source guard', () => {
  it('rejects a committed-only worktree that omits the shared layout features', async () => {
    const { root, folder, git } = await fixture();
    const isolated = path.join(folder, 'isolated');
    git('worktree', 'add', '--quiet', '--detach', isolated, 'HEAD');
    await expect(verifyStagingSource(isolated)).resolves.toBe(await stagingSourceFingerprint(root));
    await writeFile(path.join(root, 'src/LayoutEditor.tsx'), 'uncommitted saved-layout editor');
    await expect(verifyStagingSource(isolated)).rejects.toThrow('differs from the shared checkout');
    await expect(verifyStagingSource(root)).resolves.toBe(await stagingSourceFingerprint(root));
  });

  it('rejects a stale build after code, deletion, or card artwork changes', async () => {
    const { root } = await fixture();
    const artifact = path.join(root, '.deploy/staging');
    await mkdir(artifact, { recursive: true });
    const stamp = async () => writeFile(path.join(artifact, '.deploy-ready.json'),
      JSON.stringify({ sourceFingerprint: await stagingSourceFingerprint(root) }));
    await stamp();
    await expect(verifyStagingSource(root, artifact)).resolves.toBeTruthy();
    await writeFile(path.join(root, 'src/App.tsx'), 'updated highlighting');
    await expect(verifyStagingSource(root, artifact)).rejects.toThrow('stale');
    await stamp();
    await writeFile(path.join(root, 'public/assets/card.webp'), 'new frame recovery');
    await expect(verifyStagingSource(root, artifact)).rejects.toThrow('stale');
    await stamp();
    const previews = path.join(root, 'offlineData/card-previews/baldassares-travels');
    await mkdir(previews, { recursive: true });
    await writeFile(path.join(previews, 'manifest.json'), JSON.stringify({ corners: 'corrected' }));
    await expect(verifyStagingSource(root, artifact)).rejects.toThrow('stale');
    await stamp();
    await rm(path.join(root, 'src/App.tsx'));
    await expect(verifyStagingSource(root, artifact)).rejects.toThrow('stale');
  });
});
