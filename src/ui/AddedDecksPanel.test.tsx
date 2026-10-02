// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDeck } from '@/data/dataModels';
import { getDeckLibraryEntries } from '@/data/deckLibrary';
import { AddedDecksPanel } from './AddedDecksPanel';

let container: HTMLDivElement;
let root: Root;
const decks = ['Manual import', 'Saved lookup', 'Example'].map((name) => createEmptyDeck(name, name));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('Added decks', () => {
  it('focuses a deck on selection, shows its analysis, and updates the list and analysis after removal', async () => {
    const onSelectDeck = vi.fn(); const onRemoveDeck = vi.fn();
    const render = async (entries = getDeckLibraryEntries(decks, [])) => {
      await act(async () => root.render(<AddedDecksPanel entries={entries} cards={[]} styleData={null}
        onSelectDeck={onSelectDeck} onRemoveDeck={onRemoveDeck} />));
    };
    await render();
    expect(container.querySelectorAll('.user-added-deck')).toHaveLength(3);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Load Saved lookup"]')?.click());
    expect(onSelectDeck).toHaveBeenCalledWith(decks[1], 0);
    expect(container.querySelector('[aria-label="Analysis of Saved lookup"]')).not.toBeNull();
    const remove = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Remove deck');
    await act(async () => remove?.click());
    expect(onRemoveDeck).toHaveBeenCalledWith('Saved lookup');
    await render(getDeckLibraryEntries(decks.filter((deck) => deck.id !== 'Saved lookup'), []));
    expect(container.querySelectorAll('.user-added-deck')).toHaveLength(2);
    expect(container.querySelector('[aria-label="Analysis of Saved lookup"]')).toBeNull();
  });
});
