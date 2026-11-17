import { Graphics } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { drawDeckGrid } from './deckGrid';
import { DRAWN_GRID } from './Grid';

describe('deck grid', () => {
  it('clips lines and dots to the deck content and aligns to the world grid', () => {
    const frame = new Graphics();
    const move = vi.spyOn(frame, 'moveTo');
    const line = vi.spyOn(frame, 'lineTo');
    const dot = vi.spyOn(frame, 'circle');
    drawDeckGrid(frame, { x: -84, y: 19, width: 167, height: 90 });
    const { width, height } = DRAWN_GRID;
    expect(move.mock.calls).toEqual([[-width, 19], [0, 19], [width, 19], [-84, height]]);
    expect(line.mock.calls).toEqual([[-width, 109], [0, 109], [width, 109], [83, height]]);
    expect(dot.mock.calls.map(([x, y]) => [x, y])).toEqual([[-width, height], [0, height], [width, height]]);
    frame.destroy();
  });
});
