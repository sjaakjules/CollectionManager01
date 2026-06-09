#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSET_MANIFEST_FILE = '.deploy-assets.json';
export const ASSET_MANIFEST_VERSION = 1;
export const ASSET_MANIFEST_ALGORITHM = 'sha256';
export const IGNORED_SYSTEM_FILE_NAMES = new Set([
  '.DS_Store',
  '.localized',
  'Thumbs.db',
  'ehthumbs.db',
  'Desktop.ini',
  '.apdisk',
]);
export const IGNORED_SYSTEM_DIR_NAMES = new Set([
  '__MACOSX',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  '.TemporaryItems',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortPaths(paths) {
  return [...paths].sort((a, b) => a.localeCompare(b));
}

export function isIgnoredSystemPath(assetPath) {
  const normalizedPath = assetPath.split(path.sep).join('/');

  for (const segment of normalizedPath.split('/')) {
    if (
      /[\u0000-\u001f]/u.test(segment) ||
      segment.startsWith('._') ||
      IGNORED_SYSTEM_FILE_NAMES.has(segment) ||
      IGNORED_SYSTEM_DIR_NAMES.has(segment)
    ) {
      return true;
    }
  }

  return false;
}

export function validateAssetPath(value) {
  if (typeof value !== 'string') {
    throw new Error('Asset path must be a string');
  }

  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /[\u0000-\u001f]/u.test(value) ||
    !value.startsWith('assets/')
  ) {
    throw new Error(`Invalid managed asset path: ${value}`);
  }

  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`Invalid managed asset path: ${value}`);
    }
  }

  return value;
}

