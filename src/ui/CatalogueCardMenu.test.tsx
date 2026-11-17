// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { required } from '@/utils/required';
import { CatalogueCardMenu } from './CatalogueCardMenu';

type MenuProps = ComponentProps<typeof CatalogueCardMenu>;
const request = { cardName: 'Frost Mage', clientX: 60, clientY: 90 };
const stacks = [{ id: 'saved-1', name: 'Drafts' }, { id: 'saved-2', name: 'Hidden research' }];
const onDeck = vi.fn();
const onStack = vi.fn();
const onCreateStack = vi.fn();
const onClose = vi.fn();
let host: HTMLDivElement;
let root: Root;

function action(label: string): HTMLButtonElement {
  return required([...host.querySelectorAll('button')].find(button =>
    (button.getAttribute('aria-label') ?? button.textContent?.replace('›', '').trim()) === label));
}

function open(props: Partial<MenuProps> = {}) {
  return act(async () => root.render(<CatalogueCardMenu request={request} deck={{ name: 'My deck' }}
    stacks={stacks} onDeck={onDeck} onStack={onStack} onCreateStack={onCreateStack} onClose={onClose} {...props} />));
}

function click(label: string) {
  return act(async () => { action(label).click(); });
}

function hover(label: string, pointerType = 'mouse') {
  return act(async () => {
    action(label).dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType }));
  });
}

async function key(keyValue: string) {
  const event = new KeyboardEvent('keydown', { key: keyValue, cancelable: true, bubbles: true });
  await act(async () => { required(document.activeElement).dispatchEvent(event); });
  return event;
}

async function writeName(value: string) {
  const input = required(host.querySelector<HTMLInputElement>('input'));
  const setter = required(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set);
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('catalogue card menu', () => {
  it('opens the adjacent Stack choices on hover and chooses a saved stack only once', async () => {
    await open();
    expect(host.querySelector('[role="menu"][aria-label="Add Frost Mage"]')).not.toBeNull();
    await hover('Stack');
    expect(action('Stack').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(action('Stack'));
    expect(host.querySelector('[aria-label="Saved stacks"]')).not.toBeNull();
    expect(action('New stack').textContent).toBe('+');
    await click('Hidden research');
    await click('Hidden research');
    expect(onStack).toHaveBeenCalledExactlyOnceWith('saved-2');
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCreateStack).not.toHaveBeenCalled();
  });

  it.each([['Main', 'mainboard'], ['Collection', 'collection'], ['Maybe', 'maybeboard']])(
    'opens Deck by click and adds the copy to %s', async (label, board) => {
      await open();
      await hover('Deck', 'touch');
      expect(action('Deck').getAttribute('aria-expanded')).toBe('false');
      await click('Deck');
      expect(host.querySelector('[aria-label="My deck boards"]')).not.toBeNull();
      expect(document.activeElement).toBe(action('Main'));
      await click(required(label));
      expect(onDeck).toHaveBeenCalledExactlyOnceWith(board);
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it('keeps board choices disabled with one explanation until there is an active deck', async () => {
    await open({ deck: null });
    await click('Deck');
    for (const label of ['Main', 'Collection', 'Maybe']) expect(action(label).disabled).toBe(true);
    expect(host.querySelector('p')?.textContent).toBe('Choose an active deck first.');
    await click('Main');
    expect(onDeck).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await hover('Stack');
    expect(action('Drafts').disabled).toBe(false);
  });

  it('moves focus between the menus with arrows and opens the inline creation form', async () => {
    await open();
    expect(document.activeElement).toBe(action('Stack'));
    await key('ArrowDown');
    expect(document.activeElement).toBe(action('Deck'));
    await key('ArrowRight');
    expect(document.activeElement).toBe(action('Main'));
    await key('End');
    expect(document.activeElement).toBe(action('Maybe'));
    await key('ArrowLeft');
    expect(document.activeElement).toBe(action('Deck'));
    expect(host.querySelector('[aria-label="My deck boards"]')).toBeNull();
    await key('ArrowUp');
    await key('ArrowRight');
    expect(document.activeElement).toBe(action('New stack'));
    await click('New stack');
    expect(document.activeElement).toBe(host.querySelector('input'));
    expect(action('Create').disabled).toBe(true);
    await writeName('   ');
    expect(action('Create').disabled).toBe(true);
    await writeName('  Ordered spells  ');
    expect(action('Create').disabled).toBe(false);
    await act(async () => { required(host.querySelector('form')).requestSubmit(); });
    expect(onCreateStack).toHaveBeenCalledExactlyOnceWith('Ordered spells');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('consumes Escape and restores focus to the trigger', async () => {
    const trigger = document.createElement('button');
    document.body.prepend(trigger);
    const canvasShortcut = vi.fn();
    window.addEventListener('keydown', canvasShortcut);
    try {
      trigger.focus();
      await open();
      await click('Stack');
      await click('New stack');
      expect((await key('Escape')).defaultPrevented).toBe(true);
      expect(canvasShortcut).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(trigger);
    } finally {
      window.removeEventListener('keydown', canvasShortcut);
      trigger.remove();
    }
  });

  it('dismisses an outside pointer while still letting the canvas receive it', async () => {
    const canvas = document.createElement('canvas');
    document.body.prepend(canvas);
    const onCanvasPress = vi.fn();
    canvas.addEventListener('pointerdown', onCanvasPress);
    try {
      await open();
      await act(async () => { action('Stack').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => { canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
      expect(onClose).toHaveBeenCalledOnce();
      expect(onCanvasPress).toHaveBeenCalledOnce();
    } finally {
      canvas.remove();
    }
  });

  it('allows the submenu to scroll and closes on an outside wheel', async () => {
    await open();
    await hover('Stack');
    const inside = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    await act(async () => { action('Drafts').dispatchEvent(inside); });
    expect(onClose).not.toHaveBeenCalled();
    expect(inside.defaultPrevented).toBe(false);
    await act(async () => { document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('flips the two panes within a narrow viewport and keeps the parent in place when the submenu opens', async () => {
    vi.stubGlobal('innerWidth', 300);
    vi.stubGlobal('innerHeight', 160);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('catalogue-card-menu-submenu') ? 135 : 75;
    });
    await open({ request: { ...request, clientX: 288, clientY: 146 } });
    const shell = required(host.querySelector<HTMLElement>('.catalogue-card-menu'));
    expect(shell.dataset.submenuSide).toBe('left');
    expect(shell.style.left).toBe('180px');
    expect(shell.style.top).toBe('77px');
    expect(shell.style.getPropertyValue('--catalogue-menu-width')).toBe('112px');
    expect(shell.style.getPropertyValue('--catalogue-submenu-width')).toBe('172px');
    await hover('Stack');
    const child = required(host.querySelector<HTMLElement>('.catalogue-card-menu-submenu'));
    expect(child.style.top).toBe('-60px');
    expect(shell.style.top).toBe('77px');
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
