#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Stable image URLs change only when that card's source bytes change. */
export async function writeCardImageVersions(inputDir, outputFile) {
  const files = (await readdir(inputDir)).filter(file => file.endsWith('.webp')).sort();
  if (!files.length) throw new Error(`No WebP card images found in ${inputDir}`);
  const versions = {};
  for (const file of files) {
    versions[file.slice(0, -5)] = createHash('sha256')
      .update(await readFile(path.join(inputDir, file))).digest('hex').slice(0, 16);
  }
  const content = `${JSON.stringify(versions, null, 2)}\n`;
  let previous;
  try { previous = await readFile(outputFile, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous !== content) {
    await mkdir(path.dirname(outputFile), { recursive: true });
    const temporary = `${outputFile}.${process.pid}.tmp`;
    await writeFile(temporary, content);
    await rename(temporary, outputFile);
  }
  return files.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await writeCardImageVersions(
    process.argv[2] ?? 'public/assets/Cards',
    process.argv[3] ?? 'src/data/cardImageVersions.json',
  );
  console.log(`Verified content versions for ${count} card images.`);
}
