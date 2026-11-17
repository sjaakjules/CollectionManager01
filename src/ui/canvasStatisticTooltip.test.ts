// @vitest-environment jsdom
import { required } from '@/utils/required';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasStatisticTooltip } from './canvasStatisticTooltip';

describe('canvas statistic tooltip', () => {
  let host: HTMLDivElement;
  let tooltip: CanvasStatisticTooltip;
  const point = { x: 60, y: 80 };
  const findTooltip = () => required(host.querySelector<HTMLElement>('[role="tooltip"]'));

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    tooltip = new CanvasStatisticTooltip(host);
  });

  afterEach(() => {
    tooltip.destroy();
    host.remove();
    vi.restoreAllMocks();
  });

  it('creates a single read-only tooltip with plain text and preserves focus', () => {
    const button = document.createElement('button');
    host.append(button);
    button.focus();
    expect(host.querySelector('[role="tooltip"]')).toBeNull();

    const text = '<a href="#">3 Water thresholds</a>';
    tooltip.show(text, point);
    const element = findTooltip();
    expect(element.textContent).toBe(text);
    expect(element.childElementCount).toBe(0);
    expect(element.hidden).toBe(false);
    expect(document.activeElement).toBe(button);

    tooltip.show('2 Earth thresholds', point);
    expect(findTooltip()).toBe(element);
    expect(element.textContent).toBe('2 Earth thresholds');
  });

  it('keeps the tooltip inside the viewport near the bottom and right edges', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(160);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(24);
    tooltip.show('3 Water thresholds', { x: window.innerWidth - 2, y: window.innerHeight - 2 });
    const element = findTooltip();
    expect(element.style.left).toBe(`${window.innerWidth - 168}px`);
    expect(element.style.top).toBe(`${window.innerHeight - 38}px`);

    tooltip.show('3 Water thresholds', { x: -40, y: -40 });
    expect(element.style.left).toBe('8px');
    expect(element.style.top).toBe('8px');
  });

  it.each([
    ['pointer down', () => host.dispatchEvent(new Event('pointerdown', { bubbles: true }))],
    ['wheel', () => host.dispatchEvent(new Event('wheel', { bubbles: true }))],
    ['Escape', () => host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))],
    ['window blur', () => window.dispatchEvent(new Event('blur'))],
    ['window resize', () => window.dispatchEvent(new Event('resize'))],
  ])('dismisses on %s', (_, dismiss) => {
    tooltip.show('3 Water thresholds', point);
    dismiss();
    expect(findTooltip().hidden).toBe(true);
  });

  it('can be hidden and shown again, and removes its element and listeners on destruction', () => {
    const removeListener = vi.spyOn(window, 'removeEventListener');
    tooltip.show('3 Water thresholds', point);
    const element = findTooltip();
    tooltip.hide();
    expect(element.hidden).toBe(true);
    tooltip.show('3 Water thresholds', point);
    expect(element.hidden).toBe(false);

    removeListener.mockClear();
    tooltip.destroy();
    expect(element.isConnected).toBe(false);
    expect(removeListener.mock.calls.map(([event]) => event)).toEqual(['pointerdown', 'wheel', 'keydown', 'blur', 'resize']);
    tooltip.show('3 Water thresholds', point);
    expect(host.childElementCount).toBe(0);
  });
});
