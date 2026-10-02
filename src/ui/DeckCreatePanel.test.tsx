// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDeck, type Deck } from '@/data/dataModels';
import { DeckCreatePanel } from './DeckCreatePanel';

const mocks = vi.hoisted(() => ({ fetchDeck: vi.fn(), dispatch: vi.fn() }));
vi.mock('@/data/curiosaService', () => ({ fetchCuriosaDeck: mocks.fetchDeck }));
vi.mock('@/app/AppState', () => ({ useAppState: () => ({
  state: { cards: [
    { name: 'Animist', guardian: { type: 'Avatar' } },
    { name: 'Future Avatar', guardian: { type: 'Avatar' } },
  ] },
  dispatch: mocks.dispatch,
}) }));

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.fetchDeck.mockReset();
  mocks.dispatch.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((entry) => entry.textContent === text);
  if (!button) throw new Error(`Missing button ${text}`);
  await act(async () => button.click());
}

async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!input) throw new Error(`Missing input ${selector}`);
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function render(onCreateDeck = vi.fn(() => true)) {
  await act(async () => root?.render(<DeckCreatePanel onCreateDeck={onCreateDeck} />));
  return onCreateDeck;
}

describe('shared Add Deck flow', () => {
  it('offers URL, local and text in order and uses live avatars for local decks', async () => {
    const onCreate = await render();
    expect([...container.querySelectorAll('button')].map((button) => button.textContent))
      .toEqual(['Import deck URL', 'New local deck', 'Paste deck text']);
    await click('New local deck');
    expect([...container.querySelectorAll('option')].map((option) => option.value))
      .toEqual(['Animist', 'Future Avatar']);
    await click('Create');
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Animist Deck', origin: 'user', boards: expect.objectContaining({ avatar: [{ name: 'Animist', quantity: 1 }] }),
    }));
  });

  it('keeps unknown text cards and reports them to the visitor', async () => {
    const onCreate = await render();
    await click('Paste deck text');
    await fill('textarea', '2 Future Trap');
    await click('Import');
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'user', boards: expect.objectContaining({ mainboard: [{ name: 'Future Trap', quantity: 2 }] }),
    }));
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      notification: expect.objectContaining({ type: 'warning', message: expect.stringContaining('Future Trap') }),
    }));
  });

  it('imports a SorceryTCG URL and retains its identity and boards', async () => {
    const deck = createEmptyDeck('Remote deck', 'curiosa-source-id');
    deck.boards.avatar.push({ name: 'Animist', quantity: 1 });
    mocks.fetchDeck.mockResolvedValue(deck);
    const onCreate = await render();
    await click('Import deck URL');
    await fill('input', 'https://sorcerytcg.com/decks/source-id');
    await click('Load');
    expect(mocks.fetchDeck).toHaveBeenCalledWith('https://sorcerytcg.com/decks/source-id', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ id: deck.id, name: deck.name, origin: 'user', boards: deck.boards }));
  });

  it('aborts on panel close and ignores a late result', async () => {
    let resolveFetch: ((deck: Deck) => void) | undefined;
    mocks.fetchDeck.mockImplementation(() => new Promise<Deck>((resolve) => { resolveFetch = resolve; }));
    const onCreate = await render();
    await click('Import deck URL');
    await fill('input', 'https://sorcerytcg.com/decks/source-id');
    await click('Load');
    const signal = mocks.fetchDeck.mock.calls[0]?.[1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    await act(async () => { root?.unmount(); root = null; });
    expect(signal.aborted).toBe(true);
    await act(async () => resolveFetch?.(createEmptyDeck('Late deck', 'late')));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
