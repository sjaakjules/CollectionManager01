// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Text } from 'pixi.js';
import { ArrivalPop } from './ArrivalPop';
import { ARRIVAL_VISUAL_DURATION_MS, ARRIVAL_WORD_DURATION_MS } from './arrivalPopTimeline';
import type { InteractionEffectsSettings } from '@/data/interactionEffects';

const bounds = { left: 20, top: 30, right: 170, bottom: 240 };
const effects: ArrivalPop[] = [];
function createEffect(settings: InteractionEffectsSettings = { intensity: 'expressive', lettering: 'both' }, full = true) {
  const effect = new ArrivalPop(bounds, 1, settings, full);
  effects.push(effect);
  return effect;
}
function parts(effect: ArrivalPop) {
  const rays = effect.root.children.find((child): child is Graphics => child instanceof Graphics && child.label === 'arrival-rays');
  const stars = effect.root.children.find((child): child is Graphics => child instanceof Graphics && child.label === 'arrival-stars');
  const words = effect.root.children.find((child): child is Container => child.label === 'arrival-words');
  if (!rays || !stars || !words) throw new Error('Missing arrival drawings');
  return { rays, stars, words };
}
afterEach(() => { for (const effect of effects.splice(0)) effect.destroy(); vi.restoreAllMocks(); });

describe('arrival renderer', () => {
  it('follows changing stack bounds and zoom, keeping lettering outside the current upper right', () => {
    const effect = createEffect();
    const { words } = parts(effect);
    expect(effect.root.position.x).toBe(95);
    expect(effect.root.position.y).toBe(135);
    expect(effect.root.eventMode).toBe('none');
    expect(effect.root.interactiveChildren).toBe(false);
    for (const [width, height] of [[150, 210], [210, 150]] as const) for (let count = 1; count <= 6; count++) for (const zoom of [0.03, 0.5, 1, 4]) {
      const stack = { left: 50, top: 60, right: 50 + width + (count - 1) * 18, bottom: 60 + height + (count - 1) * 6 };
      effect.update(333, zoom, stack);
      expect(effect.root.x).toBe((stack.left + stack.right) / 2);
      expect(effect.root.y).toBe((stack.top + stack.bottom) / 2);
      expect(effect.root.scale.x * zoom).toBeCloseTo(1);
      const wordX = effect.root.x + words.x / zoom;
      const wordY = effect.root.y + words.y / zoom;
      expect(wordX).toBeGreaterThan(stack.right);
      expect(wordY).toBeLessThan(stack.top);
      expect(words.scale.x).toBeLessThanOrEqual(1.42);
    }
  });

  it('holds frames and redraws only a changing envelope before the visual tail ends', () => {
    const effect = createEffect();
    const { rays, stars } = parts(effect);
    const children = [...effect.root.children];
    const clearRays = vi.spyOn(rays, 'clear');
    const clearStars = vi.spyOn(stars, 'clear');
    effect.update(16, 1); effect.update(33, 1);
    expect(clearRays).not.toHaveBeenCalled(); expect(clearStars).not.toHaveBeenCalled();
    effect.update(42, 1);
    expect(clearRays).toHaveBeenCalledOnce(); expect(clearStars).toHaveBeenCalledOnce();
    effect.update(43, 1, { ...bounds, right: 195 });
    expect(clearRays).toHaveBeenCalledTimes(2); expect(clearStars).toHaveBeenCalledTimes(2);
    effect.update(1200, 1);
    expect(rays.context.instructions).toHaveLength(0);
    clearRays.mockClear();
    effect.update(1500, 1); effect.update(2000, 0.5);
    expect(clearRays).not.toHaveBeenCalled();
    expect(effect.root.children).toEqual(children);
  });

  it('refreshes the same words immediately while rays and stars retain their original clocks', () => {
    const effect = createEffect();
    const { rays, stars, words } = parts(effect);
    const children = [...words.children];
    effect.update(1200, 1);
    expect(words.visible).toBe(false);
    expect(rays.context.instructions).toHaveLength(0);
    const clear = vi.spyOn(Graphics.prototype, 'clear');
    effect.refreshWords(1200);
    expect(words.visible).toBe(true);
    expect(words.alpha).toBe(1);
    expect(clear).not.toHaveBeenCalled();
    expect(words.children).toEqual(children);
    effect.update(1800, 1);
    effect.refreshWords(2600);
    effect.update(ARRIVAL_VISUAL_DURATION_MS, 1);
    expect(rays.context.instructions).toHaveLength(0);
    expect(stars.context.instructions).toHaveLength(0);
    expect(words.visible).toBe(true);
    clear.mockClear();
    effect.update(3000, 2, { ...bounds, bottom: 270 });
    expect(clear).not.toHaveBeenCalled();
    expect(effect.update(2600 + ARRIVAL_WORD_DURATION_MS - 1, 1)).toBe(true);
    expect(effect.update(2600 + ARRIVAL_WORD_DURATION_MS, 1)).toBe(false);
  });

  it.each(['both', 'english', 'none'] as const)('honours %s lettering and words-only repeats', (lettering) => {
    const effect = createEffect({ intensity: 'expressive', lettering }, false);
    if (lettering === 'none') { expect(effect.root.destroyed).toBe(true); return; }
    const { rays, stars, words } = parts(effect);
    const text = words.children.filter((child): child is Text => child instanceof Text).map((child) => child.text);
    expect(text).toEqual(lettering === 'both' ? ['ポンッ', 'POP!'] : ['POP!']);
    effect.update(500, 1);
    expect(rays.context.instructions).toHaveLength(0);
    expect(stars.context.instructions).toHaveLength(0);
    expect(effect.update(ARRIVAL_WORD_DURATION_MS, 1)).toBe(false);
  });

  it('finishes the independent visual tail with lettering disabled', () => {
    const effect = createEffect({ intensity: 'subtle', lettering: 'none' });
    const { words } = parts(effect);
    expect(words.children).toHaveLength(0);
    expect(effect.update(ARRIVAL_VISUAL_DURATION_MS - 1, 1)).toBe(true);
    expect(effect.update(ARRIVAL_VISUAL_DURATION_MS, 1)).toBe(false);
  });

  it('disposes all children once after a time jump', () => {
    const effect = createEffect();
    const children = [...effect.root.children];
    const destroy = vi.spyOn(effect.root, 'destroy');
    expect(effect.update(60_000, 1)).toBe(false);
    effect.refreshWords(60_000);
    effect.destroy();
    expect(effect.update(60_001, 1)).toBe(false);
    expect(children.every((child) => child.destroyed)).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
  });
});
