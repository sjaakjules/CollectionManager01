import { describe, expect, it } from 'vitest';
import { getDeckHeadingStyle, getLabelHeadingStyle } from './deckHeadingStyle';
import type { CanvasLabel } from '@/data/dataModels';

describe('deck title hierarchy', () => {
  it('gives peer boards equal prominence and each nested level a smaller heading', () => {
    const main = getDeckHeadingStyle('mainboard');
    expect(getDeckHeadingStyle('collection')).toEqual(main);
    expect(getDeckHeadingStyle('maybeboard')).toEqual(main);
    const section = getDeckHeadingStyle('spellbook');
    expect(getDeckHeadingStyle('atlas')).toEqual(section);
    const parent: CanvasLabel = { id: 'parent', text: 'Parent', x: 0, y: 0, areaId: 'deck' };
    const child: CanvasLabel = { ...parent, id: 'child', parentLabelId: parent.id };
    const labels = [parent, child];
    const custom = getLabelHeadingStyle(parent, labels), nested = getLabelHeadingStyle(child, labels);
    expect(Number(main.fontWeight)).toBeGreaterThan(Number(section.fontWeight));
    expect(Number(section.fontWeight)).toBeGreaterThan(Number(custom.fontWeight));
    expect(Number(main.fontSize)).toBeGreaterThan(Number(section.fontSize));
    expect(Number(section.fontSize)).toBeGreaterThan(Number(custom.fontSize));
    expect(Number(custom.fontSize)).toBeGreaterThan(Number(nested.fontSize));
  });

  it('handles cyclic relationships from saved labels without hanging', () => {
    const a: CanvasLabel = { id: 'a', text: 'A', x: 0, y: 0, parentLabelId: 'b' };
    const b: CanvasLabel = { ...a, id: 'b', parentLabelId: 'a' };
    expect(Number(getLabelHeadingStyle(a, [a, b]).fontSize)).toBeGreaterThan(0);
  });
});
