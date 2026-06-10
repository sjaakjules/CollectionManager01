/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGuestUserData, type UserData } from '@/data/dataModels';
import { loadUserData, saveUserData } from '@/data/userStorage';

describe('userStorage', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    localStorage.clear();
  });

  it('creates guest data with the clean guest schema', () => {
    const guest = createGuestUserData('guest-1');

    expect(guest.name).toBe('Guest');
    expect(guest.canvasAreas).toEqual([]);
    expect(Object.keys(guest).sort()).toEqual([
      'canvasAreas',
      'canvasLabels',
      'collection',
      'decks',
      'favouriteDeckIds',
      'id',
      'name',
      'selectedCardCategory',
    ]);
  });

  it('saves and loads guest and account data under separate local keys', async () => {
    const guest = {
      ...createGuestUserData('guest-1'),
      canvasAreas: [
        {
          id: 'stack-1',
          name: 'Guest Stack',
          type: 'stack',
          pinned: true,
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          cards: [],
        },
      ],
    } satisfies UserData;
    const account = {
      ...guest,
      id: 'user-1',
      name: 'Alice',
      canvasAreas: [
        {
          id: 'deck-1',
          name: 'Account Deck',
          type: 'deck',
          pinned: true,
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          cards: [],
        },
      ],
    } satisfies UserData;

    await saveUserData(guest);
    await saveUserData(account);

    await expect(loadUserData(null)).resolves.toMatchObject({
      id: 'guest-1',
      canvasAreas: [{ id: 'stack-1' }],
    });
    await expect(loadUserData('user-1')).resolves.toMatchObject({
      id: 'user-1',
      canvasAreas: [{ id: 'deck-1' }],
    });
    expect(localStorage.getItem('sorcery_guest_data')).toContain('stack-1');
    expect(localStorage.getItem('sorcery_user_data_user-1')).toContain('deck-1');
  });
});
