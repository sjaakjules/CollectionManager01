import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { readCardCatalog } from './lib/card-catalog.mjs';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const slug = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/'/g, '').replace(/[-\s]+/g, '_').replace(/[^a-z0-9_]/g, '');

it('keeps trailer captures traceable and supplies preview cards at every image tier', async () => {
  const directory = 'offlineData/card-previews/baldassares-travels';
  const [manifest, previews, thumb, medium, versions, comparison] = await Promise.all([
    json(`${directory}/manifest.json`), json('src/data/provisionalCards.json'),
    json('public/assets/CardsThumbAtlas/manifest.json'),
    json('public/assets/CardsMediumAtlas/manifest.json'), json('src/data/cardImageVersions.json'),
    json(`${directory}/comparison-frames.json`),
  ]);
  expect(manifest.images).toHaveLength(54);
  expect(new Set(manifest.images.map(entry => entry.cardName)).size).toBe(47);
  expect(manifest.images.filter(entry => entry.cardName === 'Treasure')).toHaveLength(8);
  for (const capture of manifest.images) {
    const width = capture.landscape ? 1039 : 744;
    const height = capture.landscape ? 744 : 1039;
    for (const frame of [capture, ...(capture.layers ?? [])]) {
      const source = await readFile(`${directory}/${frame.source}`);
      expect(createHash('sha256').update(source).digest('hex')).toBe(frame.sourceSha256);
      expect(await sharp(source).metadata()).toMatchObject({
        width: frame.sourceSize[0], height: frame.sourceSize[1],
      });
      expect(frame.timestampSeconds).toBeGreaterThan(0);
      expect(frame.timestampSeconds).toBeLessThan(89);
      const frameUrl = new URL(comparison[frame.source], 'https://example.test');
      expect(frameUrl.pathname.startsWith('/assets/CardPreviewFrames/')).toBe(true);
      const preview = await readFile(`public${frameUrl.pathname}`);
      expect(frameUrl.searchParams.get('v')).toBe(createHash('sha256').update(preview).digest('hex').slice(0, 16));
      expect(await sharp(preview).metadata()).toMatchObject({ format: 'webp', hasAlpha: true, width, height });
    }
    for (const layer of capture.layers ?? []) {
      expect(layer.frameIndex).not.toBe(capture.frameIndex);
      expect(layer.featherPx).toBeGreaterThan(0);
      expect(layer.region.length).toBeGreaterThanOrEqual(3);
      expect(layer.region.every(([x, y]) => x >= 0 && x < width && y >= 0 && y < height)).toBe(true);
    }
    if (capture.restoredSource) {
      const restored = await readFile(`${directory}/${capture.restoredSource.path}`);
      expect(createHash('sha256').update(restored).digest('hex')).toBe(capture.restoredSource.sha256);
      expect(await sharp(restored).metadata()).toMatchObject({ width, height });
    }
    expect(await sharp(capture.output).metadata()).toMatchObject({ format: 'webp', hasAlpha: true, width, height });
  }
  for (const { card } of previews.cards) {
    const name = slug(card.name);
    const full = await readFile(`public/assets/Cards/${name}.webp`);
    expect(versions[name]).toBe(createHash('sha256').update(full).digest('hex').slice(0, 16));
    expect(thumb.cards[name]).toBeDefined();
    expect(medium.cards[name]).toBeDefined();
    expect(await sharp(`public/assets/CardsThumb/${name}.webp`).metadata()).toMatchObject({ height: 128 });
  }
  // The old official artwork must not be replaced by the trailer's smaller crop.
  expect(manifest.images.find(entry => entry.cardName === 'The White Death').output)
    .toBe('public/assets/CardPreviews/baldassares_travels/the_white_death.webp');
});

it('exports consecutive 4K source frames for all eighteen requested cards', async () => {
  const directory = 'offlineData/card-previews/baldassares-travels';
  const [archive, gallery] = await Promise.all([
    json(`${directory}/sequence-manifest.json`), json(`${directory}/comparison-sequences.json`),
  ]);
  expect(archive.video).toMatchObject({ width: 3840, height: 2160 });
  expect(archive.cards).toHaveLength(18);
  for (const card of archive.cards) {
    const exported = gallery[card.name];
    expect(exported.length).toBe(card.frames.length);
    expect(exported.length).toBeGreaterThanOrEqual(20);
    for (const [index, frame] of card.frames.entries()) {
      if (index > 0) expect(frame.frameIndex).toBe(card.frames[index - 1].frameIndex + 1);
      expect(frame.timestampSeconds).toBeCloseTo(frame.frameIndex / archive.video.framesPerSecond, 5);
      expect(exported[index].timestampSeconds).toBe(frame.timestampSeconds);
      const url = new URL(exported[index].url, 'https://example.test');
      expect(url.pathname).toBe(`/assets/CardPreviewFrames/baldassares-travels/${card.slug}/${frame.frameIndex}.webp`);
      const bytes = await readFile(`public${url.pathname}`);
      expect(url.searchParams.get('v')).toBe(createHash('sha256').update(bytes).digest('hex').slice(0, 16));
      expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'webp', hasAlpha: true,
        width: card.landscape ? 1039 : 744, height: card.landscape ? 744 : 1039,
      });
    }
  }
});

it('uses the same supplement for atlas ordering as the running app, while snapshots stay official-only', async () => {
  const official = await readCardCatalog('docs/Sorcery_CardInfo.json');
  const combined = await readCardCatalog('docs/Sorcery_CardInfo.json', { includeProvisional: true });
  expect(official.issues).toEqual([]);
  expect(combined.issues).toEqual([]);
  expect(official.cards.some(card => card.provisional)).toBe(false);
  expect(combined.cards.filter(card => card.provisional)).toHaveLength(47);
  expect(combined.cards).toHaveLength(official.cards.length + 46);
});
