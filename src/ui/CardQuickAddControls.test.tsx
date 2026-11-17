// @vitest-environment jsdom
import { act, createRef, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardQuickAddControls, type CardQuickAddControlsHandle } from './CardQuickAddControls';
import type { CardQuickAddTarget, CardQuickAddDeck, LabelCleanUpTarget } from '@/rendering/cardQuickAdd';

const deck: CardQuickAddDeck = { deckId: 'deck', canvasAreaId: 'area', name: 'My Deck' };
const targets: CardQuickAddTarget[] = [
  { key: 'a', cardName: 'Frost Mage', clientX: 300, clientY: 240, visible: true },
  { key: 'b', cardName: 'Fireball', clientX: 450, clientY: 240, visible: true },
];
const selectionTargets: CardQuickAddTarget[] = [
  { ...required(targets[0]), bounds: { left: 220, top: 120, right: 320, bottom: 230 }, canLayout: true, canQuickSort: true, canCleanUp: true },
  { ...required(targets[1]), bounds: { left: 450, top: 260, right: 580, bottom: 400 }, canLayout: true, canQuickSort: true, canCleanUp: true },
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
function textButton(label: string) {
  return required([...container.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === label));
}
async function click(label: string) { await act(async () => button(label).click()); }
async function clickText(label: string) { await act(async () => textButton(label).click()); }
async function update(next: CardQuickAddTarget[], label?: LabelCleanUpTarget | null) {
  await act(async () => ref.current?.updateTargets(next, label));
}
async function updateOnFrame(next: CardQuickAddTarget[], label?: LabelCleanUpTarget) {
  await act(async () => new Promise<void>(resolve => window.requestAnimationFrame(() => {
    ref.current?.updateTargets(next, label);
    resolve();
  })));
}
async function pointerEvent(target: EventTarget, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  options: PointerEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerdown' ? 1 : 0, bubbles: true, ...options,
    }));
  });
}
async function browserClick(target: HTMLButtonElement) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
}
type SelectionActions = Pick<ComponentProps<typeof CardQuickAddControls>, 'onLayout' | 'onQuickSort' | 'onCleanUp' | 'onCleanUpLabel'>;
async function render(activeDeck: CardQuickAddDeck | null = deck, actions: SelectionActions = {}) {
  await act(async () => root.render(<CardQuickAddControls ref={ref} deck={activeDeck} onAdd={onAdd} {...actions} />));
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
  it('opens a just-selected card during pickup while keeping the pointer on the canvas', async () => {
    await render();
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      ref.current?.updateTargets(targets);
      expect(ref.current?.openForHold('b')).toBe(true);
    });
    const controls = required(container.querySelector('.card-quick-add-controls'));
    expect(controls.hasAttribute('data-canvas-pointer-down')).toBe(true);
    expect(container.querySelector('#card-quick-add-menu')).not.toBeNull();
    expect(button('Add Fireball to My Deck').getAttribute('aria-expanded')).toBe('true');
    await act(async () => window.dispatchEvent(new Event('pointerup')));
    expect(controls.hasAttribute('data-canvas-pointer-down')).toBe(false);
    await click('Add Fireball to Maybe');
    expect(onAdd).toHaveBeenCalledExactlyOnceWith('b', 'card', 'maybeboard');
  });
  it('cancels a hold opened menu without dismissing a click opened menu', async () => {
    await render(); await update(targets);
    await act(async () => { ref.current?.openForHold('a'); });
    await act(async () => ref.current?.cancelHoldMenu());
    expect(container.querySelector('#card-quick-add-menu')).toBeNull();
    await click('Add Frost Mage to My Deck');
    await act(async () => ref.current?.cancelHoldMenu());
    expect(container.querySelector('#card-quick-add-menu')).not.toBeNull();
  });
  it('gives an eligible deck selection one Layout control even without an active deck', async () => {
    const onLayout = vi.fn();
    await render(null, { onLayout });
    await update(targets.map(card => ({ ...card, canLayout: true, visible: card.key === 'b' })));
    expect(container.querySelectorAll('button')).toHaveLength(1);
    await click('Layout selected cards');
    expect(onLayout).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('lets a press land on a moving plus and board choice through click', async () => {
    await render();
    await update(targets);
    const plus = button('Add Fireball to My Deck');
    const firstPosition = plus.style.transform;
    await pointerEvent(plus, 'pointerdown');
    const moved = targets.map(target => ({ ...target, clientX: target.clientX + 140 }));
    await updateOnFrame(moved);
    expect(plus.style.transform).toBe(firstPosition);
    await pointerEvent(plus, 'pointerup');
    await browserClick(plus);
    expect(plus.style.transform).not.toBe(firstPosition);

    const menu = required(container.querySelector<HTMLElement>('#card-quick-add-menu'));
    const choice = button('Add all selected to Maybe');
    const left = menu.style.left;
    await pointerEvent(choice, 'pointerdown');
    await updateOnFrame(moved.map(target => ({ ...target, visible: false })));
    expect(menu.isConnected).toBe(true);
    expect(menu.style.left).toBe(left);
    await pointerEvent(choice, 'pointerup');
    await browserClick(choice);
    expect(onAdd).toHaveBeenCalledExactlyOnceWith('b', 'selection', 'maybeboard');
    expect(menu.isConnected).toBe(false);
    expect(plus.hidden).toBe(true);
  });
});

