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

it('uses the same supplement for atlas ordering as the running app, while snapshots stay official-only', async () => {
  const official = await readCardCatalog('docs/Sorcery_CardInfo.json');
  const combined = await readCardCatalog('docs/Sorcery_CardInfo.json', { includeProvisional: true });
  expect(official.issues).toEqual([]);
  expect(combined.issues).toEqual([]);
  expect(official.cards.some(card => card.provisional)).toBe(false);
  expect(combined.cards.filter(card => card.provisional)).toHaveLength(47);
  expect(combined.cards).toHaveLength(official.cards.length + 46);
});
