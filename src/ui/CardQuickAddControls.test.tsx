// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardQuickAddControls, type CardQuickAddControlsHandle } from './CardQuickAddControls';
import type { CardQuickAddTarget, CardQuickAddDeck } from '@/rendering/cardQuickAdd';

const deck: CardQuickAddDeck = { deckId: 'deck', canvasAreaId: 'area', name: 'My Deck' };
const targets: CardQuickAddTarget[] = [
  { key: 'a', cardName: 'Frost Mage', clientX: 300, clientY: 240, visible: true },
  { key: 'b', cardName: 'Fireball', clientX: 450, clientY: 240, visible: true },
];
let root: Root;
let container: HTMLDivElement;
const ref = createRef<CardQuickAddControlsHandle>();
const onAdd = vi.fn();
function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('Missing fixture');
  return value;
}
function button(label: string) {
  return required(container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`));
}
async function click(label: string) { await act(async () => button(label).click()); }
async function update(next: CardQuickAddTarget[]) { await act(async () => ref.current?.updateTargets(next)); }
async function render(activeDeck: CardQuickAddDeck | null = deck) {
  await act(async () => root.render(<CardQuickAddControls ref={ref} deck={activeDeck} onAdd={onAdd} />));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); onAdd.mockReset();
});

describe('card corner quick add menu', () => {
  it('shows Collection, Main and Maybe above a single card plus, and commits one card', async () => {
    await render(); await update(targets.slice(0, 1));
    await click('Add Frost Mage to My Deck');
    expect([...container.querySelectorAll('.card-quick-add-row button')].map(node => node.textContent)).toEqual(['Collection', 'Main', 'Maybe']);
    expect(container.querySelector('.card-quick-add-selection')).toBeNull();
    await click('Add Frost Mage to Main');
    expect(onAdd).toHaveBeenCalledExactlyOnceWith('a', 'card', 'mainboard');
    expect(container.querySelector('#card-quick-add-menu')).toBeNull();
  });
  it('keeps the upper row scoped to the clicked card and the outlined lower row scoped to all selected', async () => {
    await render(); await update(targets);
    await click('Add Fireball to My Deck');
    expect(container.querySelector('.card-quick-add-selection')?.textContent).toContain('All Selected (2)');
    expect([...container.querySelectorAll('.card-quick-add-selection button')].map(node => node.textContent)).toEqual(['Collection', 'Main', 'Maybe']);
    await click('Add Fireball to Collection');
    expect(onAdd).toHaveBeenLastCalledWith('b', 'card', 'collection');
    await click('Add Fireball to My Deck');
    await click('Add all selected to Maybe');
    expect(onAdd).toHaveBeenLastCalledWith('b', 'selection', 'maybeboard');
    expect(onAdd).toHaveBeenCalledTimes(2);
  });
  it('dismisses on outside pointer, Escape, selection changes and deck removal', async () => {
    await render(); await update(targets);
    await click('Add Frost Mage to My Deck');
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(container.querySelector('#card-quick-add-menu')).toBeNull();
    await act(async () => window.dispatchEvent(new Event('pointerup')));
    await click('Add Frost Mage to My Deck');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.querySelector('#card-quick-add-menu')).toBeNull();
    expect(document.activeElement).toBe(button('Add Frost Mage to My Deck'));
    await click('Add Frost Mage to My Deck');
    await update(targets.slice(0, 1));
    expect(container.querySelector('#card-quick-add-menu')).toBeNull();
    await click('Add Frost Mage to My Deck');
    await render(null);
    expect(container.querySelector('button')).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });
  it('keeps menu and controls anchored during camera movement without replacing the controls', async () => {
    await render(); await update(targets);
    const plus = button('Add Frost Mage to My Deck');
    await click('Add Frost Mage to My Deck');
    const menu = container.querySelector('#card-quick-add-menu');
    await update(targets.map(target => ({ ...target, clientX: target.clientX + 100 })));
    expect(button('Add Frost Mage to My Deck')).toBe(plus);
    expect(plus.style.transform).toBe('translate(384px, 224px)');
    expect(container.querySelector('#card-quick-add-menu')).toBe(menu);
    expect((menu as HTMLElement).style.left).toBe('265px');
    await update(targets.map(target => ({ ...target, visible: false })));
    expect(plus.hidden).toBe(true);
    expect(container.querySelector('#card-quick-add-menu')).toBeNull();
  });
  it('does not show controls until a deck is active on the canvas', async () => {
    await render(null); await update(targets);
    expect(container.querySelector('button')).toBeNull();
    await render();
    expect(button('Add Frost Mage to My Deck').style.transform).toBe('translate(284px, 224px)');
  });
});
