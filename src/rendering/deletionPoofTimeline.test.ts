import { describe, expect, it } from 'vitest';
import {
  createPoofStars, getPoofFrame, getPoofPhase, getPoofWordFrame,
  POOF_DURATION_MS, POOF_FPS, POOF_FRAME_COUNT, POOF_POP_FRAME,
  POOF_VISUAL_DURATION_MS, POOF_WORD_DURATION_MS, POOF_WORD_FRAME_COUNT, POOF_WORD_START_MS,
} from './deletionPoofTimeline';

describe('deletion poof timing', () => {
  it('plays the visual drawings 25% faster without changing the authored frames', () => {
    expect(POOF_FPS).toBe(24);
    expect(getPoofFrame(0)).toBe(0);
    expect(getPoofFrame(16)).toBe(0);
    expect(getPoofFrame(33)).toBe(0);
    expect(getPoofFrame(34)).toBe(1);
    expect(getPoofFrame(66)).toBe(1);
    expect(getPoofFrame(67)).toBe(2);
    expect(getPoofFrame(400)).toBe(POOF_POP_FRAME);
    expect(POOF_VISUAL_DURATION_MS).toBe(1400);
  });

  it('starts words with the faster pop and gives them twice their former lifetime', () => {
    expect(POOF_WORD_START_MS).toBe(400);
    expect(POOF_WORD_DURATION_MS).toBe(2500);
    expect(POOF_DURATION_MS).toBe(2900);
    expect(getPoofWordFrame(-100)).toBe(-1);
    expect(getPoofWordFrame(399)).toBe(-1);
    expect(getPoofWordFrame(400)).toBe(0);
    expect(getPoofWordFrame(483)).toBe(0);
    expect(getPoofWordFrame(484)).toBe(1);
    expect(getPoofWordFrame(POOF_VISUAL_DURATION_MS)).toBe(12);
    expect(getPoofWordFrame(POOF_DURATION_MS - 1)).toBe(POOF_WORD_FRAME_COUNT - 1);
    expect(getPoofWordFrame(POOF_DURATION_MS)).toBe(POOF_WORD_FRAME_COUNT);
    expect(getPoofWordFrame(60_000)).toBe(POOF_WORD_FRAME_COUNT);
  });

  it('contracts before the pop and keeps the star tail until the final frame', () => {
    expect(getPoofPhase(0)).toBe('cloud');
    expect(getPoofPhase(POOF_POP_FRAME - 1)).toBe('cloud');
    expect(getPoofPhase(POOF_POP_FRAME)).toBe('pop');
    expect(getPoofPhase(15)).toBe('pop');
    expect(getPoofPhase(16)).toBe('sparkles');
    expect(getPoofPhase(POOF_FRAME_COUNT - 1)).toBe('sparkles');
    expect(getPoofPhase(POOF_FRAME_COUNT)).toBe('finished');
  });

  it('clamps early clocks and expires on a long background-tab time jump', () => {
    expect(getPoofFrame(-100)).toBe(0);
    expect(getPoofFrame(POOF_VISUAL_DURATION_MS - 1)).toBe(POOF_FRAME_COUNT - 1);
    expect(getPoofFrame(POOF_VISUAL_DURATION_MS)).toBe(POOF_FRAME_COUNT);
    expect(getPoofFrame(60_000)).toBe(POOF_FRAME_COUNT);
  });
});

describe('staggered poof stars', () => {
  it('keeps a deletion stable between frames while varying the next deletion', () => {
    expect(createPoofStars(12345)).toEqual(createPoofStars(12345));
    expect(createPoofStars(12345)).not.toEqual(createPoofStars(12346));
    expect(createPoofStars(0)).not.toEqual(createPoofStars(1));
  });

  it('births stars at the pop and in later waves, with lifetimes contained in the effect', () => {
    for (const seed of [0, 1, 12345, 0xffffffff]) {
      const stars = createPoofStars(seed);
      expect(stars.length).toBeGreaterThan(0);
      expect(Math.min(...stars.map((star) => star.birth))).toBe(POOF_POP_FRAME);
      expect(new Set(stars.map((star) => star.birth)).size).toBeGreaterThan(6);
      for (const star of stars) {
        expect(star.birth).toBeGreaterThanOrEqual(POOF_POP_FRAME);
        expect(star.life).toBeGreaterThan(0);
        expect(star.birth + star.life).toBeLessThanOrEqual(POOF_FRAME_COUNT);
        expect(star.size).toBeGreaterThan(0);
        expect(Number.isFinite(star.x) && Number.isFinite(star.y)).toBe(true);
      }
    }
  });
});
