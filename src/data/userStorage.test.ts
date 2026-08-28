/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGuestUserData, type UserData } from '@/data/dataModels';
import {
  loadUserData,
  loadUserDataResult,
  mirrorUserDataToLocalStorage,
  saveUserData,
} from '@/data/userStorage';

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

  it('stores a savedAt envelope and reports readFailed=false when data loads', async () => {
    const guest = createGuestUserData('guest-1');
    await saveUserData(guest);

    const raw = JSON.parse(localStorage.getItem('sorcery_guest_data') ?? 'null') as {
      savedAt: number;
      data: UserData;
    };
    expect(typeof raw.savedAt).toBe('number');
    expect(raw.data.id).toBe('guest-1');

    const result = await loadUserDataResult(null);
    expect(result.readFailed).toBe(false);
    expect(result.data?.id).toBe('guest-1');
  });

  it('still loads legacy localStorage data without an envelope', async () => {
    const legacy = createGuestUserData('guest-legacy');
    localStorage.setItem('sorcery_guest_data', JSON.stringify(legacy));

    await expect(loadUserData(null)).resolves.toMatchObject({ id: 'guest-legacy' });
  });

  it('mirrors a snapshot synchronously so the last edit survives unload', async () => {
    const guest = createGuestUserData('guest-1');
    await saveUserData(guest);

    const edited = {
      ...guest,
      decks: [
        {
          id: 'deck-late',
          name: 'Last Second Deck',
          boards: { mainboard: [], sideboard: [], avatar: [], maybeboard: [] },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    } satisfies UserData;

    expect(mirrorUserDataToLocalStorage(edited)).toBe(true);

    const reloaded = await loadUserData(null);
    expect(reloaded?.decks.map((deck) => deck.id)).toEqual(['deck-late']);
  });
});
