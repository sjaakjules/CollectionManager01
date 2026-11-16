import { readFile, readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { expect, it } from 'vitest';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const slug = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/'/g, '').replace(/[-\s]+/g, '_').replace(/[^a-z0-9_]/g, '');

it('ships every new photo card through all existing image tiers within their size budgets', async () => {
  const [catalog, photos, thumbnail, medium, sourceFiles] = await Promise.all([
    readJson('offlineData/card-photos/2026-11-13/transcriptions.json'),
    Promise.all([4, 5, 6, 7].map((number) =>
      readJson(`offlineData/card-photos/2026-11-13/batch-2/photo-${number}.json`))),
    readJson('public/assets/CardsThumbAtlas/manifest.json'),
    readJson('public/assets/CardsMediumAtlas/manifest.json'),
    readdir('public/assets/Cards'),
  ]);
  const photographed = photos.flatMap((photo) => photo.cards);
  expect(photographed).toHaveLength(71);
  expect(photographed.map((card) => card.name).sort())
    .toEqual(catalog.cards.map((entry) => entry.card.name).sort());
  const sourceSlugs = sourceFiles.filter((file) => file.endsWith('.webp')).map((file) => file.slice(0, -5)).sort();
  expect(Object.keys(thumbnail.cards).sort()).toEqual(sourceSlugs);
  expect(Object.keys(medium.cards).sort()).toEqual(sourceSlugs);
  for (const { card } of catalog.cards) {
    const name = slug(card.name);
    const full = await sharp(`public/assets/Cards/${name}.webp`).metadata();
    expect(full.hasAlpha).toBe(true);
    expect(full).toMatchObject(card.guardian.type === 'Site'
      ? { format: 'webp', width: 1039, height: 744 }
      : { format: 'webp', width: 744, height: 1039 });
    const thumb = await sharp(`public/assets/CardsThumb/${name}.webp`).metadata();
    expect(thumb.height).toBeLessThanOrEqual(128);
    expect(thumb.width).toBeLessThan(thumb.height);
    expect(thumbnail.cards[name]).toBeDefined();
    expect(medium.cards[name]).toBeDefined();
  }
  for (const [directory, width, height] of [['CardsThumbAtlas', 1024, 1024], ['CardsMediumAtlas', 1112, 1160]]) {
    const pages = (await readdir(`public/assets/${directory}`)).filter((file) => file.endsWith('.webp'));
    for (const page of pages) {
      const image = await sharp(`public/assets/${directory}/${page}`).metadata();
      expect(image.width).toBeLessThanOrEqual(width);
      expect(image.height).toBeLessThanOrEqual(height);
    }
  }
});
