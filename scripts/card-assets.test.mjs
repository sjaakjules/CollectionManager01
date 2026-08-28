import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const PROMOS = [
  {
    name: 'Court of Equity',
    slug: 'court_of_equity',
    element: 'Earth',
    threshold: 'earth',
    artist: 'Emil Idzikowski',
  },
  {
    name: 'Mobbed Court',
    slug: 'mobbed_court',
    element: 'Fire',
    threshold: 'fire',
    artist: 'Vincent Pompetti',
  },
  {
    name: 'Mock Court',
    slug: 'mock_court',
    element: 'Air',
    threshold: 'air',
    artist: 'Franck Pawlowski',
  },
  {
    name: 'Overflowing Court',
    slug: 'overflowing_court',
    element: 'Water',
    threshold: 'water',
    artist: 'Juan Machuca',
  },
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), 'utf8'));
}

describe('promotional Court card assets', () => {
  it('keeps the bundled snapshot identical to the canonical card catalog', async () => {
    const [catalog, snapshot] = await Promise.all([
      readJson('docs/Sorcery_CardInfo.json'),
      readJson('public/assets/sorcery_cards.json'),
    ]);
    expect(snapshot).toEqual(catalog);
    expect(catalog).toHaveLength(1108);
  });

  it('contains the four official Elite Promotional Site records', async () => {
    const catalog = await readJson('docs/Sorcery_CardInfo.json');
    for (const promo of PROMOS) {
      const card = catalog.find((entry) => entry.name === promo.name);
      expect(card).toMatchObject({
        name: promo.name,
        guardian: {
          rarity: 'Elite',
          type: 'Site',
          thresholds: { [promo.threshold]: 1 },
        },
        elements: promo.element,
        sets: [{
          name: 'Promotional',
          variants: [
            { finish: 'Standard', product: 'Dust', artist: promo.artist },
            { finish: 'Foil', product: 'Dust', artist: promo.artist },
          ],
        }],
      });
    }
  });

  it('maps every source image and thumbnail into both atlas tiers', async () => {
    const [thumbManifest, mediumManifest] = await Promise.all([
      readJson('public/assets/CardsThumbAtlas/manifest.json'),
      readJson('public/assets/CardsMediumAtlas/manifest.json'),
    ]);
    expect(Object.keys(thumbManifest.cards)).toHaveLength(1108);
    expect(Object.keys(mediumManifest.cards)).toHaveLength(1108);

    for (const promo of PROMOS) {
      const sourcePath = path.join(ROOT, 'public/assets/Cards', `${promo.slug}.webp`);
      const thumbnailPath = path.join(ROOT, 'public/assets/CardsThumb', `${promo.slug}.webp`);
      await Promise.all([access(sourcePath), access(thumbnailPath)]);
      const [source, thumbnail] = await Promise.all([
        sharp(sourcePath).metadata(),
        sharp(thumbnailPath).metadata(),
      ]);
      expect(source).toMatchObject({ format: 'webp', width: 1039, height: 744 });
      expect(thumbnail.format).toBe('webp');
      expect(thumbnail.width).toBeLessThanOrEqual(128);
      expect(thumbnail.height).toBeLessThanOrEqual(128);
      expect(thumbnail.height).toBeGreaterThan(thumbnail.width);
      expect(thumbManifest.cards[promo.slug]).toBeDefined();
      expect(mediumManifest.cards[promo.slug]).toBeDefined();
    }
  });
});
