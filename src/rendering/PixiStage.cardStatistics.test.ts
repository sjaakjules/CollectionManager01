import { describe, expect, it, vi } from 'vitest';
import type { CardStatisticsPresentation } from '@/data/cardStatisticHighlights';
import { PixiStage } from './PixiStage';

describe('statistics across canvas card instances', () => {
  it('updates catalogue, active deck, shelf, saved decks, stacks and avatars, then clears all', () => {
    const make = (cardName = 'Toolbox') => ({ cardName, setCardStatistics: vi.fn() });
    const catalogue = make(); const deck = make(); const shelf = make(); const saved = make(); const avatar = make(); const missing = make('No data');
    const stage = Object.assign(Object.create(PixiStage.prototype) as Pick<PixiStage, 'updateCardStatistics'>, {
      cardSprites: new Map([['card', { sprite: catalogue }], ['missing', { sprite: missing }]]),
      deckSprites: new Map([['deck-card', { sprite: deck }]]),
      associationShelfSprites: new Map([['shelf', { sprite: shelf }]]),
      zoneCardSprites: new Map([['zone-card', { sprite: saved }]]),
      zoneFrames: new Map([['zone', { avatarSprite: avatar }]]),
    });
    const presentation: CardStatisticsPresentation = { outlines: [{ metric: 'inDeck', colour: 0xffb05a }], labels: ['Deck WR 55.0%'] };
    stage.updateCardStatistics(new Map([['Toolbox', presentation]]));
    for (const sprite of [catalogue, deck, shelf, saved, avatar]) expect(sprite.setCardStatistics).toHaveBeenLastCalledWith(presentation);
    expect(missing.setCardStatistics).toHaveBeenLastCalledWith(null);
    stage.updateCardStatistics(new Map());
    for (const sprite of [catalogue, deck, shelf, saved, avatar]) expect(sprite.setCardStatistics).toHaveBeenLastCalledWith(null);
  });
});
