import { required } from '@/utils/required';
import { describe, expect, it } from 'vitest';
import { packOrderedGroups } from './orderedPacking';

describe('ordered aspect packing', () => {
  it.each([390 / 844, 844 / 390, 1, 16 / 9, 21 / 9])('fits aspect %s without reordering or overlapping groups', (aspect) => {
    const sizes = [28, 35, 32, 38, 40, 24].map(height => ({ width: 20, height }));
    const boxes = packOrderedGroups(sizes, aspect, 4);
    expect(boxes).toHaveLength(sizes.length);
    boxes.forEach((box, index) => {
      expect(box.width).toBe(required(sizes[index]).width);
      expect(box.height).toBe(required(sizes[index]).height);
      if (index) {
        const previous = required(boxes[index - 1]);
        expect(box.y > previous.y || (box.y === previous.y && box.x > previous.x)).toBe(true);
      }
      boxes.slice(index + 1).forEach(other => {
        expect(box.x + box.width <= other.x || other.x + other.width <= box.x || box.y + box.height <= other.y || other.y + other.height <= box.y).toBe(true);
      });
    });
    const width = Math.max(...boxes.map(box => box.x + box.width));
    const height = Math.max(...boxes.map(box => box.y + box.height));
    expect(Math.max(width / aspect, height)).toBeLessThan(150);
  });

  it('uses multiple columns on a phone instead of an extremely tall single strip', () => {
    const boxes = packOrderedGroups(Array.from({length: 6}, () => ({ width: 20, height: 60 })), 0.48, 4);
    expect(new Set(boxes.map(box => box.x)).size).toBeGreaterThan(1);
    expect(Math.max(...boxes.map(box => box.y + box.height))).toBeLessThan(220);
  });

  it('handles empty, singleton and very large group lists deterministically', () => {
    expect(packOrderedGroups([], 1, 2)).toEqual([]);
    expect(packOrderedGroups([{width: 4, height: 7}], 1, 2)).toEqual([{x: 0, y: 0, width: 4, height: 7}]);
    const sizes = Array.from({length: 1100}, () => ({width: 2, height: 3}));
    expect(packOrderedGroups(sizes, 1, 1)).toEqual(packOrderedGroups(sizes, 1, 1));
  });
});
