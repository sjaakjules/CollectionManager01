import { describe, expect, it } from 'vitest';

import {
  buildCardNameLookup,
  convertArchiveDeckToSeedDeck,
  convertArchiveToSeedDecks,
  normalizeCardKey,
} from './build-guest-seed-decks.mjs';

const CARDS = [
  { name: 'Lightning Bolt' },
  { name: 'Coy Nixie' },
  { name: 'Troll Bridge' },
  { name: 'Druid' },
];

const NOW = '2026-07-24T00:00:00.000Z';

function buildDeckinfo() {
  return {
    id: 'abc123',
    name: 'Test Deck',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    user: { id: 'u1', username: 'Tester' },
    avatar: 'Druid',
    cards: {
      spellbook: { 'lightning  bolt': 2, 'Coy Nixie': 3 },
      atlas: { 'Troll Bridge': 3 },
      collection: { 'Lightning Bolt': 1 },
      maybe: {},
    },
  };
}

describe('normalizeCardKey', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeCardKey('  Lightning   Bolt ')).toBe('lightning bolt');
  });
});

describe('convertArchiveDeckToSeedDeck', () => {
  it('maps archive boards onto app deck boards with canonical names', () => {
    const lookup = buildCardNameLookup(CARDS);
    const { deck, warnings } = convertArchiveDeckToSeedDeck(
      'abc123',
      buildDeckinfo(),
      lookup,
      NOW,
    );

    expect(deck.id).toBe('curiosa-abc123');
    expect(deck.name).toBe('Test Deck');
    expect(deck.author).toBe('Tester');
    expect(deck.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(deck.updatedAt).toBe('2026-02-01T00:00:00.000Z');
    // Spellbook + atlas fold into mainboard, with canonicalized spellings.
    expect(deck.boards.mainboard).toEqual([
      { name: 'Lightning Bolt', quantity: 2 },
      { name: 'Coy Nixie', quantity: 3 },
      { name: 'Troll Bridge', quantity: 3 },
    ]);
    expect(deck.boards.sideboard).toEqual([{ name: 'Lightning Bolt', quantity: 1 }]);
    expect(deck.boards.maybeboard).toEqual([]);
    expect(deck.boards.avatar).toEqual([{ name: 'Druid', quantity: 1 }]);
    expect(warnings).toEqual([]);
  });

  it('keeps unknown cards verbatim and reports warnings', () => {
    const lookup = buildCardNameLookup(CARDS);
    const deckinfo = buildDeckinfo();
    deckinfo.cards.spellbook = { 'Mystery Card': 2 };
    deckinfo.avatar = 'Unknown Avatar';

    const { deck, warnings } = convertArchiveDeckToSeedDeck(
      'abc123',
      deckinfo,
      lookup,
      NOW,
    );

    expect(deck.boards.mainboard).toContainEqual({ name: 'Mystery Card', quantity: 2 });
    expect(deck.boards.avatar).toEqual([{ name: 'Unknown Avatar', quantity: 1 }]);
    expect(warnings.some((entry) => entry.includes('Mystery Card'))).toBe(true);
    expect(warnings.some((entry) => entry.includes('Unknown Avatar'))).toBe(true);
  });

  it('skips invalid quantities with a warning', () => {
    const lookup = buildCardNameLookup(CARDS);
    const deckinfo = buildDeckinfo();
    deckinfo.cards.spellbook = { 'Lightning Bolt': 0, 'Coy Nixie': 'three' };

    const { deck, warnings } = convertArchiveDeckToSeedDeck(
      'abc123',
      deckinfo,
      lookup,
      NOW,
    );

    expect(deck.boards.mainboard).toEqual([{ name: 'Troll Bridge', quantity: 3 }]);
    expect(warnings).toHaveLength(2);
  });
});

describe('convertArchiveToSeedDecks', () => {
  it('converts every archive entry and skips entries without deckinfo', () => {
    const archive = {
      abc123: { deckinfo: buildDeckinfo() },
      broken: {},
    };

    const { decks, warnings } = convertArchiveToSeedDecks(archive, CARDS, NOW);

    expect(decks.map((deck) => deck.id)).toEqual(['curiosa-abc123']);
    expect(warnings.some((entry) => entry.includes('broken'))).toBe(true);
  });
});
