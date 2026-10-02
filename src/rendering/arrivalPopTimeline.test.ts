import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_CARD_DURATION_MS, ARRIVAL_RAY_DURATION_MS, ARRIVAL_VISUAL_DURATION_MS, ARRIVAL_WORD_DURATION_MS,
  arrivalEdgeRadius, createArrivalStars, getArrivalCardPose, getArrivalRay, getArrivalStarPulse, getArrivalWordPose,
} from './arrivalPopTimeline';

describe('arrival motion', () => {
  it('alternates a small wobble, overshoots, then settles exactly to the original card pose', () => {
    expect(getArrivalCardPose(0).scale).toBeLessThan(1);
    expect(getArrivalCardPose(140).scale).toBeGreaterThan(1);
    const rotations = [140, 360, 580, 800].map((age) => getArrivalCardPose(age).rotation);
    expect(rotations[0]).toBeLessThan(0);
    expect(rotations[1]).toBeGreaterThan(0);
    expect(rotations[2]).toBeLessThan(0);
    expect(rotations[3]).toBeGreaterThan(0);
    expect(rotations.map(Math.abs)).toEqual([...rotations.map(Math.abs)].sort((a, b) => b - a));
    for (const age of [ARRIVAL_CARD_DURATION_MS, 60_000]) expect(getArrivalCardPose(age)).toEqual({ scale: 1, rotation: 0, offsetY: 0 });
    expect(Math.abs(getArrivalCardPose(140, 'subtle').rotation)).toBeLessThan(Math.abs(getArrivalCardPose(140).rotation));
    expect(getArrivalCardPose(140, 'off')).toEqual({ scale: 1, rotation: 0, offsetY: 0 });
  });

  it.each([['spell', 150, 210], ['site', 210, 150]] as const)('travels beyond the actual %s stack envelope for 1–6 cards', (_, width, height) => {
    for (let count = 1; count <= 6; count++) {
      const stackWidth = width + (count - 1) * 18;
      const stackHeight = height + (count - 1) * 6;
      expect(arrivalEdgeRadius(0, stackWidth, stackHeight)).toBeCloseTo(stackWidth / 2);
      expect(arrivalEdgeRadius(Math.PI / 2, stackWidth, stackHeight)).toBeCloseTo(stackHeight / 2);
      for (let index = 0; index < 30; index++) {
        const initial = getArrivalRay(0, index, stackWidth, stackHeight, 1);
        const early = getArrivalRay(350, index, stackWidth, stackHeight, 1);
        const late = getArrivalRay(600, index, stackWidth, stackHeight, 1);
        expect(initial.head).toBe(0);
        expect(late.head).toBeGreaterThan(early.head);
        expect(late.rawTail).toBeGreaterThan(early.rawTail);
        expect(early.tail).toBeGreaterThanOrEqual(early.edge);
        expect(late.tail).toBeGreaterThanOrEqual(late.edge);
        expect(early.visible).toBe(true);
        expect(getArrivalRay(ARRIVAL_RAY_DURATION_MS, index, stackWidth, stackHeight, 1).visible).toBe(false);
      }
    }
  });

  it('tapers travelling rays as the tail catches the head', () => {
    const middle = getArrivalRay(500, 0, 150, 210, 1);
    const end = getArrivalRay(740, 0, 150, 210, 1);
    expect(end.tail).toBeGreaterThan(middle.tail);
    expect(end.head - end.tail).toBeLessThan(middle.head - middle.tail);
    expect(end.thickness).toBeLessThan(middle.thickness);
  });

  it('twinkles from the initial burst through the long tail independently of short words', () => {
    const stars = createArrivalStars();
    expect(stars.some((star) => star.birth === 0)).toBe(true);
    for (let age = 100; age < ARRIVAL_VISUAL_DURATION_MS; age += 100) {
      expect(stars.some((star) => getArrivalStarPulse(star, age) > 0)).toBe(true);
    }
    expect(stars.every((star) => getArrivalStarPulse(star, ARRIVAL_VISUAL_DURATION_MS) === 0)).toBe(true);
    expect(getArrivalWordPose(ARRIVAL_WORD_DURATION_MS - 1).visible).toBe(true);
    expect(getArrivalWordPose(ARRIVAL_WORD_DURATION_MS).visible).toBe(false);
    expect(stars.some((star) => getArrivalStarPulse(star, ARRIVAL_WORD_DURATION_MS) > 0)).toBe(true);
  });
});
