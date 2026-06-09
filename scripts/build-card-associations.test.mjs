import { describe, expect, it } from 'vitest';

import {
  associationNodeId,
  blendAssociationScore,
  buildCardAssociations,
  buildCardMetadata,
  buildDeckGraph,
  buildDeckIdentityVectors,
  buildPackageMatrix,
  buildPackageModel,
  calculateDeckWeights,
  canonicalizeAssociationName,
  compareAssociationLinks,
  copySaturation,
  DEFAULT_PACKAGE_OPTIONS,
  filterSkippedArchiveDecks,
  getVisibleAssociationScore,
  mergePackageEvidenceIntoIndex,
  mergeArchives,
  normalizeDeckArchive,
  parseArgs,
  runDeterministicNmf,
  runGraphologyLouvainClustering,
  runGreedyModularityClustering,
  scoreSharedPackages,
  weightedJaccard,
} from './build-card-associations.mjs';

function card(name, rarity = 'Ordinary', type = 'Magic', elements = '') {
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
    elements,
    subTypes: '',
    sets: [],
  };
}

function countCards(board) {
  return Object.values(board).reduce((sum, quantity) => sum + quantity, 0);
}

function deck(
  id,
  {
    avatar = 'Avatar A',
    spellbook = {},
    atlas = {},
    collection = {},
    maybe = {},
    format = 'Constructed',
    elements = [],
  },
) {
  return {
    deckinfo: {
      id,
      name: `Deck ${id}`,
      avatar,
      format,
      elements,
      cardCount: {
        spellbook: countCards(spellbook),
        atlas: countCards(atlas),
        collection: countCards(collection),
        maybe: countCards(maybe),
      },
      cards: { spellbook, atlas, collection, maybe },
    },
  };
}

function testOptions(extra = {}) {
  return {
    topLinks: 10,
    minEvidence: 0,
    similarityThreshold: 1,
    filters: {
      constructedOnly: false,
      fullDecksOnly: false,
      includeSkipped: false,
    },
    ...extra,
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
    expect([...decks[0].main.keys()].sort()).toEqual([
      'avatar:avatar-a',
      'card:lava-flow',
      'card:oasis',
    ]);
    expect([...decks[0].collection.keys()].sort()).toEqual([
      'card:boil',
      'card:lava-flow',
    ]);
    expect(decks[0].main.has('card:maybe-card')).toBe(false);
    expect(decks[0].collection.has('card:maybe-card')).toBe(false);
  });

  it('filters skipped decks by minimum spellbook and atlas counts', () => {
    const skipped = {
      keep: {
        status: 'skipped-invalid',
        deckinfo: deck('keep', {
          spellbook: { A: 50 },
          atlas: { Site: 20 },
        }).deckinfo,
      },
      lowSpells: {
        status: 'skipped-invalid',
        deckinfo: deck('lowSpells', {
          spellbook: { A: 49 },
          atlas: { Site: 20 },
        }).deckinfo,
      },
      noDeckinfo: {
        status: 'failed',
      },
    };

    const result = filterSkippedArchiveDecks(skipped, {
      minSpellbook: 50,
      minAtlas: 20,
    });

    expect(Object.keys(result.archive)).toEqual(['keep']);
    expect(result.summary).toMatchObject({
      total: 3,
      accepted: 1,
      belowMinimum: 1,
      missingDeckinfo: 1,
    });
  });

  it('merges skipped decks without replacing main archive decks', () => {
    const main = {
      shared: deck('shared', { spellbook: { Main: 1 }, atlas: { Site: 1 } }),
    };
    const skipped = {
      shared: deck('shared', { spellbook: { Skipped: 1 }, atlas: { Site: 1 } }),
      skippedOnly: deck('skippedOnly', { spellbook: { Skipped: 1 }, atlas: { Site: 1 } }),
    };

    const merged = mergeArchives(main, skipped);

    expect(merged.shared.deckinfo.cards.spellbook).toEqual({ Main: 1 });
    expect(merged.skippedOnly.deckinfo.cards.spellbook).toEqual({ Skipped: 1 });
  });
});

