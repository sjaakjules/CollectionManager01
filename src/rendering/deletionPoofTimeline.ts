/** Drawings authored at 24 fps, with separate visual and lettering clocks. */
export const POOF_FPS = 24;
export const POOF_FRAME_COUNT = 42;
export const POOF_POP_FRAME = 12;
export const POOF_VISUAL_SPEED = 1.25;
export const POOF_WORD_SPEED = 0.5;
export const POOF_VISUAL_DURATION_MS = POOF_FRAME_COUNT * 1000 / (POOF_FPS * POOF_VISUAL_SPEED);
export const POOF_WORD_START_MS = POOF_POP_FRAME * 1000 / (POOF_FPS * POOF_VISUAL_SPEED);
export const POOF_WORD_FRAME_COUNT = POOF_FRAME_COUNT - POOF_POP_FRAME;
export const POOF_WORD_DURATION_MS = POOF_WORD_FRAME_COUNT * 1000 / (POOF_FPS * POOF_WORD_SPEED);
export const POOF_DURATION_MS = POOF_WORD_START_MS + POOF_WORD_DURATION_MS;

export function getPoofFrame(elapsedMs: number): number {
  return Math.min(POOF_FRAME_COUNT, Math.max(0, Math.floor(elapsedMs * POOF_FPS * POOF_VISUAL_SPEED / 1000)));
}

/** Lettering starts with the faster pop, then plays at half its original speed. */
export function getPoofWordFrame(elapsedMs: number): number {
  if (elapsedMs < POOF_WORD_START_MS) return -1;
  return Math.min(POOF_WORD_FRAME_COUNT, Math.floor((elapsedMs - POOF_WORD_START_MS) * POOF_FPS * POOF_WORD_SPEED / 1000));
}

export function getPoofPhase(frame: number): 'cloud' | 'pop' | 'sparkles' | 'finished' {
  return frame < POOF_POP_FRAME ? 'cloud' : frame < 16 ? 'pop' : frame < POOF_FRAME_COUNT ? 'sparkles' : 'finished';
}

export interface PoofStar {
  x: number;
  y: number;
  size: number;
  birth: number;
  life: number;
  rotation: number;
}

/** Randomness is chosen once per deletion, never re-rolled during rendering. */
export function createPoofStars(seed: number): PoofStar[] {
  let state = seed >>> 0;
  const random = () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 20 }, (_, index) => {
    const angle = index * 2.39996 + random() * 0.7;
    const radius = 48 + random() * 83;
    const birth = index < 3 ? POOF_POP_FRAME + index : POOF_POP_FRAME + 2 + Math.floor(random() * 17);
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * 0.83,
      size: 6 + random() * 10,
      birth,
      life: Math.min(POOF_FRAME_COUNT - birth, 7 + Math.floor(random() * 6)),
      rotation: (random() - 0.5) * 0.6,
    };
  });
}
