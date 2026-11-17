import { describe, expect, it } from 'vitest';
import { required } from '@/utils/required';
import { cardStatisticsFixture } from './__fixtures__/cardStatistics';
import { parseCardStatisticsAsset } from './cardStatistics';
import {
  DEFAULT_CARD_STATISTICS_SETTINGS as defaults, cardStatisticScale, createCardStatisticsPresentations, matchesCardStatistic, normalizeCardStatisticsSettings,
} from './cardStatisticHighlights';

describe('published card statistics', () => {
  it('uses inclusive thresholds, the selected sample, and real zero or negative values', () => {
    const stats = required(cardStatisticsFixture().cards.Toolbox);
    const { inDeck, played, openingHand, drawnDifference } = defaults.highlightRules;
    expect(matchesCardStatistic(stats.inDeck, inDeck)).toBe(true);
    expect(matchesCardStatistic(stats.inDeck, { ...inDeck, minimumGames: 201 })).toBe(false);
    expect(matchesCardStatistic(stats.played, { ...played, comparison: 'atMost', threshold: 0, minimumGames: 100 })).toBe(true);
    expect(matchesCardStatistic(stats.drawnDifference, { ...drawnDifference, comparison: 'atMost', threshold: -10 })).toBe(true);
    expect(matchesCardStatistic(stats.openingHand, { ...openingHand, comparison: 'atMost', threshold: 100, minimumGames: 0 })).toBe(false);
    expect(matchesCardStatistic(undefined, inDeck)).toBe(false);
  });

  it('shows independent matches together and drops only the rule with too few observations', () => {
    const asset = cardStatisticsFixture();
    const rules = defaults.highlightRules;
    expect(createCardStatisticsPresentations(asset, defaults).size).toBe(0);
    const result = createCardStatisticsPresentations(asset, {
      ...defaults,
      highlightEnabled: true,
      showOverlays: true,
      overlayMetrics: ['played', 'openingHand', 'drawnDifference'],
      highlightRules: {
        ...rules,
        inDeck: { ...rules.inDeck, enabled: true },
        drawnDifference: { ...rules.drawnDifference, comparison: 'atMost', threshold: -4 },
        notInHand: { ...rules.notInHand, enabled: true, minimumGames: 201 },
      },
    });
    const toolbox = required(result.get('Toolbox'));
    expect(toolbox.outlines.map(outline => outline.metric)).toEqual(['inDeck', 'drawnDifference']);
    expect(toolbox.outlines[0]?.colour).not.toBe(toolbox.outlines[1]?.colour);
    expect(toolbox.labels).toEqual(['Played WR 0.0% · n100', 'Opening WR —', 'Drawn Δ -10.0 pp · n100']);
    expect(result.has('Unknown Card')).toBe(false);
  });

  it('keeps lower values darker in both shading modes even when the cutoff is a maximum', () => {
    const asset = cardStatisticsFixture();
    const example = required(asset.cards.Toolbox);
    asset.cards = Object.fromEntries([-16, -12, -11, -8, -4, -3].map(value => [
      String(value), { ...example, drawnDifference: { value, games: 100 } },
    ]));
    const rule = { ...defaults.highlightRules.drawnDifference, comparison: 'atMost', threshold: -4 } as const;
    const settings = { ...defaults, highlightEnabled: true, highlightRules: { ...defaults.highlightRules, drawnDifference: rule } };
    expect(cardStatisticScale('drawnDifference', rule)).toEqual([-12, -4]);
    const bands = createCardStatisticsPresentations(asset, settings);
    const smooth = createCardStatisticsPresentations(asset, { ...settings, highlightShading: 'smooth' });
    const fill = (result: typeof bands, value: number) => required(required(result.get(String(value))).outlines[0]).colour;
    expect(fill(bands, -12)).toBe(fill(bands, -11));
    expect(fill(bands, -11)).toBeLessThan(fill(bands, -8));
    expect(fill(bands, -8)).toBeLessThan(fill(bands, -4));
    expect(fill(smooth, -16)).toBe(fill(smooth, -12));
    expect(fill(smooth, -12)).toBeLessThan(fill(smooth, -11));
    expect(fill(smooth, -11)).toBeLessThan(fill(smooth, -8));
    expect(fill(smooth, -4)).toBe(fill(bands, -4));
    expect(smooth.has('-3')).toBe(false);
  });

  it('bounds choices and keeps only three distinct overlay metrics', () => {
    const settings = normalizeCardStatisticsSettings({
      ...defaults,
      overlayMetrics: ['inDeck', 'inDeck', 'played', 'inHand', 'deckShare'],
      highlightRules: {
        ...defaults.highlightRules,
        inDeck: { ...defaults.highlightRules.inDeck, threshold: -50, minimumGames: -1 },
        drawnDifference: { ...defaults.highlightRules.drawnDifference, threshold: -10 },
      },
    });
    expect(settings.overlayMetrics).toEqual(['inDeck', 'played', 'inHand']);
    expect(settings.highlightRules.inDeck).toMatchObject({ threshold: 0, minimumGames: 0 });
    expect(settings.highlightRules.drawnDifference.threshold).toBe(-10);
  });

  it('validates published input and discards fields outside its contract', () => {
    const asset = cardStatisticsFixture();
    expect(parseCardStatisticsAsset({ ...asset, privateField: 'not-published' })).toEqual(asset);
    required(asset.cards.Toolbox).inDeck.value = 101;
    expect(() => parseCardStatisticsAsset(asset)).toThrow('Invalid published');
    expect(() => parseCardStatisticsAsset('<html>not-json</html>')).toThrow('Invalid published');
    expect(() => parseCardStatisticsAsset({ ...cardStatisticsFixture(), version: 1 })).toThrow('Invalid published');
  });
});
