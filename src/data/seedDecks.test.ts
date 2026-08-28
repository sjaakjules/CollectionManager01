import { describe, expect, it } from 'vitest';
import { createEmptyDeck, createGuestUserData } from '@/data/dataModels';
import { mergeSeedDecks } from '@/data/seedDecks';

function buildSeedDeck(id: string, name: string) {
  const deck = createEmptyDeck(name, id);
  deck.boards.mainboard.push({ name: 'Lightning Bolt', quantity: 2 });
  return deck;
}

describe('mergeSeedDecks', () => {
  it('appends seed decks missing from user data', () => {
    const guest = createGuestUserData('guest-1');
    const seeds = [
      buildSeedDeck('curiosa-abc', 'Deck A'),
      buildSeedDeck('curiosa-def', 'Deck B'),
    ];

    const result = mergeSeedDecks(guest, seeds);

    expect(result.addedDeckNames).toEqual(['Deck A', 'Deck B']);
    expect(result.userData.decks.map((deck) => deck.id)).toEqual([
      'curiosa-abc',
      'curiosa-def',
    ]);
    // Original snapshot is not mutated.
    expect(guest.decks).toEqual([]);
  });

  it('never overwrites an existing deck with the same id', () => {
    const guest = createGuestUserData('guest-1');
    const editedDeck = buildSeedDeck('curiosa-abc', 'Deck A (renamed by user)');
    editedDeck.boards.mainboard.push({ name: 'Riptide', quantity: 3 });
    guest.decks.push(editedDeck);

    const result = mergeSeedDecks(guest, [
      buildSeedDeck('curiosa-abc', 'Deck A'),
      buildSeedDeck('curiosa-def', 'Deck B'),
    ]);

    expect(result.addedDeckNames).toEqual(['Deck B']);
    const kept = result.userData.decks.find((deck) => deck.id === 'curiosa-abc');
    expect(kept?.name).toBe('Deck A (renamed by user)');
    expect(kept?.boards.mainboard).toContainEqual({ name: 'Riptide', quantity: 3 });
  });

  it('returns the same reference when nothing new is added', () => {
    const guest = createGuestUserData('guest-1');
    guest.decks.push(buildSeedDeck('curiosa-abc', 'Deck A'));

    const result = mergeSeedDecks(guest, [buildSeedDeck('curiosa-abc', 'Deck A')]);

    expect(result.addedDeckNames).toEqual([]);
    expect(result.userData).toBe(guest);
  });
});
