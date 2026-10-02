// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDeck } from '@/data/dataModels';
import type { CanvasArea } from '@/canvas/canvasAreas';
import { DecksPanel } from './DecksPanel';

const mocks = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock('@/app/AppState', () => ({ useAppState: mocks.state }));
let container: HTMLDivElement;
let root: Root;
const deck = createEmptyDeck('Personal deck', 'personal');
const area: CanvasArea = { id: 'area', type: 'deck', deckId: deck.id, name: deck.name, pinned: true, cards: [], bounds: { x: 0, y: 0, width: 1000, height: 1000 } };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.state.mockReturnValue({ state: { cards: [], userData: { decks: [deck] } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function click(selector: string) {
  const button = container.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`Missing ${selector}`);
  await act(async () => button.click());
}
async function render(areas: CanvasArea[] = []) {
  const callbacks = { onCreateDeckZone: vi.fn(() => 'area'), onHideCanvasArea: vi.fn(), onFocusCanvasArea: vi.fn(), onResetDeckLayout: vi.fn(), onRemoveDeck: vi.fn() };
  await act(async () => root.render(<DecksPanel canvasAreas={areas} {...callbacks} />));
  return callbacks;
}

describe('deck side panel', () => {
  it('requests layout reset and removal through the shared confirmation actions', async () => {
    const callbacks = await render([area]);
    await click('.deck-tab:not(.deck-tab-add)');
    for (const label of ['Reset layout', 'Remove deck']) {
      const button = [...container.querySelectorAll('button')].find((entry) => entry.textContent === label);
      if (!button) throw new Error(`Missing ${label}`);
      await act(async () => button.click());
    }
    expect(callbacks.onResetDeckLayout).toHaveBeenCalledWith('area');
    expect(callbacks.onRemoveDeck).toHaveBeenCalledWith(deck.id);
  });
  it('loads and focuses a saved deck on a single click', async () => {
    const callbacks = await render();
    await click('.deck-tab:not(.deck-tab-add)');
    expect(callbacks.onCreateDeckZone).toHaveBeenCalledWith(deck);
    // The create/reopen callback focuses atomically. A second callback here can
    // overwrite the new area with the previous render's list of areas.
    expect(callbacks.onFocusCanvasArea).not.toHaveBeenCalled();
    expect(container.querySelector('.decks-panel.open')).not.toBeNull();
  });
  it('hides a deck through the visibility callback without deleting it', async () => {
    const callbacks = await render([area]);
    await click('.deck-tab:not(.deck-tab-add)');
    const hideDeck = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Hide deck');
    if (!hideDeck) throw new Error('Missing Hide deck');
    await act(async () => hideDeck.click());
    expect(callbacks.onHideCanvasArea).toHaveBeenCalledWith('area');
    expect(container.querySelector('.decks-panel.open')).toBeNull();
  });

  it.each([{ areas: [] }, { areas: [area] }])('can hide the inspector with or without an existing canvas area ($areas.length)', async ({ areas }) => {
    const callbacks = await render(areas);
    await click('.deck-tab:not(.deck-tab-add)');
    await click('.deck-panel-hide');
    expect(container.querySelector('.decks-panel.open')).toBeNull();
    expect(callbacks.onHideCanvasArea).not.toHaveBeenCalled();
  });
});
