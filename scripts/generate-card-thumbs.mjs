#!/usr/bin/env node

import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';

const IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg']);

const DEFAULTS = {
  inputDir: 'public/assets/Cards',
  outputDir: 'public/assets/CardsThumb',
  size: 128,
  quality: 56,
  effort: 4,
  concurrency: Math.max(1, Math.min(os.cpus().length, 8)),
  force: false,
  dryRun: false,
  limit: 0,
};

function printHelp() {
  console.log(`Generate thumbnail webp files for card art.

Usage:
  node scripts/generate-card-thumbs.mjs [options]

Options:
  -i, --input <dir>         Source directory (default: ${DEFAULTS.inputDir})
  -o, --output <dir>        Output directory (default: ${DEFAULTS.outputDir})
  -s, --size <px>           Max width/height in pixels (default: ${DEFAULTS.size})
  -q, --quality <1-100>     WebP quality (default: ${DEFAULTS.quality})
  -e, --effort <0-6>        WebP encode effort (default: ${DEFAULTS.effort})
  -c, --concurrency <num>   Parallel encodes (default: ${DEFAULTS.concurrency})
      --limit <num>         Process only first N files (default: all)
      --force               Rebuild even if output is newer
      --dry-run             Show what would be processed without writing files
  -h, --help                Show this help
`);
}

function parsePositiveInt(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flagName}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--') continue;

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--force') {
      options.force = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    const next = argv[i + 1];
    if (!next) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === '-i' || arg === '--input') {
      options.inputDir = next;
      i++;
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      options.outputDir = next;
      i++;
      continue;
    }

    if (arg === '-s' || arg === '--size') {
      options.size = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    if (arg === '-q' || arg === '--quality') {
      options.quality = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    if (arg === '-e' || arg === '--effort') {
      options.effort = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    if (arg === '-c' || arg === '--concurrency') {
      options.concurrency = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    if (arg === '--limit') {
      options.limit = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.quality < 1 || options.quality > 100) {
    throw new Error('--quality must be between 1 and 100');
  }

  if (options.effort < 0 || options.effort > 6) {
    throw new Error('--effort must be between 0 and 6');
  }

  if (options.size < 1) {
    throw new Error('--size must be at least 1');
  }

  if (options.concurrency < 1) {
    throw new Error('--concurrency must be at least 1');
  }

  return options;
}

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toWebpOutputPath(inputFile, inputRoot, outputRoot) {
  const rel = path.relative(inputRoot, inputFile);
  const relNoExt = rel.replace(path.extname(rel), '');
  return path.join(outputRoot, `${relNoExt}.webp`);
}

async function shouldSkip(inputFile, outputFile, force) {
  if (force) return false;
  if (!(await pathExists(outputFile))) return false;
  const [inStat, outStat] = await Promise.all([
    fs.stat(inputFile),
    fs.stat(outputFile),
  ]);
  return outStat.mtimeMs >= inStat.mtimeMs;
}

async function runPool(items, concurrency, worker) {
  let index = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const current = index++;
        if (current >= items.length) return;
        await worker(items[current], current);
      }
    },
  );
  await Promise.all(workers);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const inputDir = path.resolve(options.inputDir);
  const outputDir = path.resolve(options.outputDir);

  if (!(await pathExists(inputDir))) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  await ensureDir(outputDir);

  const allFiles = (await walkFiles(inputDir)).sort();
  if (allFiles.length === 0) {
    console.log(`No image files found in ${inputDir}`);
    return;
  }

  const files =
    options.limit > 0 ? allFiles.slice(0, options.limit) : allFiles;

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let inputBytes = 0;
  let outputBytes = 0;

  console.log(
    `Generating thumbnails: ${files.length} files (${options.size}px, q=${options.quality}, effort=${options.effort}, concurrency=${options.concurrency})`,
  );

  await runPool(files, options.concurrency, async (inputFile, idx) => {
    const outputFile = toWebpOutputPath(inputFile, inputDir, outputDir);
    await ensureDir(path.dirname(outputFile));

    try {
      if (await shouldSkip(inputFile, outputFile, options.force)) {
        skipped++;
        return;
      }

      if (options.dryRun) {
        generated++;
        return;
      }

      const inStat = await fs.stat(inputFile);
      inputBytes += inStat.size;

      const metadata = await sharp(inputFile, { failOn: 'none' }).metadata();
      const image = sharp(inputFile, { failOn: 'none' });
      if ((metadata.width ?? 0) > (metadata.height ?? 0)) {
        image.rotate(270);
      } else {
        image.rotate();
      }

      await image
        .resize({
          width: options.size,
          height: options.size,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({
          quality: options.quality,
          effort: options.effort,
          smartSubsample: true,
          alphaQuality: 80,
        })
        .toFile(outputFile);

      const outStat = await fs.stat(outputFile);
      outputBytes += outStat.size;
      generated++;
    } catch (error) {
      failed++;
      console.error(`Failed: ${path.relative(inputDir, inputFile)}`);
      if (error instanceof Error) {
        console.error(error.message);
      }
    } finally {
      const processed = idx + 1;
      if (processed % 100 === 0 || processed === files.length) {
        console.log(`Progress: ${processed}/${files.length}`);
      }
    }
  });

  const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2);
  console.log('');
  console.log(`Done. Generated: ${generated}, Skipped: ${skipped}, Failed: ${failed}`);
  if (!options.dryRun && generated > 0) {
    console.log(`Total input:  ${mb(inputBytes)} MB`);
    console.log(`Total output: ${mb(outputBytes)} MB`);
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
