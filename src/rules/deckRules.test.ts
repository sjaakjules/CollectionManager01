import { describe, expect, it } from 'vitest';
import type { Card, CardRarity, CardType } from '@/data/dataModels';
import { createEmptyDeck } from '@/data/dataModels';
import { canAddCard, validateDeck } from '@/rules/deckRules';

function card(name: string, type: CardType, rarity: CardRarity): Card {
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

describe('deck validation', () => {
  const cards = [
    card('Common Spell', 'Magic', 'Ordinary'),
    card('Unique Spell', 'Magic', 'Unique'),
    card('Avatar One', 'Avatar', 'Unique'),
    card('Avatar Two', 'Avatar', 'Unique'),
  ];

  it('reports avatar and rarity violations', () => {
    const deck = createEmptyDeck('Invalid', 'deck-1');
    deck.boards.avatar.push(
      { name: 'Avatar One', quantity: 1 },
      { name: 'Avatar Two', quantity: 1 },
    );
    deck.boards.mainboard.push({ name: 'Unique Spell', quantity: 2 });

    const result = validateDeck(deck, cards);

    expect(result.isValid).toBe(false);
    expect(result.errors.map((error) => error.type)).toEqual(
      expect.arrayContaining(['TOO_MANY_AVATARS', 'RARITY_LIMIT_EXCEEDED']),
    );
  });

  it('blocks adding copies beyond the rarity limit', () => {
    const deck = createEmptyDeck('Limit', 'deck-1');
    deck.boards.mainboard.push({ name: 'Unique Spell', quantity: 1 });

    expect(canAddCard(deck, 'Unique Spell', cards)).toMatchObject({
      allowed: false,
      reason: 'Unique cards limited to 1 copies',
    });
    expect(canAddCard(deck, 'Common Spell', cards)).toEqual({ allowed: true });
  });
});
