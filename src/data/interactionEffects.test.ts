import { describe, expect, it } from 'vitest';
import { ensureInteractionEffects, MangaEffectGate, MANGA_EFFECTS } from './interactionEffects';

describe('manga feedback policy', () => {
  it('normalizes old and malformed saves to a quiet, usable default', () => {
    for (const value of [null, undefined, {}, { intensity: 'loud', lettering: 3 }]) {
      expect(ensureInteractionEffects(value)).toEqual({ intensity: 'subtle', lettering: 'both' });
    }
    expect(ensureInteractionEffects({ intensity: 'off', lettering: 'none' })).toEqual({ intensity: 'off', lettering: 'none' });
  });
  it('never shows text on routine gestures, even in expressive mode', () => {
    const gate = new MangaEffectGate();
    for (const kind of Object.keys(MANGA_EFFECTS) as Array<keyof typeof MANGA_EFFECTS>) {
      if (MANGA_EFFECTS[kind].frequent) expect(gate.accept(kind, 1000, { intensity: 'expressive', lettering: 'both' }, false)).toEqual({ words: false });
    }
  });
  it('limits repeated gestures and shares a caption cooldown across action types', () => {
    const gate = new MangaEffectGate(); const settings = ensureInteractionEffects(null);
    expect(gate.accept('attach', 0, settings, false)).toEqual({ words: true });
    expect(gate.accept('attach', 100, settings, false)).toBeNull();
    expect(gate.accept('detach', 300, settings, false)).toEqual({ words: false });
    expect(gate.accept('reveal', 2400, settings, false)).toEqual({ words: true });
  });
  it('honors off and reduced motion without consuming the caption budget', () => {
    const gate = new MangaEffectGate();
    expect(gate.accept('reveal', 0, { intensity: 'off', lettering: 'both' }, false)).toBeNull();
    expect(gate.accept('reveal', 0, ensureInteractionEffects(null), true)).toBeNull();
    expect(gate.accept('reveal', 1, ensureInteractionEffects(null), false)?.words).toBe(true);
  });
});
