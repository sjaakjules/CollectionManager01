/** Held drawings at 24 fps; the rest of the canvas keeps its normal frame rate. */
export const POOF_FPS = 24;
export const POOF_FRAME_COUNT = 42;
export const POOF_DURATION_MS = POOF_FRAME_COUNT * 1000 / POOF_FPS;
export const POOF_POP_FRAME = 12;

export function getPoofFrame(elapsedMs: number): number {
  return Math.min(POOF_FRAME_COUNT, Math.max(0, Math.floor(elapsedMs * POOF_FPS / 1000)));
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
