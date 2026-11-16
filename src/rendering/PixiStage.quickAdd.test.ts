import { describe, expect, it, vi } from 'vitest';
import { PixiStage, type DeckAddRequestPayload } from './PixiStage';
import type { CardQuickAddDeck, CardQuickAddTarget } from './cardQuickAdd';

const deck: CardQuickAddDeck = { deckId: 'deck', canvasAreaId: 'area', name: 'My Deck' };
function harness() {
  const onDeckAddRequest = vi.fn<(request: DeckAddRequestPayload) => void>();
  const onCardQuickAddTargetsChange = vi.fn<(targets: CardQuickAddTarget[]) => void>();
  const selectedCards = new Set(['Frost Mage']);
  const selectedZoneCardKeys = new Set(['stack:a', 'stack:b']);
  const sprite = { x: 100, y: 150, visible: true };
  const displaySize = { width: 100, height: 140 };
  const area = { ...deck, id: deck.canvasAreaId, type: 'deck', pinned: true };
  const stage = Object.assign(Object.create(PixiStage.prototype) as Pick<PixiStage, 'quickAddToDeck'>, {
    onDeckAddRequest, onCardQuickAddTargetsChange, selectedCards, selectedZoneCardKeys,
    isInitialized: true, canvasAreas: [area],
    cardSprites: new Map([['Frost Mage', { sprite, displaySize, layout: { name: 'Frost Mage' } }]]),
    deckSprites: new Map(), associationShelfSprites: new Map(),
    zoneCardSprites: new Map(['stack:a', 'stack:b'].map(key => [key, { sprite, displaySize, cardName: 'Fireball' }])),
    app: { canvas: { getBoundingClientRect: () => ({ left: 10, top: 20, right: 1010, bottom: 820 }) } },
    camera: { viewport: { toScreen: (x: number, y: number) => ({ x: x * 2, y: y * 2 }) } },
    dragState: { isDragging: false }, zoneCardDragState: { isDragging: false },
  });
  return { stage, area, sprite, selectedCards, selectedZoneCardKeys, onDeckAddRequest, onCardQuickAddTargetsChange };
}

describe('selected card quick add', () => {
  it.each(['mainboard', 'collection', 'maybeboard'] as const)('adds only the clicked card to %s without reopening the board chooser', board => {
    const { stage, onDeckAddRequest } = harness();
    stage.quickAddToDeck(deck, 'Frost Mage', 'card', board);
    expect(onDeckAddRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      deckId: 'deck', canvasAreaId: 'area', board, cardNames: ['Frost Mage'], source: 'active-deck',
    }));
  });
  it.each(['mainboard', 'collection', 'maybeboard'] as const)('adds every selected instance, including repeated copies, to %s', board => {
    const { stage, onDeckAddRequest } = harness();
    stage.quickAddToDeck(deck, 'stack:b', 'selection', board);
    expect(onDeckAddRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ board, cardNames: ['Frost Mage', 'Fireball', 'Fireball'] }));
  });
  it('ignores stale buttons when the card is deselected or the target deck leaves the canvas', () => {
    const { stage, selectedCards, area, onDeckAddRequest } = harness();
    selectedCards.clear();
    stage.quickAddToDeck(deck, 'Frost Mage', 'selection', 'mainboard');
    area.pinned = false;
    stage.quickAddToDeck(deck, 'stack:a', 'card', 'mainboard');
    expect(onDeckAddRequest).not.toHaveBeenCalled();
  });
  it('projects selected corners, hides offscreen controls and keeps hidden copies in the selection', () => {
    const { stage, sprite, onCardQuickAddTargetsChange } = harness();
    const update = stage as unknown as { updateCardQuickAddTargets(): void };
    update.updateCardQuickAddTargets();
    expect(onCardQuickAddTargetsChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      { key: 'Frost Mage', cardName: 'Frost Mage', clientX: 402, clientY: 328, visible: true },
    ]));
    sprite.x = 1000;
    update.updateCardQuickAddTargets();
    const targets = onCardQuickAddTargetsChange.mock.calls.at(-1)?.[0];
    expect(targets).toHaveLength(3);
    expect(targets?.every(target => !target.visible)).toBe(true);
  });
});
