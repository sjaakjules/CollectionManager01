#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';

const IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg']);

const DEFAULTS = {
  inputDir: 'public/assets/Cards',
  outputDir: 'public/assets/CardsThumbAtlas',
  atlasWidth: 1024,
  atlasHeight: 1024,
  atlasMin: 6,
  atlasMax: 10,
  atlasCount: 0,
  quality: 58,
  effort: 4,
  padding: 2,
  cardWidth: 92,
  cardHeight: 128,
  resizeFit: 'contain',
  order: 'canvas',
  metadataPath: 'docs/Sorcery_CardInfo.json',
  dryRun: false,
};

function printHelp() {
  console.log(`Generate deterministic card atlas pages + manifest.

Usage:
  node scripts/generate-card-thumb-atlases.mjs [options]

Options:
  -i, --input <dir>          Source directory (default: ${DEFAULTS.inputDir})
  -o, --output <dir>         Output directory (default: ${DEFAULTS.outputDir})
      --atlas-width <px>     Atlas page width (default: ${DEFAULTS.atlasWidth})
      --atlas-height <px>    Atlas page max height (default: ${DEFAULTS.atlasHeight})
      --atlas-count <num>    Fixed number of atlases using contiguous layout chunks
      --atlas-min <num>      Deprecated compatibility flag
      --atlas-max <num>      Deprecated compatibility flag
      --padding <px>         Pixel spacing between sprites (default: ${DEFAULTS.padding})
      --card-width <px>      Force packed card width (default: ${DEFAULTS.cardWidth})
      --card-height <px>     Force packed card height (default: ${DEFAULTS.cardHeight})
      --resize-fit <mode>    contain | cover | fill | inside (default: ${DEFAULTS.resizeFit})
      --order <mode>         canvas | name | file (default: ${DEFAULTS.order})
      --metadata <file>      Card metadata for canvas order (default: ${DEFAULTS.metadataPath})
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

    if (arg === '--order') {
      options.order = next;
      i++;
      continue;
    }

    if (arg === '--metadata') {
      options.metadataPath = next;
      i++;
      continue;
    }

    if (arg === '--seed') {
      // Deprecated compatibility flag. Atlas generation is deterministic now.
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
  if (
    options.order !== 'canvas' &&
    options.order !== 'name' &&
    options.order !== 'file'
  ) {
    throw new Error('--order must be one of: canvas, name, file');
  }

  return options;
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

function normalizeToAscii(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function cardNameToSlug(cardName) {
  return normalizeToAscii(cardName)
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[-\s]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .trim();
}

function getThresholdGroup(thresholds) {
  const active = [];
  if ((thresholds?.air ?? 0) > 0) active.push('air');
  if ((thresholds?.earth ?? 0) > 0) active.push('earth');
  if ((thresholds?.fire ?? 0) > 0) active.push('fire');
  if ((thresholds?.water ?? 0) > 0) active.push('water');
  if (active.length === 0) return 'none';
  if (active.length > 1) return 'multiple';
  return active[0] ?? 'none';
}

const THRESHOLD_GROUP_ORDER = [
  'air',
  'earth',
  'fire',
  'water',
  'none',
  'multiple',
];
const TYPE_ORDER = ['Minion', 'Magic', 'Aura', 'Artifact', 'Site'];
const AVATAR_SET_ORDER = [
  'Alpha',
  'Beta',
  'Arthurian Legends',
  'Dragonlord',
  'Gothic',
  'Promotional',
];
const RARITY_ORDER = {
  None: 0,
  Ordinary: 1,
  Exceptional: 2,
  Elite: 3,
  Unique: 4,
};

function getAvatarSetIndex(setName) {
  const index = AVATAR_SET_ORDER.indexOf(setName);
  return index >= 0 ? index : AVATAR_SET_ORDER.length;
}

function compareByCostThenName(a, b) {
  const costDiff = a.cost - b.cost;
  if (costDiff !== 0) return costDiff;
  return a.name.localeCompare(b.name);
}

async function loadCanvasSlugOrder(metadataPath) {
  const absolutePath = path.resolve(metadataPath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  const cards = JSON.parse(raw);
  if (!Array.isArray(cards)) {
    throw new Error(`Metadata file must contain an array: ${absolutePath}`);
  }

  const normalized = cards.map((card) => ({
    name: card.name,
    slug: cardNameToSlug(card.name),
    type: card.guardian?.type ?? 'Minion',
    rarity: card.guardian?.rarity ?? 'None',
    cost: card.guardian?.cost ?? 0,
    thresholdGroup: getThresholdGroup(card.guardian?.thresholds),
    primarySet: card.sets?.[0]?.name,
  }));

  const ordered = [];
  const avatars = normalized
    .filter((card) => card.type === 'Avatar')
    .sort((a, b) => {
      const setDiff = getAvatarSetIndex(a.primarySet) - getAvatarSetIndex(b.primarySet);
      if (setDiff !== 0) return setDiff;
      const rarityDiff =
        (RARITY_ORDER[a.rarity] ?? RARITY_ORDER.None) -
        (RARITY_ORDER[b.rarity] ?? RARITY_ORDER.None);
      if (rarityDiff !== 0) return rarityDiff;
      return a.name.localeCompare(b.name);
    });
  ordered.push(...avatars);

  const nonAvatars = normalized.filter((card) => card.type !== 'Avatar');
  for (const thresholdGroup of THRESHOLD_GROUP_ORDER) {
    for (const type of TYPE_ORDER) {
      ordered.push(
        ...nonAvatars
          .filter(
            (card) =>
              card.thresholdGroup === thresholdGroup && card.type === type,
          )
          .sort(compareByCostThenName),
      );
    }
  }

  return ordered.map((card) => card.slug);
}

async function orderEntries(entries, options) {
  if (options.order === 'file') {
    return entries;
  }
  if (options.order === 'name') {
    return [...entries].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  const slugOrder = await loadCanvasSlugOrder(options.metadataPath);
  const orderIndex = new Map(slugOrder.map((slug, index) => [slug, index]));
  return [...entries].sort((a, b) => {
    const aIndex = orderIndex.get(a.slug);
    const bIndex = orderIndex.get(b.slug);
    if (aIndex !== undefined && bIndex !== undefined) {
      return aIndex - bIndex;
    }
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return a.slug.localeCompare(b.slug);
  });
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

function buildFixedCountLayout(allEntries, atlasCount, atlasWidth, atlasHeight, padding) {
  const groupSize = Math.ceil(allEntries.length / atlasCount);
  const groups = [];
  for (let i = 0; i < atlasCount; i++) {
    groups.push(allEntries.slice(i * groupSize, (i + 1) * groupSize));
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

function buildSequentialLayout(allEntries, atlasWidth, atlasHeight, padding) {
  const atlases = [];
  let currentEntries = [];
  let currentPacked = null;

  const pushCurrent = () => {
    if (!currentPacked) return;
    atlases.push({
      id: `atlas-${atlases.length}`,
      ...currentPacked,
    });
  };

  for (const entry of allEntries) {
    const candidateEntries = [...currentEntries, entry];
    const candidatePacked = packAtlasGroup(
      candidateEntries,
      atlasWidth,
      atlasHeight,
      padding,
    );

    if (candidatePacked) {
      currentEntries = candidateEntries;
      currentPacked = candidatePacked;
      continue;
    }

    pushCurrent();
    currentEntries = [entry];
    currentPacked = packAtlasGroup(
      currentEntries,
      atlasWidth,
      atlasHeight,
      padding,
    );
    if (!currentPacked) {
      throw new Error(
        `Unable to pack ${entry.slug} into ${atlasWidth}x${atlasHeight}.`,
      );
    }
  }

  pushCurrent();
  return atlases;
}

function buildLayout(allEntries, options) {
  if (options.atlasCount > 0) {
    return buildFixedCountLayout(
      allEntries,
      options.atlasCount,
      options.atlasWidth,
      options.atlasHeight,
      options.padding,
    );
  }

  return buildSequentialLayout(
    allEntries,
    options.atlasWidth,
    options.atlasHeight,
    options.padding,
  );
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

  const forcedSize =
    options.cardWidth > 0 && options.cardHeight > 0
      ? { width: options.cardWidth, height: options.cardHeight }
      : null;
  const rawEntries = await getImageEntries(imageFiles, forcedSize);
  const entries = await orderEntries(rawEntries, options);
  const selectedAtlases = buildLayout(entries, options);

  if (!selectedAtlases) {
    throw new Error(
      `Unable to pack ${entries.length} images at ${options.atlasWidth}x${options.atlasHeight}.`,
    );
  }

  console.log(
    `Atlas order=${options.order} pages=${selectedAtlases.length} images=${entries.length}`,
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
    version: 2,
    generatedAt: new Date().toISOString(),
    order: options.order,
    metadataPath: options.order === 'canvas' ? options.metadataPath : null,
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