async function hashFile(filePath) {
  const hash = createHash(ASSET_MANIFEST_ALGORITHM);

  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  return hash.digest('hex');
}

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (isIgnoredSystemPath(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function createAssetManifest(artifactDir) {
  const rootDir = path.resolve(artifactDir);
  const assetsDir = path.join(rootDir, 'assets');
  const assets = {};

  try {
    const assetsStat = await fs.stat(assetsDir);
    if (!assetsStat.isDirectory()) {
      throw new Error(`Managed asset path is not a directory: ${assetsDir}`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        version: ASSET_MANIFEST_VERSION,
        algorithm: ASSET_MANIFEST_ALGORITHM,
        assets,
      };
    }
    throw error;
  }

  for (const filePath of await walkFiles(assetsDir)) {
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join('/');
    if (isIgnoredSystemPath(relativePath)) {
      continue;
    }

    validateAssetPath(relativePath);
    const stat = await fs.stat(filePath);
    assets[relativePath] = {
      sha256: await hashFile(filePath),
      size: stat.size,
    };
  }

  return {
    version: ASSET_MANIFEST_VERSION,
    algorithm: ASSET_MANIFEST_ALGORITHM,
    assets,
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readJsonIfPresent(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeManifest(manifest, { strict }) {
  const result = {
    valid: true,
    assets: new Map(),
    invalidPaths: [],
  };

  if (
    !isRecord(manifest) ||
    manifest.version !== ASSET_MANIFEST_VERSION ||
    manifest.algorithm !== ASSET_MANIFEST_ALGORITHM ||
    !isRecord(manifest.assets)
  ) {
    if (strict) {
      throw new Error('Invalid asset manifest shape');
    }
    result.valid = false;
    return result;
  }

  for (const [rawPath, entry] of Object.entries(manifest.assets)) {
    try {
      const assetPath = validateAssetPath(rawPath);
      if (
        !isRecord(entry) ||
        typeof entry.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0
      ) {
        throw new Error(`Invalid manifest entry for ${rawPath}`);
      }
      result.assets.set(assetPath, { sha256: entry.sha256, size: entry.size });
    } catch (error) {
      if (strict) throw error;
      result.invalidPaths.push(rawPath);
    }
  }

  return result;
}

export function compareAssetManifests(localManifest, remoteManifest) {
  const local = normalizeManifest(localManifest, { strict: true });
  const remoteManifestFound = remoteManifest !== null && remoteManifest !== undefined;

  if (!remoteManifestFound) {
    return {
      remoteManifestFound: false,
      remoteManifestValid: false,
      bootstrap: true,
      invalidRemotePaths: [],
      uploadPaths: sortPaths(local.assets.keys()),
      deletePaths: [],
    };
  }

  const remote = normalizeManifest(remoteManifest, { strict: false });

  if (!remote.valid) {
    return {
      remoteManifestFound: true,
      remoteManifestValid: false,
      bootstrap: true,
      invalidRemotePaths: remote.invalidPaths,
      uploadPaths: sortPaths(local.assets.keys()),
      deletePaths: [],
    };
  }

  const uploadPaths = [];
  const deletePaths = [];

  for (const assetPath of sortPaths(local.assets.keys())) {
    const localEntry = local.assets.get(assetPath);
    const remoteEntry = remote.assets.get(assetPath);

    if (
      !remoteEntry ||
      remoteEntry.sha256 !== localEntry.sha256 ||
      remoteEntry.size !== localEntry.size
    ) {
      uploadPaths.push(assetPath);
    }
  }

  for (const assetPath of sortPaths(remote.assets.keys())) {
    if (!local.assets.has(assetPath)) {
      deletePaths.push(assetPath);
    }
  }

  return {
    remoteManifestFound: true,
    remoteManifestValid: true,
    bootstrap: false,
    invalidRemotePaths: remote.invalidPaths,
    uploadPaths,
    deletePaths,
  };
}

export async function writeAssetManifest(artifactDir, manifestPath = path.join(artifactDir, ASSET_MANIFEST_FILE)) {
  const manifest = await createAssetManifest(artifactDir);
  await writeJson(manifestPath, manifest);
  return manifest;
}

export async function materializeUploadTree(artifactDir, uploadRoot, uploadPaths) {
  const resolvedArtifactDir = path.resolve(artifactDir);
  const resolvedUploadRoot = path.resolve(uploadRoot);

  await fs.rm(resolvedUploadRoot, { recursive: true, force: true });
  await fs.mkdir(resolvedUploadRoot, { recursive: true });

  for (const rawPath of uploadPaths) {
    const assetPath = validateAssetPath(rawPath);
    const sourcePath = path.join(resolvedArtifactDir, assetPath);
    const targetPath = path.join(resolvedUploadRoot, assetPath);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    const stat = await fs.stat(sourcePath);
    await fs.chmod(targetPath, stat.mode & 0o777);
  }
}

export async function createAssetSyncPlan({
  artifactDir,
  remoteManifestPath,
  planPath,
  uploadRoot,
}) {
  const manifestPath = path.join(artifactDir, ASSET_MANIFEST_FILE);
  const localManifest = await readJson(manifestPath);
  const remoteManifest = remoteManifestPath ? await readJsonIfPresent(remoteManifestPath) : null;
  const diff = compareAssetManifests(localManifest, remoteManifest);

  if (uploadRoot) {
    await materializeUploadTree(artifactDir, uploadRoot, diff.uploadPaths);
  }

  const plan = {
    version: ASSET_MANIFEST_VERSION,
    remoteManifestFound: diff.remoteManifestFound,
    remoteManifestValid: diff.remoteManifestValid,
    bootstrap: diff.bootstrap,
    uploadPaths: diff.uploadPaths,
    deletePaths: diff.deletePaths,
    invalidRemotePaths: diff.invalidRemotePaths,
    stats: {
      uploadCount: diff.uploadPaths.length,
      deleteCount: diff.deletePaths.length,
    },
  };

  if (planPath) {
    await writeJson(planPath, plan);
  }

  return plan;
}

function usage() {
  return `Usage:
  deploy-assets.mjs write-manifest <artifact-dir> [manifest-path]
  deploy-assets.mjs plan <artifact-dir> <remote-manifest-path|-> <plan-path> [upload-root]
  deploy-assets.mjs compare <local-manifest-path> <remote-manifest-path|-> [plan-path]
`;
}

async function main(argv) {
  const [command, ...args] = argv;

  if (command === 'write-manifest') {
    const [artifactDir, manifestPath] = args;
    if (!artifactDir) throw new Error(usage());
    const outputPath = manifestPath ?? path.join(artifactDir, ASSET_MANIFEST_FILE);
    const manifest = await writeAssetManifest(artifactDir, outputPath);
    console.log(`Wrote ${Object.keys(manifest.assets).length} asset hashes to ${outputPath}`);
    return;
  }

  if (command === 'plan') {
    const [artifactDir, remoteManifestArg, planPath, uploadRoot] = args;
    if (!artifactDir || !remoteManifestArg || !planPath) throw new Error(usage());
    const plan = await createAssetSyncPlan({
      artifactDir,
      remoteManifestPath: remoteManifestArg === '-' ? null : remoteManifestArg,
      planPath,
      uploadRoot,
    });
    const remoteStatus = plan.remoteManifestValid
      ? 'valid'
      : plan.remoteManifestFound
        ? 'invalid'
        : 'missing';
    console.log(
      `Asset sync plan: ${plan.stats.uploadCount} upload(s), ${plan.stats.deleteCount} delete(s), remote manifest ${remoteStatus}.`
    );
    return;
  }

  if (command === 'compare') {
    const [localManifestPath, remoteManifestArg, planPath] = args;
    if (!localManifestPath || !remoteManifestArg) throw new Error(usage());
    const localManifest = await readJson(localManifestPath);
    const remoteManifest = remoteManifestArg === '-' ? null : await readJsonIfPresent(remoteManifestArg);
    const diff = compareAssetManifests(localManifest, remoteManifest);
    const plan = {
      version: ASSET_MANIFEST_VERSION,
      ...diff,
      stats: {
        uploadCount: diff.uploadPaths.length,
        deleteCount: diff.deletePaths.length,
      },
    };

    if (planPath) {
      await writeJson(planPath, plan);
    }

    console.log(
      `Asset manifest compare: ${plan.stats.uploadCount} upload(s), ${plan.stats.deleteCount} delete(s).`
    );
    return;
  }

  throw new Error(usage());
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
