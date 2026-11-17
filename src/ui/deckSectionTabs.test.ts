// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckSectionTabs } from './deckSectionTabs';
import type { DeckSectionLayoutTab } from '@/canvas/deckSectionLayouts';
import { required } from '@/utils/required';
import { CANVAS_LABEL_FONT_SIZE } from '@/rendering/deckHeadingStyle';

describe('deck layout tab controls', () => {
  let host: HTMLDivElement;
  let tabs: DeckSectionTabs;
  const callbacks = { select: vi.fn(), edit: vi.fn(), toggleMode: vi.fn() };
  const rows: DeckSectionLayoutTab[] = [
    { id: 'default', name: 'Default' }, { id: 'cost', name: 'Cost' }, { id: 'threshold', name: 'Threshold' },
  ];
  const sync = (activeId = 'cost', minX?: number) => tabs.sync([{ areaId: 'deck', section: 'spellbook', activeId, minX, tabs: rows,
    bounds: { x: 0, y: 100, width: 600, height: 60 } }]);
  const group = () => required(host.querySelector<HTMLElement>('[aria-label="Spellbook layouts"]'));
  const more = () => required(host.querySelector<HTMLButtonElement>('.deck-section-layout-more'));
  const overflow = () => required(host.querySelector<HTMLElement>('.deck-section-layout-overflow'));
  const inlineNames = () => [...host.querySelectorAll('.deck-section-layout-list .deck-section-layout-name')].map(name => name.textContent);
  const pose = () => {
    const values = required(group().style.transform.match(/translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/));
    return { x: Number(values[1]), y: Number(values[2]), zoom: Number(values[3]) };
  };
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(callbacks).forEach(callback => callback.mockReset());
    const canvas: { getContext(context: '2d'): CanvasRenderingContext2D | null } = HTMLCanvasElement.prototype;
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      measureText: (name: string) => ({ width: name.length * CANVAS_LABEL_FONT_SIZE / 2 }),
    } as CanvasRenderingContext2D);
    host = document.createElement('div');
    document.body.append(host);
    tabs = new DeckSectionTabs(host, callbacks);
    sync();
    tabs.position(point => point, { width: 1000, height: 700 }, 1, false);
  });
  afterEach(() => { tabs.destroy(); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('shows the editable layout name followed by its symbol inside one tab', () => {
    const cost = tabs.getButton('deck', 'spellbook', 'cost');
    const standard = tabs.getButton('deck', 'spellbook', 'default');
    expect(cost?.textContent).toBe('Cost');
    expect(cost?.getAttribute('aria-pressed')).toBe('true');
    expect(cost?.parentElement?.classList.contains('is-active')).toBe(true);
    expect(cost?.parentElement?.textContent).toBe('Cost@');
    expect(cost?.nextElementSibling?.textContent).toBe('@');
    expect(standard?.nextElementSibling?.textContent).toBe('ⓒ');
  });

  it('a single click changes tabs; a second click edits without first moving the tab', () => {
    const cost = tabs.getButton('deck', 'spellbook', 'cost');
    cost?.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    vi.advanceTimersByTime(100);
    cost?.dispatchEvent(new MouseEvent('click', { detail: 2 }));
    vi.runAllTimers();
    expect(callbacks.select).not.toHaveBeenCalled();
    expect(callbacks.edit).toHaveBeenCalledWith('deck', 'spellbook', 'cost', cost);
    cost?.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    vi.advanceTimersByTime(300);
    expect(callbacks.select).toHaveBeenCalledWith('deck', 'spellbook', 'cost');
  });

  it('double-clicking the symbol toggles mode without starting a rename', () => {
    const cost = tabs.getButton('deck', 'spellbook', 'cost');
    cost?.nextElementSibling?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(callbacks.toggleMode).toHaveBeenCalledWith('deck', 'spellbook', 'cost', cost);
    expect(callbacks.edit).not.toHaveBeenCalled();
  });

  it('honours a slower native double-click without editing twice for a fast one', () => {
    const cost = tabs.getButton('deck', 'spellbook', 'cost');
    cost?.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    vi.advanceTimersByTime(300);
    cost?.dispatchEvent(new MouseEvent('click', { detail: 2 }));
    cost?.dispatchEvent(new MouseEvent('dblclick'));
    expect(callbacks.edit).toHaveBeenCalledOnce();
    callbacks.edit.mockClear();
    cost?.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    cost?.dispatchEvent(new MouseEvent('click', { detail: 2 }));
    cost?.dispatchEvent(new MouseEvent('dblclick'));
    expect(callbacks.edit).toHaveBeenCalledOnce();
  });

  it('keeps controls stable across saves and cancels pending clicks on destruction', () => {
    const cost = tabs.getButton('deck', 'spellbook', 'cost');
    sync();
    expect(tabs.getButton('deck', 'spellbook', 'cost')).toBe(cost);
    cost?.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    tabs.destroy();
    vi.runAllTimers();
    expect(callbacks.select).not.toHaveBeenCalled();
    expect(host.childElementCount).toBe(0);
  });

  it('scales the whole strip like labels while preserving its canvas dimensions, inset, and visible tabs', () => {
    const layout = group();
    const threshold = required(tabs.getButton('deck', 'spellbook', 'threshold')?.parentElement);
    expect(layout.style.getPropertyValue('--layout-tab-height')).toBe('22px');
    expect(layout.style.getPropertyValue('--layout-tab-font-size')).toBe(`${CANVAS_LABEL_FONT_SIZE}px`);
    expect(pose()).toEqual({ x: 348, y: 103, zoom: 1 });
    expect(layout.style.width).toBe('249px');
    expect(threshold.style.getPropertyValue('--layout-tab-width')).toBe('89px');
    expect(inlineNames()).toEqual(['Default', 'Cost', 'Threshold']);

    for (const zoom of [0.15, 0.4, 0.6, 2]) {
      tabs.position(({ x, y }) => ({ x: 30 + x * zoom, y: 15 + y * zoom }), { width: 1400, height: 700 }, zoom, false);
      expect(layout.hidden).toBe(false);
      expect(pose().x).toBeCloseTo(30 + 348 * zoom);
      expect(pose().y).toBeCloseTo(15 + 103 * zoom);
      expect(pose().zoom).toBe(zoom);
      expect(layout.style.getPropertyValue('--layout-tab-height')).toBe('22px');
      expect(layout.style.getPropertyValue('--layout-tab-font-size')).toBe(`${CANVAS_LABEL_FONT_SIZE}px`);
      expect(layout.style.width).toBe('249px');
      expect(threshold.style.getPropertyValue('--layout-tab-width')).toBe('89px');
      expect(inlineNames()).toEqual(['Default', 'Cost', 'Threshold']);
      expect(tabs.getReservedWidth('deck', 'spellbook')).toBe(252);
    }
  });

  it('keeps the active tab whole and moves other complete controls into overflow', () => {
    const threshold = required(tabs.getButton('deck', 'spellbook', 'threshold'));
    let activeId = 'cost';
    const position = () => {
      tabs.sync([{ areaId: 'deck', section: 'spellbook', activeId,
        tabs: rows, bounds: { x: 0, y: 100, width: 151, height: 60 } }]);
      tabs.position(point => point, { width: 1000, height: 700 }, 1, false);
    };
    position();
    expect(inlineNames()).toEqual(['Cost']);
    expect(overflow().contains(threshold)).toBe(true);
    expect(threshold.textContent).toBe('Threshold');
    expect(overflow().hidden).toBe(true);
    expect(more().hidden).toBe(false);
    expect(tabs.getReservedWidth('deck', 'spellbook')).toBe(107);
    expect(pose()).toEqual({ x: 44, y: 103, zoom: 1 });

    more().click();
    expect(overflow().hidden).toBe(false);
    expect(more().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toBe('Default');
    threshold.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(callbacks.edit).toHaveBeenCalledWith('deck', 'spellbook', 'threshold', threshold);
    required(threshold.nextElementSibling as HTMLButtonElement).click();
    expect(callbacks.toggleMode).toHaveBeenCalledWith('deck', 'spellbook', 'threshold', threshold);

    callbacks.select.mockImplementationOnce(() => { activeId = 'threshold'; position(); });
    threshold.click();
    expect(inlineNames()).toEqual(['Threshold']);
    expect(overflow().hidden).toBe(true);
    expect(document.activeElement).toBe(threshold);
  });

  it('stays at the section corner instead of sliding along the viewport edge', () => {
    tabs.position(({ x, y }) => ({ x: x + 800, y }), { width: 1000, height: 700 }, 1, false);
    expect(group().hidden).toBe(true);
    expect(tabs.getReservedWidth('deck', 'spellbook')).toBe(252);

    tabs.position(({ x, y }) => ({ x: x + 200, y }), { width: 1000, height: 700 }, 1, false);
    expect(group().hidden).toBe(false);
    expect(pose()).toEqual({ x: 548, y: 103, zoom: 1 });
    expect(inlineNames()).toEqual(['Default', 'Cost', 'Threshold']);
  });

  it('exposes all tabs in overflow when the heading leaves no room for a whole tab', () => {
    sync('cost', 540);
    tabs.position(({ x, y }) => ({ x: x * 0.8, y: y * 0.8 }), { width: 1000, height: 700 }, 0.8, false);
    expect(group().hidden).toBe(false);
    expect(inlineNames()).toEqual([]);
    expect(tabs.getReservedWidth('deck', 'spellbook')).toBe(50);
    expect(more().getAttribute('aria-label')).toContain('Cost selected');
    more().click();
    const buttons = [...overflow().querySelectorAll('.deck-section-layout-name')];
    expect(buttons.map(button => button.textContent)).toEqual(['Default', 'Cost', 'Threshold']);
    required(buttons[0]).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overflow().hidden).toBe(true);
    expect(document.activeElement).toBe(more());
  });
});
