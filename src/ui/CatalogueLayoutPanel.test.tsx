// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogueLayoutPanel } from './CatalogueLayoutPanel';
import { createDefaultCatalogueLayout } from '@/data/catalogueLayout';

let root: Root;
let container: HTMLDivElement;
const changed = vi.fn();
function Harness() {
  const [layout, setLayout] = useState(createDefaultCatalogueLayout);
  return <CatalogueLayoutPanel layout={layout} onChange={(next) => { changed(next); setLayout(next); }} visibleCount={10} totalCount={100} />;
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
  return [...container.querySelectorAll('.catalogue-layout-node-title')].map((entry) => entry.textContent);
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
    expect(name.closest('.catalogue-layout-node')?.classList.contains('group')).toBe(true);
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
});
