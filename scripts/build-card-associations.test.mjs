import { describe, expect, it } from 'vitest';

import {
  buildCardAssociations,
  buildCardMetadata,
  buildDeckGraph,
  buildDeckIdentityVectors,
  calculateDeckWeights,
  copySaturation,
  normalizeDeckArchive,
  runLouvainLikeClustering,
  weightedJaccard,
} from './build-card-associations.mjs';

function card(name, rarity = 'Ordinary', type = 'Magic') {
  return {
    name,
    guardian: {
      rarity,
      type,
      rulesText: '',
      cost: 0,
      attack: null,
      defence: null,
      life: null,
      thresholds: { air: 0, earth: 0, fire: 0, water: 0 },
    },
    elements: '',
    subTypes: '',
    sets: [],
  };
}

function deck(id, { avatar = 'Avatar A', spellbook = {}, atlas = {}, collection = {}, maybe = {} }) {
  return {
    deckinfo: {
      id,
      name: `Deck ${id}`,
      avatar,
      cards: { spellbook, atlas, collection, maybe },
    },
  };
}

describe('card association archive normalization', () => {
  it('folds avatar into main, keeps collection separate, and ignores maybe', () => {
    const decks = normalizeDeckArchive({
      d1: deck('d1', {
        avatar: 'Avatar A',
        spellbook: { 'Lava Flow': 2 },
        atlas: { Oasis: 1 },
        collection: { 'Lava Flow': 1, Boil: 1 },
        maybe: { 'Maybe Card': 1 },
      }),
    });

    expect(decks).toHaveLength(1);
    expect([...decks[0].main.keys()].sort()).toEqual(['Avatar A', 'Lava Flow', 'Oasis']);
    expect([...decks[0].collection.keys()].sort()).toEqual(['Boil', 'Lava Flow']);
    expect(decks[0].main.has('Maybe Card')).toBe(false);
    expect(decks[0].collection.has('Maybe Card')).toBe(false);
  });
});

describe('card association vector math', () => {
  it('uses rarity-normalized copy saturation', () => {
    expect(copySaturation(4, 4)).toBe(1);
    expect(copySaturation(2, 4)).toBe(0.5);
    expect(copySaturation(1, 1)).toBe(1);
  });

  it('calculates weighted Jaccard from min over max', () => {
    const left = new Map([
      ['A', 1],
      ['B', 0.5],
    ]);
    const right = new Map([
      ['A', 0.5],
      ['C', 1],
    ]);

    expect(weightedJaccard(left, right)).toBeCloseTo(0.5 / 2.5);
  });
});

describe('card association clustering', () => {
  it('connects similar decks and applies cluster-balanced weights', () => {
    const archive = {
      d1: deck('d1', { spellbook: { A: 4, B: 4 }, atlas: { Site: 1 } }),
      d2: deck('d2', { spellbook: { A: 4, B: 3 }, atlas: { Site: 1 } }),
      d3: deck('d3', { spellbook: { C: 4 }, atlas: { Other: 1 } }),
    };
    const metadata = buildCardMetadata([
      card('A'),
      card('B'),
      card('C'),
      card('Site', 'Ordinary', 'Site'),
      card('Other', 'Ordinary', 'Site'),
    ]);
    const decks = normalizeDeckArchive(archive);
    const vectors = buildDeckIdentityVectors(decks, metadata);
    const graph = buildDeckGraph(vectors, {
      similarityThreshold: 0.5,
      weights: { spellbook: 0.75, atlas: 0.15, collection: 0.05, avatar: 0.05 },
    });
    const clusters = runLouvainLikeClustering(graph);
    const weights = calculateDeckWeights(clusters);

    expect(graph[0].has(1)).toBe(true);
    expect(clusters[0]).toBe(clusters[1]);
    expect(clusters[2]).not.toBe(clusters[0]);
    expect(weights[0]).toBeCloseTo(1 / Math.sqrt(2));
    expect(weights[2]).toBeCloseTo(1);
  });
});

describe('card association links', () => {
  it('stores one node with separate main and collection channel evidence', () => {
    const archive = {
      d1: deck('d1', {
        avatar: 'Avatar A',
        spellbook: { 'Lava Flow': 2, Riptide: 4 },
        atlas: { Oasis: 1 },
        collection: { 'Lava Flow': 1, Boil: 1 },
      }),
      d2: deck('d2', {
        avatar: 'Avatar A',
        spellbook: { 'Lava Flow': 1, Riptide: 4 },
        atlas: { Oasis: 1 },
        collection: { Boil: 1 },
      }),
      d3: deck('d3', {
        avatar: 'Avatar B',
        spellbook: { Riptide: 4 },
        atlas: { Oasis: 1 },
        collection: { Boil: 1 },
      }),
    };
    const cards = [
      card('Avatar A', 'Unique', 'Avatar'),
      card('Avatar B', 'Unique', 'Avatar'),
      card('Lava Flow'),
      card('Riptide'),
      card('Oasis', 'Ordinary', 'Site'),
      card('Boil'),
    ];

    const result = buildCardAssociations(archive, cards, {
      topLinks: 10,
      minEvidence: 1,
      similarityThreshold: 0.1,
    });
    const lavaLinks = result.index['Lava Flow'];
    const riptide = lavaLinks.find((link) => link.to === 'Riptide');
    const boil = lavaLinks.find((link) => link.to === 'Boil');

    expect(result.__meta.collectionNodeNames).toContain('Lava Flow');
    expect(lavaLinks).toBeDefined();
    expect(riptide?.mainMain).toBeDefined();
    expect(boil?.mainCollection).toBeDefined();
    expect(lavaLinks.some((link) => link.to === 'Lava Flow')).toBe(false);
  });

  it('rewards confidence, lift, and evidence in the display score', () => {
    const archive = {
      d1: deck('d1', { spellbook: { A: 1, B: 1 }, atlas: {} }),
      d2: deck('d2', { spellbook: { A: 1, B: 1 }, atlas: {} }),
      d3: deck('d3', { spellbook: { A: 1, B: 1 }, atlas: {} }),
      d4: deck('d4', { spellbook: { A: 1, C: 1 }, atlas: {} }),
      d5: deck('d5', { spellbook: { C: 1 }, atlas: {} }),
      d6: deck('d6', { spellbook: { C: 1 }, atlas: {} }),
    };
    const cards = [card('A'), card('B'), card('C')];
    const result = buildCardAssociations(archive, cards, {
      topLinks: 10,
      minEvidence: 1,
      similarityThreshold: 1,
    });
    const links = result.index.A;
    const strong = links.find((link) => link.to === 'B')?.mainMain;
    const weaker = links.find((link) => link.to === 'C')?.mainMain;

    expect(strong?.confidence).toBeGreaterThan(weaker?.confidence ?? 0);
    expect(strong?.lift).toBeGreaterThan(1);
    expect(strong?.score).toBeGreaterThan(weaker?.score ?? 0);
  });
});
