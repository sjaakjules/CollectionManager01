#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';

const IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg']);

const DEFAULTS = {
  inputDir: 'public/assets/CardsThumb',
  outputDir: 'public/assets/CardsThumbAtlas',
  atlasWidth: 4096,
  atlasHeight: 4096,
  atlasMin: 6,
  atlasMax: 10,
  atlasCount: 0,
  quality: 62,
  effort: 4,
  padding: 2,
  cardWidth: 0,
  cardHeight: 0,
  resizeFit: 'contain',
  seed: Date.now() >>> 0,
  dryRun: false,
};

function printHelp() {
  console.log(`Generate random thumbnail atlas pages + manifest.

Usage:
  node scripts/generate-card-thumb-atlases.mjs [options]

Options:
  -i, --input <dir>          Source directory (default: ${DEFAULTS.inputDir})
  -o, --output <dir>         Output directory (default: ${DEFAULTS.outputDir})
      --atlas-width <px>     Atlas page width (default: ${DEFAULTS.atlasWidth})
      --atlas-height <px>    Atlas page max height (default: ${DEFAULTS.atlasHeight})
      --atlas-count <num>    Fixed number of atlases (overrides min/max)
      --atlas-min <num>      Minimum atlas count (default: ${DEFAULTS.atlasMin})
      --atlas-max <num>      Maximum atlas count (default: ${DEFAULTS.atlasMax})
      --padding <px>         Pixel spacing between sprites (default: ${DEFAULTS.padding})
      --card-width <px>      Force packed card width
      --card-height <px>     Force packed card height
      --resize-fit <mode>    contain | cover | fill | inside (default: ${DEFAULTS.resizeFit})
      --seed <num>           RNG seed (default: current timestamp)
  -q, --quality <1-100>      Atlas WebP quality (default: ${DEFAULTS.quality})
  -e, --effort <0-6>         Atlas WebP effort (default: ${DEFAULTS.effort})
      --dry-run              Compute layout only (no file writes)
  -h, --help                 Show this help
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
    if (!arg || arg === '--') continue;

    if (arg === '-h' || arg === '--help') {
      options.help = true;
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

    if (arg === '--atlas-width') {
      options.atlasWidth = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    if (arg === '--atlas-height') {
      options.atlasHeight = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    if (arg === '--atlas-count') {
      options.atlasCount = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    if (arg === '--atlas-min') {
      options.atlasMin = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    if (arg === '--atlas-max') {
      options.atlasMax = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    if (arg === '--padding') {
      options.padding = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    if (arg === '--card-width') {
      options.cardWidth = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    if (arg === '--card-height') {
      options.cardHeight = parsePositiveInt(next, arg);
      i++;
      continue;
    }

    if (arg === '--resize-fit') {
      options.resizeFit = next;
      i++;
      continue;
    }

    if (arg === '--seed') {
      options.seed = parsePositiveInt(next, arg);
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.quality < 1 || options.quality > 100) {
    throw new Error('--quality must be between 1 and 100');
  }
  if (options.effort < 0 || options.effort > 6) {
    throw new Error('--effort must be between 0 and 6');
  }
  if (options.atlasMin < 1 || options.atlasMax < 1) {
    throw new Error('--atlas-min and --atlas-max must be at least 1');
  }
  if (options.atlasMin > options.atlasMax) {
    throw new Error('--atlas-min cannot be greater than --atlas-max');
  }
  if (options.atlasCount > 0) {
    options.atlasMin = options.atlasCount;
    options.atlasMax = options.atlasCount;
  }
  if (options.atlasWidth < 64 || options.atlasHeight < 64) {
    throw new Error('--atlas-width and --atlas-height must be at least 64');
  }
  if (options.padding < 0) {
    throw new Error('--padding must be >= 0');
  }
  const hasForcedWidth = options.cardWidth > 0;
  const hasForcedHeight = options.cardHeight > 0;
  if (hasForcedWidth !== hasForcedHeight) {
    throw new Error('--card-width and --card-height must be provided together');
  }
  if (hasForcedWidth && (options.cardWidth < 32 || options.cardHeight < 32)) {
    throw new Error('--card-width and --card-height must be at least 32');
  }
  if (
    options.resizeFit !== 'contain' &&
    options.resizeFit !== 'cover' &&
    options.resizeFit !== 'fill' &&
    options.resizeFit !== 'inside'
  ) {
    throw new Error('--resize-fit must be one of: contain, cover, fill, inside');
  }

  return options;
}

function createRng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), 1 | t);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function randomIntInclusive(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

function runPool(items, workerCount, workerFn) {
  let index = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(workerCount, items.length)) },
    async () => {
      while (true) {
        const current = index++;
        if (current >= items.length) return;
        await workerFn(items[current], current);
      }
    },
  );
  return Promise.all(workers);
}

async function getImageEntries(files, forcedSize) {
  const entries = [];
  await runPool(files, 16, async (filePath, idx) => {
    const slug = path.basename(filePath, path.extname(filePath));
    let width;
    let height;
    if (forcedSize) {
      width = forcedSize.width;
      height = forcedSize.height;
    } else {
      const meta = await sharp(filePath).metadata();
      if (!meta.width || !meta.height) {
        throw new Error(`Unable to read dimensions for ${filePath}`);
      }
      width = meta.width;
      height = meta.height;
    }
    entries[idx] = {
      slug,
      filePath,
      width,
      height,
    };
  });

  return entries;
}

function packAtlasGroup(entries, atlasWidth, atlasHeight, padding) {
  const sorted = [...entries].sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    return b.width - a.width;
  });

  let x = padding;
  let y = padding;
  let rowHeight = 0;
  let maxRight = 0;
  const placements = [];

  for (const entry of sorted) {
    if (entry.width + padding * 2 > atlasWidth) {
      return null;
    }

    if (x + entry.width + padding > atlasWidth) {
      x = padding;
      y += rowHeight + padding;
      rowHeight = 0;
    }

    if (y + entry.height + padding > atlasHeight) {
      return null;
    }

    placements.push({
      ...entry,
      x,
      y,
      w: entry.width,
      h: entry.height,
    });

    x += entry.width + padding;
    rowHeight = Math.max(rowHeight, entry.height);
    maxRight = Math.max(maxRight, x);
  }

  const usedWidth = Math.max(1, maxRight + padding);
  const usedHeight = Math.max(1, y + rowHeight + padding);

  return {
    placements,
    usedWidth,
    usedHeight,
  };
}

function buildLayout(allEntries, atlasCount, atlasWidth, atlasHeight, padding) {
  const groups = Array.from({ length: atlasCount }, () => []);
  for (let i = 0; i < allEntries.length; i++) {
    const entry = allEntries[i];
    if (!entry) continue;
    groups[i % atlasCount]?.push(entry);
  }

  const atlases = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (!group) continue;
    const packed = packAtlasGroup(group, atlasWidth, atlasHeight, padding);
    if (!packed) {
      return null;
    }
    atlases.push({
      id: `atlas-${i}`,
      ...packed,
    });
  }

  return atlases;
}

function toPublicUrl(absoluteFilePath) {
  const publicRoot = path.resolve('public');
  const rel = path.relative(publicRoot, absoluteFilePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Output path must be inside public/ to be loadable by the app: ${absoluteFilePath}`,
    );
  }
  return `/${rel.split(path.sep).join('/')}`;
}

