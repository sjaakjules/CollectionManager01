/** Shared guest/account preference; animations never change card or board data. */
export interface InteractionEffectsSettings {
  intensity: 'off' | 'subtle' | 'expressive';
  lettering: 'both' | 'english' | 'none';
}

export const DEFAULT_INTERACTION_EFFECTS: InteractionEffectsSettings = { intensity: 'expressive', lettering: 'both' };

export function ensureInteractionEffects(value: unknown): InteractionEffectsSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    intensity: input.intensity === 'off' || input.intensity === 'expressive' ? input.intensity : 'subtle',
    lettering: input.lettering === 'english' || input.lettering === 'none' ? input.lettering : 'both',
  };
}

export const MANGA_EFFECTS = {
  pickup: { japanese: 'スッ', english: 'lift', name: 'Pick up', duration: 250, frequent: true },
  place: { japanese: 'トン', english: 'tap', name: 'Put down', duration: 250, frequent: true },
  snap: { japanese: 'ピタッ', english: 'snap', name: 'Align', duration: 292, frequent: true },
  select: { japanese: '', english: '', name: 'Select together', duration: 292, frequent: true },
  stack: { japanese: 'トン', english: 'tap', name: 'Add to stack', duration: 250, frequent: true },
  arrive: { japanese: 'キラッ', english: 'glint', name: 'New card', duration: 458, frequent: true },
  label: { japanese: 'ペタッ', english: 'stick', name: 'Place label', duration: 583, frequent: false },
  attach: { japanese: 'カチッ', english: 'click', name: 'Join label', duration: 583, frequent: false },
  detach: { japanese: 'ペリッ', english: 'peel', name: 'Detach', duration: 583, frequent: false },
  reveal: { japanese: 'ジャン', english: 'ta-da!', name: 'Add deck', duration: 625, frequent: false },
  hide: { japanese: 'スッ', english: 'away', name: 'Put away', duration: 292, frequent: true },
  filter: { japanese: 'スッ', english: 'sift', name: 'Filter', duration: 250, frequent: true },
  sort: { japanese: 'パラパラ', english: 'riffle', name: 'Arrange cards', duration: 458, frequent: false },
  focus: { japanese: 'シーン', english: 'quiet…', name: 'Focus', duration: 583, frequent: false },
  inspect: { japanese: 'ジーッ', english: 'look…', name: 'Inspect', duration: 458, frequent: false },
  restore: { japanese: 'パッ', english: 'back!', name: 'Undo removal', duration: 583, frequent: false },
  delete: { japanese: 'ボフッ', english: 'pooft', name: 'Remove card', duration: 500, frequent: false },
} as const;
export type MangaEffectKind = keyof typeof MANGA_EFFECTS;
export type CanvasGestureCommand = 'focus' | 'new' | 'tidy' | 'peek' | 'compare' | 'undo' | 'close-inspection';
export const MANGA_FPS = 24;
export const MAX_MANGA_EFFECTS = 8;
export const LETTERING_COOLDOWN_MS = 2400;

/** One batch = one gesture. Rapid repetitions never produce a wall of captions. */
export class MangaEffectGate {
  private lastWord = -Infinity;
  private lastEffect = new Map<MangaEffectKind, number>();

  accept(kind: MangaEffectKind, now: number, settings: InteractionEffectsSettings, reducedMotion: boolean): { words: boolean } | null {
    if (settings.intensity === 'off' || reducedMotion) return null;
    const last = this.lastEffect.get(kind) ?? -Infinity;
    if (now - last < (MANGA_EFFECTS[kind].frequent ? 90 : 180)) return null;
    this.lastEffect.set(kind, now);
    const words = !MANGA_EFFECTS[kind].frequent && settings.lettering !== 'none' && now - this.lastWord >= LETTERING_COOLDOWN_MS;
    if (words) this.lastWord = now;
    return { words };
  }
}
