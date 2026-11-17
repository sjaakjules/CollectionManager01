import { expect, it } from 'vitest';
import { PixiStage } from './PixiStage';
import { type CardSpriteConfig, CardSprite } from './CardSprite';
import { provisionalCards } from '@/data/provisionalCards';
import { required } from '@/utils/required';

it('uses current catalogue provenance on every stage card surface', () => {
  const preview = required(provisionalCards[0]);
  const released = { ...preview, name: 'Released', sets: [...preview.sets, {
    name: 'Frost Mage Vs. Lavamancer', metadata: preview.guardian, releasedAt: '2026-11-01', variants: [],
  }] };
  const stage = Object.assign(Object.create(PixiStage.prototype) as { createCardSprite(config: CardSpriteConfig): CardSprite }, {
    cards: [preview, released],
  });
  for (const [name, marked] of [[preview.name, true], ['Released', false], ['Unknown', false]] as const) {
    const sprite = stage.createCardSprite({ name, isLandscape: false, x: 200, y: 300 });
    expect(sprite.children.some(child => child.label === 'preview-watermark')).toBe(marked);
    sprite.destroy({ children: true });
  }
});
