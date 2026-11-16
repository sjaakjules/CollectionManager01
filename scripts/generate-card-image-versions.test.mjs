import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { writeCardImageVersions } from './generate-card-image-versions.mjs';

it('invalidates only replaced card images and leaves an unchanged manifest untouched', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sorcery-image-versions-'));
  const output = path.join(directory, 'versions.json');
  try {
    await writeFile(path.join(directory, 'frost_mage.webp'), 'old photo');
    await writeFile(path.join(directory, 'lavamancer.webp'), 'official artwork');
    await writeCardImageVersions(directory, output);
    const before = JSON.parse(await readFile(output, 'utf8'));
    const timestamp = (await stat(output)).mtimeMs;
    await writeCardImageVersions(directory, output);
    expect((await stat(output)).mtimeMs).toBe(timestamp);
    await writeFile(path.join(directory, 'frost_mage.webp'), 'official replacement');
    await writeCardImageVersions(directory, output);
    const after = JSON.parse(await readFile(output, 'utf8'));
    expect(after.frost_mage).not.toBe(before.frost_mage);
    expect(after.lavamancer).toBe(before.lavamancer);
    await rm(path.join(directory, 'frost_mage.webp'));
    await writeCardImageVersions(directory, output);
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ lavamancer: before.lavamancer });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
