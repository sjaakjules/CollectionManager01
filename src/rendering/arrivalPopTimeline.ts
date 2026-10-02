import type { InteractionEffectsSettings } from '@/data/interactionEffects';

export const ARRIVAL_FPS = 24;
export const ARRIVAL_VISUAL_DURATION_MS = 2700;
export const ARRIVAL_WORD_DURATION_MS = 935;
export const ARRIVAL_CARD_DURATION_MS = 1450;
export const ARRIVAL_RAY_DURATION_MS = 1060;
const TAU = Math.PI * 2;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (value: number) => 1 - (1 - clamp01(value)) ** 3;

/** Card-local pose: offsetY is a fraction of the card's untransformed height. */
export function getArrivalCardPose(elapsedMs: number, intensity: InteractionEffectsSettings['intensity'] = 'expressive') {
  if (elapsedMs >= ARRIVAL_CARD_DURATION_MS || intensity === 'off') return { scale: 1, rotation: 0, offsetY: 0 };
  const elapsed = Math.max(0, elapsedMs);
  const strength = intensity === 'subtle' ? 0.5 : 1;
  const settle = clamp01((elapsed - 140) / (ARRIVAL_CARD_DURATION_MS - 140));
  const envelope = (1 - settle) ** 3;
  const angle = elapsed < 140 ? -0.065 * easeOut(elapsed / 140) : -0.065 * Math.cos(settle * Math.PI * 6) * envelope;
  const scale = elapsed < 140 ? 0.84 + 0.23 * easeOut(elapsed / 140) : 1 + 0.07 * Math.cos(settle * Math.PI * 4) * envelope;
  const offsetY = elapsed < 140 ? -0.035 * easeOut(elapsed / 140) : -0.035 * Math.cos(settle * Math.PI * 4) * envelope;
  return { scale: 1 + (scale - 1) * strength, rotation: angle * strength, offsetY: offsetY * strength };
}

/** Distance from the centre to the actual portrait, landscape or stack edge. */
export function arrivalEdgeRadius(angle: number, width: number, height: number): number {
  return Math.min(Math.max(0, width) / (2 * Math.max(1e-8, Math.abs(Math.cos(angle)))),
    Math.max(0, height) / (2 * Math.max(1e-8, Math.abs(Math.sin(angle)))));
}

/** Heads travel out from the centre; delayed tails catch them and taper to zero. */
export function getArrivalRay(elapsedMs: number, index: number, width: number, height: number, detail: number, subtle = false) {
  const angle = index * TAU / 30 + Math.sin(index * 7.3) * 0.035;
  const birth = index % 5 * 14;
  const travel = 600 + index % 4 * 58;
  const lag = 190;
  const edge = arrivalEdgeRadius(angle, width, height) + 3 * detail;
  const extension = (subtle ? 31 : 48) * detail * (0.8 + 0.35 * (0.5 + Math.sin(index * 4.7) * 0.5));
  const reach = edge + extension;
  const age = elapsedMs - birth;
  const head = reach * easeOut(age / travel);
  const rawTail = reach * easeOut((age - lag) / travel);
  // The effect sits above cards, so only expose the travelling segment beyond art.
  const tail = Math.max(edge, rawTail);
  const length = Math.max(0, head - tail);
  const thickness = (index % 3 === 0 ? 3.8 : 2.2) * detail * Math.min(1, length / (extension * 0.48));
  return { angle, head, tail, rawTail, edge, thickness, visible: age >= 0 && length > 0.12 * detail, gold: index % 3 === 0 };
}

export interface ArrivalStar {
  angle: number;
  gap: number;
  size: number;
  birth: number;
  life: number;
  rotation: number;
}

/** Fixed, staggered pulses span the full visual tail independently of captions. */
export function createArrivalStars(): ArrivalStar[] {
  return Array.from({ length: 29 }, (_, index) => {
    const birth = index * 77;
    return {
      angle: index * 2.39996 + 0.25,
      gap: 12 + (index * 13 % 31),
      size: 5 + index * 7 % 6,
      birth,
      life: Math.min(ARRIVAL_VISUAL_DURATION_MS - birth, 580 + index * 43 % 170),
      rotation: (index % 5 - 2) * 0.13,
    };
  });
}

export function getArrivalStarPulse(star: ArrivalStar, elapsedMs: number): number {
  const age = elapsedMs - star.birth;
  if (age <= 0 || age >= star.life) return 0;
  return Math.sin(Math.PI * age / star.life) ** 0.8;
}

export function getArrivalWordPose(elapsedMs: number) {
  const elapsed = Math.max(0, elapsedMs);
  const progress = clamp01(elapsed / ARRIVAL_WORD_DURATION_MS);
  const scale = elapsed < 110 ? 0.7 + 0.43 * easeOut(elapsed / 110) : 1 + 0.13 * (1 - easeOut((elapsed - 110) / 170));
  return { visible: elapsedMs >= 0 && elapsed < ARRIVAL_WORD_DURATION_MS, alpha: 1 - clamp01((progress - 0.68) / 0.32), scale, rise: progress * 8 };
}