describe('card association CLI args', () => {
  it('defaults to offlineData and enables skipped loading through min flags', () => {
    const options = parseArgs(['--min-spells', '50', '--min-atlas', '20']);

    expect(options.archive).toBe('offlineData/deckArchive.json');
    expect(options.includeSkipped).toBe(true);
    expect(options.outputBase).toBe('public/assets/sorcery_card_associations');
    expect(options.minSkippedSpellbook).toBe(50);
    expect(options.minSkippedAtlas).toBe(20);
  });

  it('parses package model flags', () => {
    const options = parseArgs([
      '--packages',
      '12',
      '--package-iterations',
      '25',
      '--package-seed',
      '42',
      '--package-min-card-strength',
      '0.2',
      '--package-min-membership',
      '0.1',
      '--package-max-nodes',
      '18',
      '--package-max-packages-per-node',
      '3',
      '--package-boost-weight',
      '0.4',
    ]);

    expect(options.associationOptions.packageOptions).toMatchObject({
      enabled: true,
      components: 12,
      iterations: 25,
      seed: 42,
      minNodeStrength: 0.2,
      minDeckMembership: 0.1,
      maxNodesPerPackage: 18,
      maxPackagesPerNode: 3,
      packageBoostWeight: 0.4,
    });

    expect(parseArgs(['--no-packages']).associationOptions.packageOptions.enabled).toBe(false);
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
      ['card:a', 1],
      ['card:b', 0.5],
    ]);
    const right = new Map([
      ['card:a', 0.5],
      ['card:c', 1],
    ]);

    expect(weightedJaccard(left, right)).toBeCloseTo(0.5 / 2.5);
  });

  it('builds a main-only weighted package matrix', () => {
    const archive = {
      d1: deck('d1', {
        avatar: 'Avatar A',
        spellbook: { A: 2, Unique: 1 },
        atlas: { Site: 1 },
        collection: { Sideboard: 4 },
        maybe: { Maybe: 4 },
      }),
    };
    const cards = [
      card('Avatar A', 'Unique', 'Avatar'),
      card('A'),
      card('Unique', 'Unique'),
      card('Site', 'Ordinary', 'Site'),
      card('Sideboard'),
      card('Maybe'),
    ];
    const metadata = buildCardMetadata(cards);
    const decks = normalizeDeckArchive(archive);
    const matrix = buildPackageMatrix(decks, [4], metadata, DEFAULT_PACKAGE_OPTIONS);
    const row = Object.fromEntries(matrix.nodeIds.map((nodeId, index) => [nodeId, matrix.matrix[0][index]]));

    expect(matrix.nodeIds).toEqual([
      'avatar:avatar-a',
      'card:a',
      'card:site',
      'card:unique',
    ]);
    expect(row['avatar:avatar-a']).toBeCloseTo(1.5);
    expect(row['card:a']).toBeCloseTo(1);
    expect(row['card:site']).toBeCloseTo(0.5);
    expect(row['card:unique']).toBeCloseTo(2);
    expect(row['card:sideboard']).toBeUndefined();
    expect(row['card:maybe']).toBeUndefined();
  });

  it('runs deterministic NMF with stable dimensions and seed output', () => {
    const matrix = [
      [1, 0.8, 0, 0],
      [0.9, 1, 0, 0],
      [0, 0, 1, 0.9],
    ];
    const options = { ...DEFAULT_PACKAGE_OPTIONS, components: 2, iterations: 20, seed: 7 };
    const first = runDeterministicNmf(matrix, options);
    const second = runDeterministicNmf(matrix, options);

    expect(first.W).toHaveLength(3);
    expect(first.W[0]).toHaveLength(2);
    expect(first.H).toHaveLength(2);
    expect(first.H[0]).toHaveLength(4);
    expect(first.reconstructionError).toBeGreaterThanOrEqual(0);
    expect(second.W).toEqual(first.W);
    expect(second.H).toEqual(first.H);
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
      weights: { spellbook: 0.75, atlas: 0.2, collection: 0, avatar: 0.05 },
    });
    const clusters = runGreedyModularityClustering(graph);
    const weights = calculateDeckWeights(clusters);

    expect(graph[0].has(1)).toBe(true);
    expect(clusters[0]).toBe(clusters[1]);
    expect(clusters[2]).not.toBe(clusters[0]);
    expect(weights[0]).toBeCloseTo(1 / Math.sqrt(2));
    expect(weights[2]).toBeCloseTo(1);
  });

  it('runs deterministic graphology Louvain with detailed dendrogram output', () => {
    const graph = [
      new Map([[1, 1]]),
      new Map([
        [0, 1],
        [2, 0.1],
      ]),
      new Map([
        [1, 0.1],
        [3, 1],
      ]),
      new Map([[2, 1]]),
    ];

    const result = runGraphologyLouvainClustering(graph);

    expect(result.algorithm).toBe('graphology-louvain');
    expect(result.clusterIds).toHaveLength(4);
    expect(result.dendrogram).toBeTruthy();
    expect(result.level).toBeGreaterThanOrEqual(1);
  });
});

