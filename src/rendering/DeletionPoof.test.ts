// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Graphics, Text } from 'pixi.js';
import { DeletionPoof } from './DeletionPoof';
import { POOF_DURATION_MS, POOF_VISUAL_DURATION_MS, POOF_WORD_START_MS } from './deletionPoofTimeline';

const bounds = { left: 0, top: 20, right: 160, bottom: 240 };
const effects: DeletionPoof[] = [];
function createEffect(zoom = 1, lettering: 'both' | 'english' | 'none' = 'both') {
  const effect = new DeletionPoof(bounds, zoom, 12345, lettering);
  effects.push(effect);
  return effect;
}
function words(effect: DeletionPoof) {
  const japanese = effect.root.children.find((child): child is Text => child instanceof Text && child.text === 'ボフッ');
  const english = effect.root.children.find((child): child is Text => child instanceof Text && child.text === 'pooft');
  if (!japanese || !english) throw new Error('Expected both poof captions');
  return { japanese, english };
}
afterEach(() => {
  for (const effect of effects.splice(0)) effect.destroy();
  vi.restoreAllMocks();
});

describe('deletion poof renderer', () => {
  it('centers the effect and never intercepts another canvas interaction', () => {
    const effect = createEffect();
    expect(effect.root.position.x).toBe(80);
    expect(effect.root.position.y).toBe(130);
    expect(effect.root.eventMode).toBe('none');
    expect(effect.root.interactiveChildren).toBe(false);
  });

  it('keeps the effect readable but bounded at overview and close-up zoom', () => {
    for (const zoom of [0.03, 0.5, 1, 4]) {
      const effect = createEffect(zoom);
      const apparentSize = effect.root.scale.x * 300 * zoom;
      expect(apparentSize).toBeGreaterThanOrEqual(140);
      expect(apparentSize).toBeLessThanOrEqual(280);
    }
  });

  it('reuses its drawing objects and holds the same drawing between animation frames', () => {
    const effect = createEffect();
    const children = [...effect.root.children];
    const clear = vi.spyOn(Graphics.prototype, 'clear');
    effect.update(16);
    effect.update(33);
    expect(clear).not.toHaveBeenCalled();
    effect.update(34);
    expect(clear).toHaveBeenCalled();
    clear.mockClear();
    effect.update(50);
    expect(clear).not.toHaveBeenCalled();
    effect.update(1200);
    expect(effect.root.children).toEqual(children);
  });

  it('reveals both captions at the pop, moves them outward, and fades them above the stars', () => {
    const effect = createEffect();
    const { japanese, english } = words(effect);
    expect(japanese.visible).toBe(false);
    expect(english.visible).toBe(false);
    effect.update(POOF_WORD_START_MS);
    expect(japanese.visible).toBe(true);
    expect(english.visible).toBe(true);
    expect(japanese.alpha).toBeGreaterThan(0);
    const start = { japaneseX: japanese.x, japaneseY: japanese.y, englishX: english.x, englishY: english.y, scale: japanese.scale.x };
    effect.update(1000);
    expect(japanese.x).toBeLessThan(start.japaneseX);
    expect(japanese.y).toBeLessThan(start.japaneseY);
    expect(english.x).toBeGreaterThan(start.englishX);
    expect(english.y).toBeGreaterThan(start.englishY);
    expect(japanese.scale.x).toBeGreaterThan(start.scale);
    expect(effect.root.children.slice(-2)).toEqual([japanese, english]);
    effect.update(POOF_DURATION_MS - 1);
    expect(japanese.alpha).toBeCloseTo(0);
    expect(english.alpha).toBeCloseTo(0);
  });

  it('lets text linger after clearing the visual tail without redrawing finished graphics', () => {
    const effect = createEffect();
    const { japanese, english } = words(effect);
    const graphics = effect.root.children.filter((child): child is Graphics => child instanceof Graphics);
    const clear = vi.spyOn(Graphics.prototype, 'clear');
    expect(effect.update(POOF_VISUAL_DURATION_MS)).toBe(true);
    expect(clear).toHaveBeenCalledTimes(graphics.length);
    expect(graphics.every((graphic) => graphic.context.instructions.length === 0)).toBe(true);
    expect(japanese.alpha).toBe(1);
    expect(english.alpha).toBe(1);
    const startX = english.x;
    clear.mockClear();
    expect(effect.update(2200)).toBe(true);
    expect(clear).not.toHaveBeenCalled();
    expect(english.x).toBeGreaterThan(startX);
    expect(english.alpha).toBeGreaterThan(0);
    expect(english.alpha).toBeLessThan(1);
    expect(effect.root.destroyed).toBe(false);
    expect(effect.update(POOF_DURATION_MS)).toBe(false);
    expect(effect.root.destroyed).toBe(true);
  });

  it('ends at the visual tail when lettering is disabled', () => {
    const effect = createEffect(1, 'none');
    const { japanese, english } = words(effect);
    expect(effect.update(POOF_VISUAL_DURATION_MS - 1)).toBe(true);
    expect(japanese.visible).toBe(false);
    expect(english.visible).toBe(false);
    expect(effect.update(POOF_VISUAL_DURATION_MS)).toBe(false);
    expect(effect.root.destroyed).toBe(true);
  });

  it('disposes all graphics and captions once even after a background time jump', () => {
    const effect = createEffect();
    const children = [...effect.root.children];
    const destroy = vi.spyOn(effect.root, 'destroy');
    expect(effect.update(60_000)).toBe(false);
    expect(effect.root.destroyed).toBe(true);
    expect(children.every((child) => child.destroyed)).toBe(true);
    expect(effect.update(60_016)).toBe(false);
    effect.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
