import { describe, expect, it } from 'vitest';
import { createEmptyDeck, createGuestUserData, type Deck } from './dataModels';
import { appReducer, initialAppState } from '@/app/AppState';
import { mergeUserData } from './userSync';

function deck(id: string, origin?: Deck['origin']): Deck {
  return { ...createEmptyDeck(id, id), origin };
}

describe('personal deck provenance', () => {
  it('marks a re-import without duplicating the deck or replacing local edits', () => {
    const edited = { ...deck('remote', 'lookup'), name: 'My edited deck' };
    const state = { ...initialAppState, userData: { ...createGuestUserData('g'), decks: [edited] } };
    const result = appReducer(state, { type: 'CREATE_DECK', deck: deck('remote', 'user') });
    expect(result.userData?.decks).toEqual([{ ...edited, origin: 'user' }]);
    if (!result.userData) throw new Error('Missing user data');
    const hydrated = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: result.userData });
    expect(hydrated.userData?.decks[0]?.origin).toBe('user');
  });

  it('preserves a guest manual import when merging a server copy of the same deck', () => {
    const local = { ...createGuestUserData('g'), decks: [deck('same', 'user')] };
    const server = { ...createGuestUserData('account'), decks: [{ ...deck('same', 'lookup'), name: 'Server edits' }] };
    expect(mergeUserData(local, server).decks).toEqual([{ ...server.decks[0], origin: 'user' }]);
  });
});
