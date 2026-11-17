import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A commit ID alone cannot identify this project's shared, uncommitted release.
const inputs = ['src', 'public', 'server/php/api', 'scripts', 'hosting/sorcerystacks.staging.htaccess',
  'hosting/sorcerystacks.production.htaccess', 'index.html', 'previews', 'package.json',
  'pnpm-lock.yaml', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts',
  // These reviewed manifests are imported into the preview gallery bundle.
  'offlineData/card-previews/baldassares-travels/*.json'];

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

export async function stagingSourceFingerprint(root) {
  const files = [...new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...inputs])
    .split('\0').filter(name => name && !name.includes('.test.') && !name.includes('/__fixtures__/')))].sort();
  const hash = createHash('sha256');
  for (const name of files) {
    const filename = path.join(root, name);
    let info;
    try { info = await stat(filename); } catch (error) {
      if (error.code === 'ENOENT') continue; // Tracked deletions are absent from the release.
      throw error;
    }
    if (!info.isFile()) continue;
    hash.update(name).update('\0').update(createHash('sha256').update(await readFile(filename)).digest());
  }
  return hash.digest('hex');
}

export async function verifyStagingSource(root, artifact) {
  const fingerprint = await stagingSourceFingerprint(root);
  const main = git(root, ['worktree', 'list', '--porcelain', '-z']).split('\0')[0]?.replace(/^worktree /, '');
  if (!main) throw new Error('Cannot identify the shared checkout for staging.');
  if (path.resolve(main) !== path.resolve(root) && await stagingSourceFingerprint(main) !== fingerprint) {
    throw new Error('Staging release differs from the shared checkout. Build the combined changes there; an isolated commit would remove current features.');
  }
  if (artifact) {
    const marker = JSON.parse(await readFile(path.join(artifact, '.deploy-ready.json'), 'utf8'));
    if (marker.sourceFingerprint !== fingerprint) {
      throw new Error('Staging artifact is stale or has no source fingerprint. Run pnpm build:ventraip in the shared checkout before deploying.');
    }
  }
  return fingerprint;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, root, artifact] = process.argv.slice(2);
  try {
    if (!root || !['check', 'stamp', 'verify'].includes(command)) throw new Error('Usage: staging-source.mjs check|stamp|verify <checkout> [artifact]');
    const fingerprint = await verifyStagingSource(root, command === 'verify' ? artifact : undefined);
    if (command === 'stamp') {
      const filename = path.join(artifact, '.deploy-ready.json');
      const marker = JSON.parse(await readFile(filename, 'utf8'));
      await writeFile(filename, JSON.stringify({ ...marker, sourceFingerprint: fingerprint }, null, 2) + '\n');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
