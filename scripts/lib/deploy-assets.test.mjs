import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  compareAssetManifests,
  createAssetManifest,
  isIgnoredSystemPath,
} from './deploy-assets.mjs';

function manifest(assets) {
  return {
    version: 1,
    algorithm: 'sha256',
    assets,
  };
}

function entry(sha256, size = 12) {
  return { sha256, size };
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

describe('deploy asset manifest comparison', () => {
  it('skips unchanged files', () => {
    const local = manifest({
      'assets/Cards/fireball.webp': entry(HASH_A, 100),
    });
    const remote = manifest({
      'assets/Cards/fireball.webp': entry(HASH_A, 100),
    });

    expect(compareAssetManifests(local, remote)).toMatchObject({
      bootstrap: false,
      uploadPaths: [],
      deletePaths: [],
    });
  });

  it('uploads same-size files when content hash changed', () => {
    const local = manifest({
      'assets/Cards/fireball.webp': entry(HASH_A, 100),
    });
    const remote = manifest({
      'assets/Cards/fireball.webp': entry(HASH_B, 100),
    });

    expect(compareAssetManifests(local, remote).uploadPaths).toEqual([
      'assets/Cards/fireball.webp',
    ]);
  });

  it('uploads files missing from the remote manifest', () => {
    const local = manifest({
      'assets/Cards/fireball.webp': entry(HASH_A, 100),
      'assets/Cards/blizzard.webp': entry(HASH_B, 90),
    });
    const remote = manifest({
      'assets/Cards/fireball.webp': entry(HASH_A, 100),
    });

    expect(compareAssetManifests(local, remote).uploadPaths).toEqual([
      'assets/Cards/blizzard.webp',
    ]);
  });

  it('deletes remote-only files previously managed by the manifest', () => {
    const local = manifest({
      'assets/Cards/fireball.webp': entry(HASH_A, 100),
    });
    const remote = manifest({
      'assets/Cards/fireball.webp': entry(HASH_A, 100),
      'assets/Cards/removed.webp': entry(HASH_C, 80),
    });

    expect(compareAssetManifests(local, remote).deletePaths).toEqual([
      'assets/Cards/removed.webp',
    ]);
  });

  it('uploads all local assets and deletes none when the remote manifest is missing', () => {
    const local = manifest({
      'assets/Cards/fireball.webp': entry(HASH_A, 100),
      'assets/Cards/blizzard.webp': entry(HASH_B, 90),
    });

    expect(compareAssetManifests(local, null)).toMatchObject({
      remoteManifestFound: false,
      remoteManifestValid: false,
      bootstrap: true,
      uploadPaths: [
        'assets/Cards/blizzard.webp',
        'assets/Cards/fireball.webp',
      ],
      deletePaths: [],
    });
  });
});

describe('deploy asset manifest creation', () => {
  it('ignores OS metadata files under managed assets', async () => {
    const artifactDir = await mkdtemp(path.join(tmpdir(), 'sorcery-assets-test-'));
    await mkdir(path.join(artifactDir, 'assets', 'Cards'), { recursive: true });
    await mkdir(path.join(artifactDir, 'assets', '__MACOSX'), { recursive: true });

    await writeFile(path.join(artifactDir, 'assets', 'Cards', 'fireball.webp'), 'card-art');
    await writeFile(path.join(artifactDir, 'assets', '.DS_Store'), 'finder');
    await writeFile(path.join(artifactDir, 'assets', '.localized'), 'finder');
    await writeFile(path.join(artifactDir, 'assets', 'Icon\r'), 'finder');
    await writeFile(path.join(artifactDir, 'assets', 'Cards', '._fireball.webp'), 'appledouble');
    await writeFile(path.join(artifactDir, 'assets', 'Thumbs.db'), 'windows');
    await writeFile(path.join(artifactDir, 'assets', 'Desktop.ini'), 'windows');
    await writeFile(path.join(artifactDir, 'assets', '__MACOSX', 'junk'), 'archive');

    const assetManifest = await createAssetManifest(artifactDir);

    expect(Object.keys(assetManifest.assets)).toEqual([
      'assets/Cards/fireball.webp',
    ]);
    expect(isIgnoredSystemPath('assets/Cards/.DS_Store')).toBe(true);
    expect(isIgnoredSystemPath('assets/Icon\r')).toBe(true);
    expect(isIgnoredSystemPath('assets/Cards/._fireball.webp')).toBe(true);
    expect(isIgnoredSystemPath('assets/__MACOSX/junk')).toBe(true);
  });
});
