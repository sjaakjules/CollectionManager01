// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Graphics, Text, Container } from 'pixi.js';
import { MangaEffect } from './MangaEffect';
import { MANGA_EFFECTS, ensureInteractionEffects } from '@/data/interactionEffects';

describe('original manga drawing sequences', () => {
  it('finishes every sequence, frees resources and never intercepts the pointer', () => {
    for (const kind of Object.keys(MANGA_EFFECTS) as Array<keyof typeof MANGA_EFFECTS>) {
      const effect = new MangaEffect(kind, { left: 0, top: 0, right: 100, bottom: 140 }, 0.5, ensureInteractionEffects(null), true);
      expect(effect.root.eventMode).toBe('none');
      expect(effect.root.interactiveChildren).toBe(false);
      for (let elapsed = 0; elapsed < MANGA_EFFECTS[kind].duration; elapsed += 42) expect(effect.update(elapsed, 0.5)).toBe(true);
      expect(effect.update(60000, 0.5)).toBe(false);
      expect(effect.root.destroyed).toBe(true);
      expect(effect.update(60001, 0.5)).toBe(false);
    }
  });
  it('holds drawings at 24fps but keeps the envelope attached when the camera zooms or cards move', () => {
    const effect = new MangaEffect('attach', { left: 0, top: 0, right: 100, bottom: 140 }, 1, ensureInteractionEffects(null), true);
    const clear = vi.spyOn(Graphics.prototype, 'clear');
    effect.update(16, 1);
    expect(clear).not.toHaveBeenCalled();
    effect.update(32, 0.1, { left: 100, top: 200, right: 200, bottom: 340 });
    expect(clear).toHaveBeenCalledOnce();
    expect(effect.root.position.x).toBe(150);
    expect(effect.root.position.y).toBe(270);
    expect(effect.root.scale.x * 0.1).toBeCloseTo(1);
    effect.update(42, 1);
    expect(clear).toHaveBeenCalledTimes(2);
    effect.destroy(); clear.mockRestore();
  });
  it('omits Japanese and all lettering according to the saved setting', () => {
    for (const lettering of ['both', 'english', 'none'] as const) {
      const effect = new MangaEffect('attach', { left: 0, top: 0, right: 100, bottom: 140 }, 1, { intensity: 'subtle', lettering }, true);
      const words = effect.root.children[1] as Container;
      const captions = words.children.filter((child): child is Text => child instanceof Text).map(child => child.text);
      expect(captions).toEqual(lettering === 'both' ? ['カチッ', 'click'] : lettering === 'english' ? ['click'] : []);
      effect.destroy();
    }
  });
});