async function writeAtlasImage(
  atlas,
  outputPath,
  quality,
  effort,
  cardSize,
  resizeFit,
) {
  const composites = [];
  for (const placement of atlas.placements) {
    if (!cardSize) {
      composites.push({
        input: placement.filePath,
        left: placement.x,
        top: placement.y,
      });
      continue;
    }

    const buffer = await sharp(placement.filePath)
      .rotate()
      .resize({
        width: cardSize.width,
        height: cardSize.height,
        fit: resizeFit,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();

    composites.push({
      input: buffer,
      left: placement.x,
      top: placement.y,
    });
  }

  await sharp({
    create: {
      width: atlas.usedWidth,
      height: atlas.usedHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites)
    .webp({
      quality,
      effort,
      smartSubsample: true,
      alphaQuality: 85,
    })
    .toFile(outputPath);
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

  const imageFiles = (await walkFiles(inputDir)).sort();
  if (imageFiles.length === 0) {
    throw new Error(`No images found in ${inputDir}`);
  }

  const rng = createRng(options.seed);
  const forcedSize =
    options.cardWidth > 0 && options.cardHeight > 0
      ? { width: options.cardWidth, height: options.cardHeight }
      : null;
  const entries = await getImageEntries(imageFiles, forcedSize);
  shuffleInPlace(entries, rng);

  const startAtlasCount = randomIntInclusive(rng, options.atlasMin, options.atlasMax);

  let selectedAtlases = null;
  let selectedCount = 0;

  for (let count = startAtlasCount; count <= options.atlasMax; count++) {
    const layout = buildLayout(
      entries,
      count,
      options.atlasWidth,
      options.atlasHeight,
      options.padding,
    );
    if (layout) {
      selectedAtlases = layout;
      selectedCount = count;
      break;
    }
  }

  if (!selectedAtlases) {
    throw new Error(
      `Unable to pack ${entries.length} images into ${options.atlasMin}-${options.atlasMax} atlases at ${options.atlasWidth}x${options.atlasHeight}.`,
    );
  }

  console.log(
    `Atlas seed=${options.seed} selectedCount=${selectedCount} startCount=${startAtlasCount} images=${entries.length}`,
  );
  if (forcedSize) {
    console.log(
      `Forced card size ${forcedSize.width}x${forcedSize.height} (fit=${options.resizeFit})`,
    );
  }

  if (options.dryRun) {
    for (const atlas of selectedAtlases) {
      console.log(
        `${atlas.id}: ${atlas.placements.length} cards, ${atlas.usedWidth}x${atlas.usedHeight}`,
      );
    }
    return;
  }

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const manifestCards = {};
  const manifestAtlases = [];
  let totalOutputBytes = 0;

  for (let i = 0; i < selectedAtlases.length; i++) {
    const atlas = selectedAtlases[i];
    if (!atlas) continue;

    const fileName = `${atlas.id}.webp`;
    const absolutePath = path.join(outputDir, fileName);
    await writeAtlasImage(
      atlas,
      absolutePath,
      options.quality,
      options.effort,
      forcedSize,
      options.resizeFit,
    );
    const stat = await fs.stat(absolutePath);
    totalOutputBytes += stat.size;

    const imageUrl = toPublicUrl(absolutePath);
    manifestAtlases.push({
      id: atlas.id,
      image: imageUrl,
      width: atlas.usedWidth,
      height: atlas.usedHeight,
      count: atlas.placements.length,
    });

    for (const placement of atlas.placements) {
      manifestCards[placement.slug] = {
        atlasId: atlas.id,
        x: placement.x,
        y: placement.y,
        w: placement.w,
        h: placement.h,
      };
    }
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    seed: options.seed,
    atlasCount: manifestAtlases.length,
    atlasWidth: options.atlasWidth,
    atlasHeight: options.atlasHeight,
    cardWidth: forcedSize?.width ?? null,
    cardHeight: forcedSize?.height ?? null,
    resizeFit: forcedSize ? options.resizeFit : null,
    cards: manifestCards,
    atlases: manifestAtlases,
  };

  const manifestPath = path.join(outputDir, 'manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2);
  console.log(`Wrote ${manifestAtlases.length} atlases to ${outputDir}`);
  console.log(`Manifest: ${toPublicUrl(manifestPath)}`);
  console.log(`Cards mapped: ${Object.keys(manifestCards).length}`);
  console.log(`Atlas bytes: ${mb(totalOutputBytes)} MB`);
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