describe('card association nodes', () => {
  it('canonicalizes accents, case, punctuation, and spacing', () => {
    expect(canonicalizeAssociationName(" Café's---King!! ")).toBe('cafes-king');
    expect(associationNodeId('card', "CAFÉ'S King")).toBe('card:cafes-king');
  });

  it('keeps cards and avatars with the same display name as separate nodes', () => {
    const result = buildCardAssociations(
      {
        d1: deck('d1', {
          avatar: 'Merlin',
          spellbook: { Merlin: 1, A: 1 },
          atlas: {},
        }),
        d2: deck('d2', {
          avatar: 'Avatar B',
          spellbook: { B: 1 },
          atlas: {},
        }),
      },
      [card('Merlin'), card('Merlin', 'Unique', 'Avatar'), card('A'), card('B')],
      testOptions(),
    );

    expect(result.nodes['card:merlin']).toMatchObject({ kind: 'card', displayName: 'Merlin' });
    expect(result.nodes['avatar:merlin']).toMatchObject({
      kind: 'avatar',
      displayName: 'Merlin',
    });
  });

  it('collapses canonical display variants into one card node', () => {
    const result = buildCardAssociations(
      {
        d1: deck('d1', {
          spellbook: { "Café's King": 1 },
          atlas: { 'CAFES KING': 1 },
        }),
      },
      [card("Café's King"), card('CAFES KING', 'Ordinary', 'Site')],
      testOptions(),
    );

    expect(result.nodes['card:cafes-king']).toBeDefined();
    expect(Object.keys(result.nodes).filter((nodeId) => nodeId === 'card:cafes-king')).toHaveLength(1);
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
      d4: deck('d4', {
        avatar: 'Avatar C',
        spellbook: { Other: 1 },
        atlas: {},
        collection: {},
      }),
    };
    const cards = [
      card('Avatar A', 'Unique', 'Avatar'),
      card('Avatar B', 'Unique', 'Avatar'),
      card('Lava Flow'),
      card('Riptide'),
      card('Oasis', 'Ordinary', 'Site'),
      card('Boil'),
      card('Other'),
    ];

    const result = buildCardAssociations(archive, cards, testOptions({ similarityThreshold: 0.1 }));
    const lavaLinks = result.index['card:lava-flow'];
    const riptide = lavaLinks.find((link) => link.to === 'card:riptide');
    const boil = lavaLinks.find((link) => link.to === 'card:boil');

    expect(result.__meta.collectionNodeIds).toContain('card:lava-flow');
    expect(lavaLinks).toBeDefined();
    expect(riptide?.mainMain).toBeDefined();
    expect(boil?.mainCollection?.mainToCollection).toBeDefined();
    expect(lavaLinks.some((link) => link.to === 'card:lava-flow')).toBe(false);
  });

  it('adds directional collection to main evidence', () => {
    const result = buildCardAssociations(
      {
        d1: deck('d1', {
          spellbook: { MainA: 1 },
          atlas: {},
          collection: { Source: 1 },
        }),
        d2: deck('d2', {
          spellbook: { MainB: 1 },
          atlas: {},
          collection: {},
        }),
      },
      [card('Source'), card('MainA'), card('MainB')],
      testOptions(),
    );

    const link = result.index['card:source'].find((entry) => entry.to === 'card:maina');

    expect(link?.mainCollection?.collectionToMain).toBeDefined();
  });

  it('keeps directional probabilities asymmetric', () => {
    const result = buildCardAssociations(
      {
        d1: deck('d1', { spellbook: { A: 1, B: 1 }, atlas: {} }),
        d2: deck('d2', { spellbook: { A: 1, C: 1 }, atlas: {} }),
        d3: deck('d3', { spellbook: { D: 1 }, atlas: {} }),
      },
      [card('A'), card('B'), card('C'), card('D')],
      testOptions(),
    );

    const aToB = result.index['card:a'].find((entry) => entry.to === 'card:b')?.mainMain;
    const bToA = result.index['card:b'].find((entry) => entry.to === 'card:a')?.mainMain;

    expect(aToB?.confidence).toBeCloseTo(0.5);
    expect(bToA?.confidence).toBeCloseTo(1);
  });

  it('does not highlight neutral or negative lift', () => {
    const result = buildCardAssociations(
      {
        d1: deck('d1', { spellbook: { A: 1, B: 1 }, atlas: {} }),
        d2: deck('d2', { spellbook: { A: 1, B: 1 }, atlas: {} }),
      },
      [card('A'), card('B')],
      testOptions({ packageOptions: { ...DEFAULT_PACKAGE_OPTIONS, enabled: false } }),
    );

    expect(result.index['card:a']).toBeUndefined();
  });

  it('uses balanced and meta deck weights by mode', () => {
    const archive = {
      d1: deck('d1', { spellbook: { A: 1, B: 1 }, atlas: {} }),
      d2: deck('d2', { spellbook: { A: 1, B: 1 }, atlas: {} }),
      d3: deck('d3', { spellbook: { C: 1 }, atlas: {} }),
    };
    const cards = [card('A'), card('B'), card('C')];
    const options = testOptions({ similarityThreshold: 0.5 });
    const balanced = buildCardAssociations(archive, cards, { ...options, mode: 'balanced' });
    const meta = buildCardAssociations(archive, cards, { ...options, mode: 'meta' });
    const balancedStats = balanced.index['card:a'].find((entry) => entry.to === 'card:b')?.mainMain;
    const metaStats = meta.index['card:a'].find((entry) => entry.to === 'card:b')?.mainMain;

    expect(balancedStats?.coCount).toBeCloseTo(Math.sqrt(2), 4);
    expect(metaStats?.coCount).toBe(2);
    expect(balanced.__meta.mode).toBe('balanced');
    expect(meta.__meta.mode).toBe('meta');
  });

  it('builds cluster card profiles with likelihood scores', () => {
    const result = buildCardAssociations(
      {
        d1: deck('d1', { spellbook: { A: 1, B: 1 }, atlas: {} }),
        d2: deck('d2', { spellbook: { A: 1, C: 1 }, atlas: {} }),
        d3: deck('d3', { spellbook: { D: 1 }, atlas: {} }),
      },
      [card('A'), card('B'), card('C'), card('D')],
      testOptions({ similarityThreshold: 0.1, mode: 'meta' }),
    );
    const cluster = Object.values(result.clusters).find((entry) =>
      entry.deckIds.includes('d1') && entry.deckIds.includes('d2'),
    );

    expect(cluster?.cards['card:a']?.score).toBe(100);
    expect(cluster?.cards['card:b']?.score).toBe(50);
    expect(cluster?.cards['card:c']?.score).toBe(50);
    expect(cluster?.avatarIds).toEqual(['avatar:avatar-a']);
  });

  it('names single-avatar clusters from avatar and dominant elements', () => {
    const result = buildCardAssociations(
      {
        d1: deck('d1', {
          avatar: 'Deathspeaker',
          spellbook: { FireCard: 2, EarthCard: 1 },
          atlas: {},
        }),
        d2: deck('d2', {
          avatar: 'Deathspeaker',
          spellbook: { FireCard: 1, EarthCard: 2 },
          atlas: {},
        }),
      },
      [
        card('Deathspeaker', 'Unique', 'Avatar'),
        card('FireCard', 'Ordinary', 'Magic', 'Fire'),
        card('EarthCard', 'Ordinary', 'Magic', 'Earth'),
      ],
      testOptions({ similarityThreshold: 0.1, mode: 'meta' }),
    );
    const cluster = Object.values(result.clusters).find((entry) =>
      entry.deckIds.includes('d1') && entry.deckIds.includes('d2'),
    );

    expect(cluster?.label).toBe('Deathspeaker - 🜃/🜂');
  });

  it('keeps mixed-avatar cluster labels generic', () => {
    const result = buildCardAssociations(
      {
        d1: deck('d1', {
          avatar: 'Avatar A',
          spellbook: { Shared: 1 },
          atlas: {},
          elements: ['Fire'],
        }),
        d2: deck('d2', {
          avatar: 'Avatar B',
          spellbook: { Shared: 1 },
          atlas: {},
          elements: ['Fire'],
        }),
      },
      [
        card('Avatar A', 'Unique', 'Avatar'),
        card('Avatar B', 'Unique', 'Avatar'),
        card('Shared', 'Ordinary', 'Magic', 'Fire'),
      ],
      testOptions({ similarityThreshold: 0.1, mode: 'meta' }),
    );
    const cluster = Object.values(result.clusters).find((entry) =>
      entry.deckIds.includes('d1') && entry.deckIds.includes('d2'),
    );

    expect(cluster?.label).toMatch(/^Cluster \d+$/u);
    expect(cluster?.avatarIds).toEqual(['avatar:avatar-a', 'avatar:avatar-b']);
  });

  it('shortens elemental avatar names and avoids duplicate element labels', () => {
    const result = buildCardAssociations(
      {
        d1: deck('d1', {
          avatar: 'Avatar of Air',
          spellbook: { AirCard: 1 },
          atlas: {},
        }),
      },
      [card('Avatar of Air', 'Unique', 'Avatar'), card('AirCard', 'Ordinary', 'Magic', 'Air')],
      testOptions({ mode: 'meta' }),
    );
    const cluster = Object.values(result.clusters).find((entry) => entry.deckIds.includes('d1'));

    expect(cluster?.label).toBe('🜁');
  });

  it('has one node and no self-link when a card appears in main and collection', () => {
    const result = buildCardAssociations(
      {
        d1: deck('d1', {
          spellbook: { A: 1 },
          atlas: {},
          collection: { A: 1 },
        }),
        d2: deck('d2', { spellbook: { B: 1 }, atlas: {} }),
      },
      [card('A'), card('B')],
      testOptions(),
    );

    expect(result.nodes['card:a']).toBeDefined();
    expect(result.index['card:a']?.some((entry) => entry.to === 'card:a') ?? false).toBe(false);
  });

  it('sorts top links by score, evidence, confidence, lift, display name, and node ID', () => {
    const nodes = new Map([
      ['card:a', { displayName: 'Alpha' }],
      ['card:b', { displayName: 'Beta' }],
      ['card:c', { displayName: 'Beta' }],
    ]);
    const links = [
      { to: 'card:c', mainMain: { score: 10, coCount: 1, confidence: 0.5, lift: 2 } },
      { to: 'card:b', mainMain: { score: 10, coCount: 1, confidence: 0.5, lift: 2 } },
      { to: 'card:a', mainMain: { score: 10, coCount: 2, confidence: 0.4, lift: 2 } },
    ];

    links.sort((left, right) => compareAssociationLinks(left, right, nodes));

    expect(links.map((link) => link.to)).toEqual(['card:a', 'card:b', 'card:c']);
  });
});

