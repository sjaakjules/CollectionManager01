import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { CardSprite } from './CardSprite';
import { CardStatisticsOverlay } from './CardStatisticsOverlay';
import { lodManager, LOD_LEVELS } from './LODManager';
import { required } from '@/utils/required';
import type { CardStatisticOutline } from '@/data/cardStatisticHighlights';

const outlines: readonly CardStatisticOutline[] = [
  { metric: 'inDeck', colour: 0xffb05a },
  { metric: 'drawnDifference', colour: 0xff8177 },
];

afterEach(() => vi.restoreAllMocks());
describe('Pixi card statistics rendering', () => {
  it('allocates labels only at a readable zoom, and hides them again in overview', () => {
    const overlay = new CardStatisticsOverlay(100, 140);
    overlay.setPresentation({ outlines, labels: ['Deck WR 55.0% · n200'] }, .2);
    expect(overlay.getChildByLabel('card-statistic-values')).toBeNull();
    overlay.updateZoom(2);
    const labels = required(overlay.getChildByLabel('card-statistic-values'));
    expect(labels.visible).toBe(true);
    expect(overlay.eventMode).toBe('none');
    overlay.updateZoom(.5);
    expect(labels.visible).toBe(false);
    overlay.destroy({ children: true });
  });
  it.each([false, true])('preserves selection, quantity, opacity and hit bounds for landscape=%s', isLandscape => {
    vi.spyOn(lodManager, 'getStartupLOD').mockReturnValue(LOD_LEVELS.THUMBNAIL);
    const imageLoads = vi.spyOn(lodManager, 'getTexture');
    const card = new CardSprite({ name: 'Toolbox', isLandscape, x: 200, y: 200 });
    card.updateState({ quantity: 4, quantityColor: 'white', isHighlighted: true });
    card.setSelected(true);
    card.alpha = .46;
    const bounds = card.getWorldBounds();
    const originalChildren = [...card.children];
    card.setCardStatistics({ outlines, labels: ['Played WR 0.0% · n100', 'Drawn Δ -10.0 pp · n100'] });
    expect(card.isSelected).toBe(true);
    expect(card.alpha).toBe(.46);
    expect(card.getWorldBounds()).toEqual(bounds);
    const overlay = required(card.getChildByLabel('card-statistics'));
    expect(card.getChildIndex(overlay)).toBeLessThan(card.getChildIndex(required(card.getChildByLabel('selection-outline'))));
    card.setCardStatistics(null);
    expect(card.children).toEqual(originalChildren);
    expect(imageLoads).not.toHaveBeenCalled();
    card.destroy({ children: true });
  });
  it('does not leave containers behind when the displayed metrics change', () => {
    const overlay = new CardStatisticsOverlay(100, 140);
    overlay.setPresentation({ outlines: [], labels: ['Deck WR 55.0%'] }, 2);
    const old = required(overlay.getChildByLabel('card-statistic-values'));
    overlay.setPresentation({ outlines, labels: [] }, 2);
    expect(old.destroyed).toBe(true);
    expect(overlay.children.filter(child => child instanceof Container)).toHaveLength(1);
    overlay.destroy({ children: true });
  });
  it('draws every matched colour within the card and removes cleared segments', () => {
    const overlay = new CardStatisticsOverlay(140, 100);
    const outline = overlay.getChildByLabel('card-statistic-outline');
    if (!(outline instanceof Graphics)) throw new Error('Missing card statistic outline');
    const colours = () => outline.context.instructions.flatMap(instruction =>
      instruction.action === 'stroke' ? [instruction.data.style.color] : []);
    for (const zoom of [.04, .25, 2]) {
      overlay.setPresentation({ outlines, labels: [] }, zoom);
      expect(colours()).toEqual(outlines.map(match => match.colour));
      expect(outline.context.bounds.minX).toBeGreaterThanOrEqual(0);
      expect(outline.context.bounds.maxX).toBeLessThanOrEqual(140);
      expect(outline.context.bounds.minY).toBeGreaterThanOrEqual(0);
      expect(outline.context.bounds.maxY).toBeLessThanOrEqual(100);
    }
    overlay.setPresentation({ outlines: [], labels: [] }, 2);
    expect(colours()).toEqual([]);
    overlay.destroy({ children: true });
  });
});
