import { describe, expect, it } from 'vitest';
import type { Card, CardRarity, CardType, Deck } from '@/data/dataModels';
import { createEmptyDeck } from '@/data/dataModels';
import {
  exportDeckToText,
  importDeckFromText,
  importFromCuriosaDeck,
} from '@/data/importExport';

function card(name: string, type: CardType, rarity: CardRarity = 'Ordinary'): Card {
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

describe('deck import/export', () => {
  const cards = [
    card('Avatar of Fire', 'Avatar', 'Unique'),
    card('Fireball', 'Magic'),
    card('Frog', 'Minion'),
    card('Lone Tower', 'Site'),
    card('Relic', 'Artifact'),
    card('Skeleton', 'Minion'),
  ];

  it('parses Curiosa-style text, routes avatars, and reports unknown cards', () => {
    const result = importDeckFromText(
      [
        '// Mainboard',
        '1 Avatar of Fire',
        '2 Fireball',
        'Mystery Card',
        '// Sideboard',
        'Relic x 2',
      ].join('\n'),
      'Imported',
      cards,
    );

    expect(result.deck.boards.avatar).toEqual([{ name: 'Avatar of Fire', quantity: 1 }]);
    expect(result.deck.boards.mainboard).toEqual([
      { name: 'Fireball', quantity: 2 },
      { name: 'Mystery Card', quantity: 1 },
    ]);
    expect(result.deck.boards.sideboard).toEqual([{ name: 'Relic', quantity: 2 }]);
    expect(result.unknownCards).toEqual(['Mystery Card']);
  });

  it('exports boards as quantity name lines with board headers', () => {
    const deck: Deck = createEmptyDeck('Export Me', 'deck-1');
    deck.boards.avatar.push({ name: 'Avatar of Fire', quantity: 1 });
    deck.boards.mainboard.push({ name: 'Fireball', quantity: 2 });

    expect(exportDeckToText(deck)).toBe(
      ['// Avatar', '1 Avatar of Fire', '', '// Mainboard', '2 Fireball'].join('\n'),
    );
  });

  it('skips token cards during deck import', () => {
    const result = importDeckFromText(
      ['1 Frog', '1 Skeleton', '1 Foot Soldier 1', '1 Fireball'].join('\n'),
      'No Tokens',
      cards,
    );

    expect(result.deck.boards.mainboard).toEqual([
      { name: 'Fireball', quantity: 1 },
    ]);
    expect(result.warnings).toEqual([
      'Token cards cannot be added to decks: Frog',
      'Token cards cannot be added to decks: Skeleton',
      'Token cards cannot be added to decks: Foot Soldier 1',
    ]);
  });

  it('keeps unknown Curiosa cards visible in import diagnostics', () => {
    const result = importFromCuriosaDeck(
      {
        name: 'Curiosa Deck',
        author: 'Tester',
        mainboard: [
          { name: 'Missing Card', quantity: 1 },
          { name: 'Frog', quantity: 1 },
        ],
        avatar: [{ name: 'Avatar of Fire', quantity: 1 }],
        sideboard: [],
        maybeboard: [],
      },
      cards,
    );

    expect(result.unknownCards).toEqual(['Missing Card']);
    expect(result.deck.boards.mainboard).toEqual([{ name: 'Missing Card', quantity: 1 }]);
    expect(result.deck.boards.avatar).toEqual([{ name: 'Avatar of Fire', quantity: 1 }]);
    expect(result.warnings).toEqual(['Token cards cannot be added to decks: Frog']);
  });
});
