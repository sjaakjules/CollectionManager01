// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogueLayoutPanel } from './CatalogueLayoutPanel';
import { CanvasLayoutPopover } from './canvasLayoutPopover';
import { LayoutEditor } from './LayoutEditor';
import { createDefaultCatalogueLayout, createSelectionLayout, type CatalogueLayoutConfig } from '@/data/catalogueLayout';

let root: Root;
let container: HTMLDivElement;
const changed = vi.fn<(layout: CatalogueLayoutConfig) => void>();
function Harness({ selection = false }: { selection?: boolean }) {
  const [layout, setLayout] = useState(selection ? createSelectionLayout : createDefaultCatalogueLayout);
  const onChange = (next: CatalogueLayoutConfig) => { changed(next); setLayout(next); };
  return selection ? <LayoutEditor layout={layout} onChange={onChange} allowClean />
    : <CatalogueLayoutPanel layout={layout} onChange={onChange} visibleCount={10} totalCount={100} />;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  changed.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
  for (const element of container.querySelectorAll<HTMLElement>('[data-layout-insert-index]')) {
    const index = Number(element.dataset.layoutInsertIndex);
    element.getBoundingClientRect = () => new DOMRect(index * 140, 100, 32, 100);
  }
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function button(text: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find((entry) => entry.textContent === text);
  if (!element) throw new Error(`Missing ${text}`);
  Object.assign(element, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  return element;
}
async function pointer(target: HTMLElement, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  await act(async () => target.dispatchEvent(event));
}
function names() {
  return [...container.querySelectorAll('.layout-editor-node-title')].map((entry) => entry.textContent);
}

describe('catalogue layout pointer controls', () => {
  it('reorders by dragging a node title to a highlighted connector', async () => {
    const name = button('Name');
    await pointer(name, 'pointerdown', 900, 500);
    await pointer(name, 'pointermove', 150, 150);
    expect(container.querySelector('[data-layout-insert-index="1"]')?.classList.contains('drop-active')).toBe(true);
    expect(changed).not.toHaveBeenCalled();
    await pointer(name, 'pointerup', 150, 150);
    expect(names()).toEqual(['Element', 'Name', 'Spellbook / Atlas', 'Card type', 'Cost']);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('inserts a palette step at a connector rather than appending it', async () => {
    const rarity = button('+ Rarity');
    await pointer(rarity, 'pointerdown', 900, 500);
    await pointer(rarity, 'pointermove', 290, 150);
    await pointer(rarity, 'pointerup', 290, 150);
    expect(names()).toEqual(['Element', 'Spellbook / Atlas', 'Rarity', 'Card type', 'Cost', 'Name']);
  });

  it('keeps palette click-to-append and title double-click-to-toggle working', async () => {
    await act(async () => button('+ Rarity').click());
    expect(names().at(-1)).toBe('Rarity');
    const name = button('Name');
    await act(async () => name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(name.closest('.layout-editor-node')?.classList.contains('group')).toBe(true);
  });

  it('cancels without changing the operation order', async () => {
    const name = button('Name');
    await pointer(name, 'pointerdown', 900, 500);
    await pointer(name, 'pointermove', 150, 150);
    await pointer(name, 'pointercancel', 150, 150);
    expect(changed).not.toHaveBeenCalled();
    expect(container.querySelector('.drop-active')).toBeNull();
    expect(names()).toEqual(['Element', 'Spellbook / Atlas', 'Card type', 'Cost', 'Name']);
  });

  it('keeps the palette above the operation order and places a remove control on each node', async () => {
    const layout = container.querySelector('.layout-editor');
    expect([...layout?.children ?? []].slice(0, 3).map((entry) => entry.className)).toEqual([
      'layout-editor-palette', 'layout-editor-flow', 'layout-editor-footer',
    ]);
    const remove = container.querySelector<HTMLButtonElement>('[aria-label="Remove Cost step"]');
    expect(remove?.classList.contains('layout-editor-remove')).toBe(true);
    expect(container.querySelector('[aria-label^="Move "]')).toBeNull();
    await act(async () => remove?.click());
    expect(names()).toEqual(['Element', 'Spellbook / Atlas', 'Card type', 'Name']);
    expect(button('+ Cost')).toBeDefined();
  });

  it('cycles vertical and horizontal ordering on the same control', async () => {
    const control = container.querySelector<HTMLButtonElement>('[aria-label^="Card type direction"]');
    expect(control?.textContent).toBe('↓');
    for (const [arrow, direction, axis] of [
      ['→', 'asc', 'horizontal'], ['←', 'desc', 'horizontal'],
      ['↑', 'desc', 'vertical'], ['↓', 'asc', 'vertical'],
    ]) {
      await act(async () => control?.click());
      expect(control?.textContent).toBe(arrow);
      expect(control?.title).toMatch(/^Values increase /);
      expect(changed.mock.lastCall?.[0].steps.find((step) => step.field === 'type')).toMatchObject({ direction, axis });
    }
  });

  it('lets keyboard users reorder a focused step with the arrow keys', async () => {
    const name = button('Name');
    name.focus();
    await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    expect(names()).toEqual(['Element', 'Spellbook / Atlas', 'Name', 'Card type', 'Cost']);
    expect(document.activeElement).toBe(name);
  });

  it('shows automatic group width and uses a cap only after the slider changes', async () => {
    const slider = container.querySelector<HTMLInputElement>('[aria-label="Maximum columns per group"]');
    const output = container.querySelector('output');
    expect(output?.textContent).toBe('Auto');
    expect(slider?.getAttribute('aria-valuetext')).toBe('Automatic');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    expect(slider).toBeTruthy();
    await act(async () => {
      setValue?.call(slider, '4');
      slider?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(changed.mock.lastCall?.[0]).toMatchObject({ columns: 4, columnMode: 'limit' });
    expect(output?.textContent).toBe('Max 4');
    expect(slider?.getAttribute('aria-valuetext')).toBe('4 columns maximum');
    await act(async () => button('Auto').click());
    expect(output?.textContent).toBe('Auto');
    expect(changed.mock.lastCall?.[0]).toMatchObject({ columns: 4, columnMode: 'auto' });
  });

  it('enables selection width controls only with a Group or Clean step', async () => {
    await act(async () => root.render(<Harness key="selection" selection />));
    const slider = container.querySelector<HTMLInputElement>('[aria-label="Maximum columns per group"]');
    const controls = container.querySelector<HTMLElement>('.layout-editor-width-controls');
    expect(slider?.disabled).toBe(true);
    expect(controls?.title).toBe('Add a Group or Clean step to change spacing');
    await act(async () => button('+ Cost').click());
    expect(slider?.disabled).toBe(false);
    await act(async () => button('Group').click());
    expect(slider?.disabled).toBe(true);

    await act(async () => button('+ Clean').click());
    expect(slider?.disabled).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(slider, '4');
      slider?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const auto = button('Auto');
    expect(auto.disabled).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove Clean step"]')?.click());
    expect(slider?.disabled).toBe(true);
    expect(auto.disabled).toBe(true);
    await act(async () => button('Sort').click());
    expect(slider?.disabled).toBe(false);
    expect(auto.disabled).toBe(false);
  });

  it('pins Clean ahead of reorderable selection steps and gives it just a remove button', async () => {
    expect([...container.querySelectorAll('button')].some(entry => entry.textContent === '+ Clean')).toBe(false);
    await act(async () => root.render(<Harness key="selection" selection />));
    await act(async () => button('+ Cost').click());
    await act(async () => button('+ Clean').click());
    await act(async () => button('+ Name').click());
    const name = button('Name');
    await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(names()).toEqual(['Clean', 'Name', 'Cost']);
    const clean = container.querySelector('.layout-editor-node.clean');
    expect([...clean?.querySelectorAll('button') ?? []].map(entry => entry.getAttribute('aria-label'))).toEqual(['Remove Clean step']);
    expect(changed.mock.lastCall?.[0].clean).toBe(true);
    await act(async () => clean?.querySelector('button')?.click());
    expect(names()).toEqual(['Name', 'Cost']);
    expect(button('+ Clean')).toBeDefined();
    expect(changed.mock.lastCall?.[0]).not.toHaveProperty('clean');
  });

  it('enables selection Apply as soon as there is a layout operation', async () => {
    const onApply = vi.fn();
    let popover: CanvasLayoutPopover | undefined;
    await act(async () => {
      popover = new CanvasLayoutPopover({ label: 'Layout selected cards', layout: createSelectionLayout(), allowClean: true,
        anchor: () => ({ left: 100, top: 100, bottom: 120 }), onChange: vi.fn(), onClose: vi.fn(), onApply });
    });
    try {
      const dialog = document.querySelector('.canvas-layout-popover');
      const apply = dialog?.querySelector<HTMLButtonElement>('.canvas-layout-apply');
      expect(apply?.disabled).toBe(true);
      const clean = [...dialog?.querySelectorAll('button') ?? []].find(entry => entry.textContent === '+ Clean');
      await act(async () => clean?.click());
      expect(apply?.disabled).toBe(false);
      apply?.click();
      expect(onApply).toHaveBeenCalledOnce();
      await act(async () => dialog?.querySelector<HTMLButtonElement>('[aria-label="Remove Clean step"]')?.click());
      expect(apply?.disabled).toBe(true);
    } finally {
      await act(async () => popover?.destroy());
    }
  });
});
