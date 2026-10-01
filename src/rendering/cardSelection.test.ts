import { describe, expect, it } from 'vitest';
import { getCardClickSelection } from './cardSelection';

const stack = ['a', 'b', 'c'];
function click(selected: string[], options: Partial<Parameters<typeof getCardClickSelection>[0]> = {}) {
  return getCardClickSelection({ clickedKey: 'c', stackKeys: stack, selectedKeys: new Set(selected), ...options });
}

describe('desktop card selection', () => {
  it('selects a whole stack, then drills into the clicked card on another click', () => {
    expect(click([])).toEqual(stack);
    expect(click(stack)).toEqual(['c']);
  });
  it('selects the stack on double click even when one member was selected', () => {
    expect(click(['c'], { doubleClick: true })).toEqual(stack);
  });
  it('preserves a marquee or individual selection when dragging a selected member', () => {
    expect(click(['c', 'elsewhere'], { dragging: true })).toEqual(['c', 'elsewhere']);
    expect(click(['c'], { dragging: true })).toEqual(['c']);
    expect(click([], { dragging: true })).toEqual(stack);
  });
  it('toggles individual cards with Shift and adds an unselected card when Shift-dragging', () => {
    expect(click(['a'], { additive: true })).toEqual(['a', 'c']);
    expect(click(stack, { additive: true })).toEqual(['a', 'b']);
    expect(click(['a'], { additive: true, dragging: true })).toEqual(['a', 'c']);
  });
});
