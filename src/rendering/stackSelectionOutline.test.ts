import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { CardSprite } from './CardSprite';
import { outlineSelectedStack } from './stackSelectionOutline';

describe('selection rims on real card sprites', () => {
  for (const landscape of [false, true]) {
    it(`uses one rim for a ${landscape ? 'landscape' : 'portrait'} stack and resets for an individual card`, () => {
      const width = landscape ? 140 : 100;
      const height = landscape ? 100 : 140;
      const cards = Array.from({ length: 4 }, (_, i) => {
        const card = new CardSprite({ name: 'Example', isLandscape: landscape, x: 200,
          y: 250 + i * (landscape ? -12 : 12), displaySize: { width, height } });
        card.zIndex = i;
        card.setSelected(true);
        return card;
      });
      outlineSelectedStack(cards);
      const rims = cards.map(card => card.getChildByLabel('selection-outline'));
      expect(rims.map(rim => rim?.visible)).toEqual([false, false, false, true]);
      const rim = rims[3];
      const top = cards[3];
      if (!(rim instanceof Graphics) || !top) throw new Error('Expected the stack rim on the top card');
      const bounds = rim.context.bounds;
      expect(bounds.height).toBeGreaterThan(height + 36);
      const before = top.y + bounds.minY;
      for (const card of cards) card.y += 50;
      expect(top.y + rim.context.bounds.minY).toBeCloseTo(before + 50);

      for (const card of cards) card.setSelected(false);
      top.setSelected(true);
      expect(rim.visible).toBe(true);
      expect(rim.context.bounds.height).toBeLessThan(height + 12);
      for (const card of cards) card.destroy({ children: true });
    });
  }
});