describe('canvas selection actions', () => {
  it('centers one toolbar on the selected rectangle and follows camera movement', async () => {
    await render(null, { onLayout: vi.fn(), onQuickSort: vi.fn(), onCleanUp: vi.fn() });
    await update(selectionTargets);
    const toolbar = required(container.querySelector<HTMLElement>('.card-selection-actions'));
    expect([...toolbar.querySelectorAll('button')].map(node => node.textContent)).toEqual(['Layout', 'Quick Sort', 'Clean Up']);
    Object.defineProperties(toolbar, { offsetWidth: { value: 100 }, offsetHeight: { value: 120 } });
    await update(selectionTargets);
    expect(toolbar.style.transform).toBe('translate(350px, 200px)');
    await update(selectionTargets.map(target => ({ ...target, visible: false, bounds: {
      left: required(target.bounds).left + 50, right: required(target.bounds).right + 50,
      top: required(target.bounds).top, bottom: required(target.bounds).bottom,
    } })));
    expect(toolbar.style.transform).toBe('translate(400px, 200px)');
    expect(toolbar.hidden).toBe(false);
    await update(selectionTargets.map(target => ({ ...target, visible: false, bounds: {
      left: window.innerWidth + 20, right: window.innerWidth + 120, top: 100, bottom: 200,
    } })));
    expect(toolbar.hidden).toBe(true);
  });

  it('shows no tools for one card and keeps Clean Up available for eligible duplicates', async () => {
    const onCleanUp = vi.fn();
    await render(null, { onLayout: vi.fn(), onQuickSort: vi.fn(), onCleanUp });
    await update(selectionTargets.slice(0, 1));
    expect(container.querySelector('.card-selection-actions')).toBeNull();
    await update(selectionTargets.map(target => ({ ...target, canLayout: false, canQuickSort: false })));
    const toolbar = required(container.querySelector<HTMLElement>('.card-selection-actions'));
    expect([...toolbar.querySelectorAll('button')].map(node => node.textContent)).toEqual(['Clean Up']);
    await clickText('Clean Up');
    expect(onCleanUp).toHaveBeenCalledOnce();
    expect(toolbar.hidden).toBe(true);
    await update(selectionTargets);
    expect(toolbar.hidden).toBe(true);
  });

  it('places only Clean Up above an eligible label and follows its title without covering it', async () => {
    const onCleanUp = vi.fn();
    const onCleanUpLabel = vi.fn();
    await render(null, { onLayout: vi.fn(), onQuickSort: vi.fn(), onCleanUp, onCleanUpLabel });
    const label = { id: 'cost-2', clientX: 440, clientY: 260, visible: true };
    await update([], label);
    const toolbar = required(container.querySelector<HTMLElement>('[aria-label="Selected label actions"]'));
    expect([...toolbar.querySelectorAll('button')].map(node => node.textContent)).toEqual(['Clean Up']);
    Object.defineProperties(toolbar, { offsetWidth: { value: 100 }, offsetHeight: { value: 44 } });
    await update([], { ...label, clientX: 490, clientY: 300 });
    expect(toolbar.style.transform).toBe('translate(440px, 250px)');
    expect(toolbar.hidden).toBe(false);
    await update([], { ...label, clientY: 32 });
    expect(toolbar.hidden).toBe(true);
    await update([], { ...label, visible: false });
    expect(toolbar.hidden).toBe(true);
    await update([], label);
    expect(toolbar.hidden).toBe(false);
    await clickText('Clean Up');
    expect(onCleanUpLabel).toHaveBeenCalledExactlyOnceWith('cost-2');
    expect(onCleanUp).not.toHaveBeenCalled();
    expect(toolbar.hidden).toBe(true);
    await update([], null);
    expect(container.querySelector('.card-selection-actions')).toBeNull();
    await update([], { ...label, id: 'cost-3' });
    expect(textButton('Clean Up').closest<HTMLElement>('.card-selection-actions')?.hidden).toBe(false);
  });

  it('dismisses Layout until selected keys change, including when the same selection moves or is reordered', async () => {
    const onLayout = vi.fn();
    await render(deck, { onLayout, onQuickSort: vi.fn(), onCleanUp: vi.fn() });
    await update(selectionTargets);
    const toolbar = required(container.querySelector<HTMLElement>('.card-selection-actions'));
    await click('Layout selected cards');
    expect(onLayout).toHaveBeenCalledExactlyOnceWith('a');
    expect(toolbar.hidden).toBe(true);
    expect(button('Add Frost Mage to My Deck').hidden).toBe(false);
    await update(selectionTargets.map(target => ({ ...target, clientX: target.clientX + 50, canLayout: false })));
    expect(toolbar.hidden).toBe(true);
    await update([...selectionTargets].reverse());
    expect(toolbar.hidden).toBe(true);
    await update(selectionTargets.map(target => target.key === 'b' ? { ...target, key: 'c' } : target));
    expect(toolbar.hidden).toBe(false);
  });

  it('replaces the toolbar with an on-screen Quick Sort menu and dismisses it after the action', async () => {
    const onQuickSort = vi.fn();
    await render(deck, { onQuickSort });
    await update(selectionTargets);
    const toolbar = required(container.querySelector<HTMLElement>('.card-selection-actions'));
    await clickText('Quick Sort');
    const menu = required(container.querySelector<HTMLElement>('#card-selection-sort-menu'));
    expect(toolbar.hidden).toBe(true);
    expect(menu.hidden).toBe(false);
    expect([...menu.querySelectorAll('button')].map(node => node.textContent))
      .toEqual(['Name', 'Type', 'Cost', 'Power', 'Element', 'Threshold', 'Rarity', 'Set']);
    expect(document.activeElement).toBe(textButton('Name'));
    Object.defineProperties(menu, { offsetWidth: { value: 184 }, offsetHeight: { value: 158 } });
    await update(selectionTargets.map(target => ({ ...target, visible: false, bounds: { left: -30, top: -80, right: 60, bottom: 40 } })));
    expect(menu.style.transform).toBe('translate(8px, 8px)');
    expect(menu.style.getPropertyValue('--selection-actions-opacity')).toBe('');
    await clickText('Power');
    expect(onQuickSort).toHaveBeenCalledExactlyOnceWith('power');
    expect(container.querySelector('#card-selection-sort-menu')).toBeNull();
    await update(selectionTargets);
    expect(toolbar.hidden).toBe(true);
    await update([]);
    await update(selectionTargets);
    expect(required(container.querySelector<HTMLElement>('.card-selection-actions')).hidden).toBe(false);
  });

  it('closes Quick Sort on Escape, outside presses and switching to a board menu', async () => {
    const onQuickSort = vi.fn();
    await render(deck, { onQuickSort });
    await update(selectionTargets);
    const toolbar = required(container.querySelector<HTMLElement>('.card-selection-actions'));
    await clickText('Quick Sort');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.querySelector('#card-selection-sort-menu')).toBeNull();
    expect(toolbar.hidden).toBe(false);
    expect(document.activeElement).toBe(textButton('Quick Sort'));
    await clickText('Quick Sort');
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(container.querySelector('#card-selection-sort-menu')).toBeNull();
    expect(toolbar.hidden).toBe(false);
    await act(async () => window.dispatchEvent(new Event('pointerup')));
    await clickText('Quick Sort');
    await click('Add Fireball to My Deck');
    expect(container.querySelector('#card-selection-sort-menu')).toBeNull();
    expect(container.querySelector('#card-quick-add-menu')).not.toBeNull();
    expect(onQuickSort).not.toHaveBeenCalled();
  });

  it('fades across pointer proximity and stays fully opaque during focus and touch', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      await render(deck, { onLayout: vi.fn() });
      await update(selectionTargets);
      const toolbar = required(container.querySelector<HTMLElement>('.card-selection-actions'));
      const opacity = () => Number(toolbar.style.getPropertyValue('--selection-actions-opacity'));
      async function move(clientX: number, clientY: number) {
        await act(async () => {
          window.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, pointerType: 'mouse' }));
          vi.advanceTimersToNextFrame();
        });
      }
      await move(8, 8);
      expect(opacity()).toBeLessThan(0.25);
      const far = opacity();
      await move(245, 155);
      expect(opacity()).toBeGreaterThan(far);
      expect(opacity()).toBeLessThan(1);
      await move(365, 260);
      expect(opacity()).toBe(1);
      await move(8, 8);
      expect(opacity()).toBe(far);
      await act(async () => {
        button('Layout selected cards').focus();
        vi.advanceTimersToNextFrame();
      });
      expect(opacity()).toBe(1);
      await act(async () => {
        button('Layout selected cards').blur();
        vi.advanceTimersToNextFrame();
      });
      expect(opacity()).toBe(far);
      await act(async () => {
        document.body.dispatchEvent(new PointerEvent('pointerdown', { clientX: 8, clientY: 8, pointerId: 4, pointerType: 'touch', bubbles: true }));
        vi.advanceTimersToNextFrame();
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 4, pointerType: 'touch' }));
      });
      expect(opacity()).toBe(1);
      expect(button('Add Frost Mage to My Deck').style.getPropertyValue('--selection-actions-opacity')).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds Layout in place through movement, rerender, release and click', async () => {
    const onLayout = vi.fn();
    await render(null, { onLayout, onCleanUpLabel: vi.fn() });
    await update(selectionTargets);
    const toolbar = required(container.querySelector<HTMLElement>('.card-selection-actions'));
    const layout = button('Layout selected cards');
    const position = toolbar.style.transform;
    await pointerEvent(layout, 'pointerdown', { clientX: 400, clientY: 260 });
    await render(null, { onLayout, onCleanUpLabel: vi.fn() });
    await pointerEvent(document.body, 'pointermove', { buttons: 1, clientX: 8, clientY: 8 });
    const outOfView = selectionTargets.map(target => ({ ...target, visible: false, bounds: {
      left: window.innerWidth + 20, right: window.innerWidth + 120, top: 100, bottom: 200,
    } }));
    await updateOnFrame(outOfView);
    expect(toolbar.hidden).toBe(false);
    expect(toolbar.style.transform).toBe(position);
    expect(toolbar.style.getPropertyValue('--selection-actions-opacity')).toBe('1');
    await pointerEvent(layout, 'pointerup');
    await updateOnFrame(outOfView);
    expect(toolbar.hidden).toBe(false);
    expect(toolbar.style.transform).toBe(position);
    await browserClick(layout);
    expect(onLayout).toHaveBeenCalledExactlyOnceWith('a');
    expect(toolbar.hidden).toBe(true);
  });

  it('keeps a Quick Sort choice under the pointer until sorting', async () => {
    const onQuickSort = vi.fn();
    await render(null, { onQuickSort });
    await update(selectionTargets);
    const sort = textButton('Quick Sort');
    await pointerEvent(sort, 'pointerdown');
    await pointerEvent(sort, 'pointerup');
    await browserClick(sort);
    const choice = textButton('Power');
    const menu = required(choice.closest<HTMLElement>('.card-selection-sort-menu'));
    const position = menu.style.transform;
    await pointerEvent(choice, 'pointerdown');
    await updateOnFrame(selectionTargets.map(target => ({ ...target, bounds: { left: 0, right: 30, top: 50, bottom: 80 } })));
    expect(menu.style.transform).toBe(position);
    await pointerEvent(choice, 'pointerup');
    await browserClick(choice);
    expect(onQuickSort).toHaveBeenCalledExactlyOnceWith('power');
    expect(menu.isConnected).toBe(false);
    expect(container.querySelector<HTMLElement>('.card-selection-actions')?.hidden).toBe(true);
  });

  it.each([false, true])('continues a Clean Up press while its anchor moves (label: %s)', async isLabel => {
    const onCleanUp = vi.fn();
    const onCleanUpLabel = vi.fn();
    const label = isLabel ? { id: 'group', clientX: 440, clientY: 260, visible: true } : undefined;
    const cards = isLabel ? [] : selectionTargets;
    await render(null, { onCleanUp, onCleanUpLabel });
    await update(cards, label);
    const cleanUp = textButton('Clean Up');
    const toolbar = required(cleanUp.closest<HTMLElement>('.card-selection-actions'));
    const position = toolbar.style.transform;
    await pointerEvent(cleanUp, 'pointerdown');
    await updateOnFrame(cards.map(target => ({ ...target, bounds: { left: 0, right: 30, top: 50, bottom: 80 } })),
      label ? { ...label, clientX: 200 } : undefined);
    expect(toolbar.style.transform).toBe(position);
    await pointerEvent(cleanUp, 'pointerup');
    await browserClick(cleanUp);
    expect(toolbar.hidden).toBe(true);
    if (isLabel) {
      expect(onCleanUpLabel).toHaveBeenCalledExactlyOnceWith('group');
      expect(onCleanUp).not.toHaveBeenCalled();
    } else {
      expect(onCleanUp).toHaveBeenCalledOnce();
      expect(onCleanUpLabel).not.toHaveBeenCalled();
    }
  });

  it('does not activate a pressed control if the selection changes before click', async () => {
    const onLayout = vi.fn();
    await render(null, { onLayout });
    await update(selectionTargets);
    const layout = button('Layout selected cards');
    await pointerEvent(layout, 'pointerdown');
    await update(selectionTargets.map(target => ({ ...target, key: `${target.key}-changed` })));
    expect(button('Layout selected cards')).toBe(layout);
    await pointerEvent(layout, 'pointerup');
    await browserClick(layout);
    expect(onLayout).not.toHaveBeenCalled();
    await pointerEvent(layout, 'pointerdown');
    await pointerEvent(layout, 'pointerup');
    await browserClick(layout);
    expect(onLayout).toHaveBeenCalledExactlyOnceWith('a-changed');
  });

  it('resumes camera updates on cancellation and restores hit targets after a missed outside release', async () => {
    const onLayout = vi.fn();
    await render(null, { onLayout });
    await update(selectionTargets);
    const layout = button('Layout selected cards');
    const toolbar = required(layout.closest<HTMLElement>('.card-selection-actions'));
    const controls = required(toolbar.closest<HTMLElement>('.card-quick-add-controls'));
    const before = toolbar.style.transform;
    await pointerEvent(layout, 'pointerdown');
    await updateOnFrame(selectionTargets.map(target => ({ ...target, bounds: { left: 0, right: 30, top: 50, bottom: 80 } })));
    expect(toolbar.style.transform).toBe(before);
    await pointerEvent(layout, 'pointercancel');
    expect(toolbar.style.transform).not.toBe(before);
    expect(onLayout).not.toHaveBeenCalled();

    await pointerEvent(document.body, 'pointerdown');
    expect(controls.hasAttribute('data-canvas-pointer-down')).toBe(true);
    await pointerEvent(document.body, 'pointermove', { buttons: 1 });
    expect(controls.hasAttribute('data-canvas-pointer-down')).toBe(true);
    await pointerEvent(document.body, 'pointermove');
    expect(controls.hasAttribute('data-canvas-pointer-down')).toBe(false);
    await pointerEvent(layout, 'pointerdown');
    await pointerEvent(layout, 'pointerup');
    await browserClick(layout);
    expect(onLayout).toHaveBeenCalledOnce();
  });
});