describe('card association package model', () => {
  it('serializes NMF packages, deck memberships, and card memberships', () => {
    const archive = {
      fire1: deck('fire1', { avatar: '', spellbook: { AggroA: 4, AggroB: 4, Shared: 1 }, atlas: {} }),
      fire2: deck('fire2', { avatar: '', spellbook: { AggroA: 4, AggroB: 4, Shared: 1 }, atlas: {} }),
      water1: deck('water1', { avatar: '', spellbook: { ControlA: 4, ControlB: 4, Shared: 1 }, atlas: {} }),
      water2: deck('water2', { avatar: '', spellbook: { ControlA: 4, ControlB: 4, Shared: 1 }, atlas: {} }),
      hybrid: deck('hybrid', {
        avatar: '',
        spellbook: { AggroA: 4, AggroB: 4, ControlA: 4, ControlB: 4, Shared: 1 },
        atlas: {},
      }),
    };
    const cards = [
      card('AggroA'),
      card('AggroB'),
      card('ControlA'),
      card('ControlB'),
      card('Shared', 'Unique'),
    ];
    const nodes = new Map(cards.map((entry) => [associationNodeId('card', entry.name), {
      id: associationNodeId('card', entry.name),
      kind: 'card',
      displayName: entry.name,
      canonicalName: entry.name.toLowerCase(),
    }]));
    const metadata = buildCardMetadata(cards);
    const decks = normalizeDeckArchive(archive);
    const packageModel = buildPackageModel({
      decks,
      deckWeights: decks.map(() => 1),
      nodes,
      metadata,
      packageOptions: {
        ...DEFAULT_PACKAGE_OPTIONS,
        components: 2,
        iterations: 80,
        minCardPackageStrength: 0.05,
        minDeckMembership: 0.05,
      },
    });

    expect(packageModel.packages).toHaveLength(2);
    expect(packageModel.packages[0].topNodes.length).toBeGreaterThan(0);
    expect(packageModel.deckPackages.hybrid.length).toBeGreaterThanOrEqual(2);
    expect(packageModel.cardPackages['card:shared'].length).toBeGreaterThanOrEqual(1);
    expect(packageModel.meta).toMatchObject({
      components: 2,
      deckCount: 5,
      generatedPackageCount: 2,
    });
  });

  it('scores shared packages and blends package-only candidates into link sorting', () => {
    const packageModel = {
      packages: [
        {
          id: 'pkg-01',
          label: 'A / C',
          topNodes: [
            { nodeId: 'card:a', weight: 1, displayName: 'A' },
            { nodeId: 'card:c', weight: 0.8, displayName: 'C' },
          ],
          exampleDecks: [],
          supportDeckCount: 6,
          weightedSupport: 6,
          maxMembership: 1,
        },
      ],
      cardPackages: {
        'card:a': [{ packageId: 'pkg-01', strength: 1, packageLabel: 'A / C' }],
        'card:c': [{ packageId: 'pkg-01', strength: 0.8, packageLabel: 'A / C' }],
      },
      deckPackages: {},
    };
    const index = new Map([
      [
        'card:a',
        new Map([
          [
            'card:b',
            {
              to: 'card:b',
              mainMain: {
                score: 90,
                confidence: 1,
                lift: 2,
                coCount: 4,
              },
            },
          ],
        ]),
      ],
    ]);
    const packageById = new Map(packageModel.packages.map((pkg) => [pkg.id, pkg]));
    const score = scoreSharedPackages(
      packageModel.cardPackages['card:a'],
      packageModel.cardPackages['card:c'],
      packageById,
      DEFAULT_PACKAGE_OPTIONS,
    );

    mergePackageEvidenceIntoIndex(index, packageModel, DEFAULT_PACKAGE_OPTIONS);

    const packageOnly = index.get('card:a').get('card:c');
    expect(score.score).toBeGreaterThan(0);
    expect(blendAssociationScore(15, 80, 0.3)).toBe(37);
    expect(blendAssociationScore(90, 10, 0.3)).toBe(90);
    expect(packageOnly.packages.score).toBeGreaterThan(0);
    expect(packageOnly.mainMain).toBeUndefined();
    expect(getVisibleAssociationScore(packageOnly)).toBe(packageOnly.packages.blendedMainScore);
  });

  it('generates package fields in the association asset shape', () => {
    const result = buildCardAssociations(
      {
        d1: deck('d1', { avatar: '', spellbook: { A: 4, B: 4 }, atlas: {} }),
        d2: deck('d2', { avatar: '', spellbook: { A: 4, C: 4 }, atlas: {} }),
        d3: deck('d3', { avatar: '', spellbook: { D: 4, E: 4 }, atlas: {} }),
      },
      [card('A'), card('B'), card('C'), card('D'), card('E')],
      testOptions({
        packageOptions: {
          ...DEFAULT_PACKAGE_OPTIONS,
          components: 2,
          iterations: 30,
        },
      }),
    );

    expect(result.__meta.version).toBe(4);
    expect(result.__meta.packageModel).toMatchObject({
      enabled: true,
      components: 2,
      generatedPackageCount: 2,
    });
    expect(result.packages).toHaveLength(2);
    expect(Object.keys(result.cardPackages).length).toBeGreaterThan(0);
    expect(Object.keys(result.deckPackages).length).toBeGreaterThan(0);
  });
});

describe('card association source filters and metadata', () => {
  it('records accepted and skipped source deck counts with default filters', () => {
    const result = buildCardAssociations(
      {
        full: deck('full', {
          spellbook: { A: 60 },
          atlas: { Site: 30 },
          format: 'Constructed',
        }),
        draft: deck('draft', {
          spellbook: { A: 60 },
          atlas: { Site: 30 },
          format: 'Draft',
        }),
        partial: deck('partial', {
          spellbook: { A: 59 },
          atlas: { Site: 30 },
          format: 'Constructed',
        }),
      },
      [card('A'), card('Site', 'Ordinary', 'Site')],
      { topLinks: 5, minEvidence: 0, similarityThreshold: 1 },
    );

    expect(result.__meta.sourceDeckCount).toBe(3);
    expect(result.__meta.acceptedDeckCount).toBe(1);
    expect(result.__meta.skippedDeckCount).toBe(2);
    expect(result.__meta.filters).toEqual({
      constructedOnly: true,
      fullDecksOnly: true,
      includeSkipped: false,
    });
  });
});
