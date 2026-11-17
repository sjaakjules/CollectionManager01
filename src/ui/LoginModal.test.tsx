// @vitest-environment jsdom
import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext, appReducer, initialAppState, type AppState } from '@/app/AppState';
import { initializeApp } from '@/app/Startup';
import { guestWorkspaceFixture } from '@/data/__fixtures__/guestWorkspace';
import { loadUserData } from '@/data/userStorage';
import { getStoredSession } from '@/auth/session';
import type { UserData } from '@/data/dataModels';
import { required } from '@/utils/required';
import { LoginModal } from './LoginModal';

const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => disk.get(key)),
  set: vi.fn(async (key: string, value: unknown) => { disk.set(key, structuredClone(value)); }),
  del: vi.fn(async (key: string) => { disk.delete(key); }),
}));
vi.mock('@/data/cardService', () => ({ fetchCards: vi.fn(async () => []) }));
vi.mock('@/data/seedDecks', () => ({ fetchGuestSeedDecks: vi.fn(async () => []) }));

let root: Root;
let container: HTMLDivElement;
let current: AppState;
let remote: UserData | null;
let signupPayload: { username: string; password: string; userData: UserData } | null;
let guest: UserData;
function Harness() {
  const initial = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: guest });
  const [state, dispatch] = useReducer(appReducer, { ...initial, ui: { ...initial.ui, loginModalOpen: true } });
  current = state;
  return <AppContext.Provider value={{ state, dispatch }}><LoginModal /></AppContext.Provider>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  disk.clear(); localStorage.clear(); remote = null; signupPayload = null; guest = guestWorkspaceFixture();
  vi.stubGlobal('fetch', vi.fn(async (url: string, request?: RequestInit) => {
    if (url.endsWith('/signup')) {
      signupPayload = JSON.parse(String(request?.body)) as NonNullable<typeof signupPayload>;
      remote = { ...signupPayload.userData, id: 'account-id', name: signupPayload.username };
      return Response.json({ userId: 'account-id', username: signupPayload.username, token: 'test-only-token' });
    }
    if (url.endsWith('/user/account-id/data')) {
      if (request?.method === 'PUT') remote = JSON.parse(String(request.body)) as UserData;
      return Response.json(remote);
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function click(label: string) {
  const button = required([...container.querySelectorAll('button')].find(node => node.textContent === label));
  await act(async () => button.click());
}
async function fill(id: string, value: string) {
  const element = required(container.querySelector<HTMLInputElement>(`#${id}`));
  await act(async () => {
    required(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set).call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function signupForm() {
  await act(async () => root.render(<Harness />));
  await click('Sign Up'); await fill('username', 'NewAccount'); await fill('password', 'test-only-password');
}

describe('guest workspace signup', () => {
  it('sends the whole workspace with signup, retains a guest backup, and survives account reload without multiplying collection quantities', async () => {
    await signupForm();
    const before = current.userData;
    await click('Create Account');
    expect(signupPayload?.userData).toEqual(before);
    expect(current.session.isGuest).toBe(false);
    expect(current.ui.loginModalOpen).toBe(false);
    expect(current.userData).toEqual({ ...before, id: 'account-id', name: 'NewAccount' });
    expect(await loadUserData(null)).toEqual(before);
    expect(await loadUserData('account-id')).toEqual(current.userData);
    expect(remote).toEqual(current.userData);
    expect(getStoredSession()?.userId).toBe('account-id');
    const account = current.userData;
    for (let reload = 0; reload < 2; reload++) {
      let reloaded = initialAppState;
      expect(await initializeApp(action => { reloaded = appReducer(reloaded, action); })).toEqual({ success: true });
      expect(reloaded.userData).toEqual(account);
      expect(reloaded.userData?.collection).toEqual(before?.collection);
    }
    // A second browser has no account cache: the server must already have the
    // full transfer, without relying on App's delayed autosave.
    disk.delete('sorcery_user_data_account-id');
    localStorage.removeItem('sorcery_user_data_account-id');
    let fromServer = initialAppState;
    await initializeApp(action => { fromServer = appReducer(fromServer, action); });
    expect(fromServer.userData).toEqual(account);
  });

  it('leaves guest data and identity intact when signup cannot save the account', async () => {
    await signupForm();
    const before = current.userData;
    vi.mocked(fetch).mockResolvedValue(Response.json({ message: 'Signup failed' }, { status: 500 }));
    await click('Create Account');
    expect(current.userData).toEqual(before);
    expect(current.session.isGuest).toBe(true);
    expect(getStoredSession()).toBeNull();
    expect(await loadUserData(null)).toEqual(before);
    expect(container.querySelector('.form-error')?.textContent).toBe('Signup failed');
    expect(current.ui.loginModalOpen).toBe(true);
  });
});
