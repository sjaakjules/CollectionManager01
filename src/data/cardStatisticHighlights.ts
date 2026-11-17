import {
  CARD_STATISTIC_METRICS, CARD_STATISTIC_SHORT_LABELS, formatCardStatistic,
  type CardStatisticMetric, type CardStatisticValue, type CardStatisticsAsset,
} from './cardStatistics';

export interface CardStatisticRule {
  enabled: boolean;
  comparison: 'atLeast' | 'atMost';
  threshold: number;
  minimumGames: number;
  scaleSpan: number;
}

export type CardStatisticRules = Readonly<Record<CardStatisticMetric, CardStatisticRule>>;
export type CardStatisticShading = 'bands' | 'smooth';

export interface CardStatisticsSettings {
  showOnHover: boolean;
  showOverlays: boolean;
  overlayMetrics: CardStatisticMetric[];
  highlightEnabled: boolean;
  highlightShading: CardStatisticShading;
  highlightRules: CardStatisticRules;
}

// Starting points for exploration, combining the video's examples with editable defaults.
const STARTER_RULES = {
  deckShare:      { threshold: 5,  minimumGames: 200, scaleSpan: 20 },
  inDeck:         { threshold: 55, minimumGames: 200, scaleSpan: 10 },
  played:         { threshold: 55, minimumGames: 200, scaleSpan: 10 },
  openingHand:    { threshold: 55, minimumGames: 100, scaleSpan: 10 },
  inHand:         { threshold: 55, minimumGames: 100, scaleSpan: 10 },
  notInHand:      { threshold: 48, minimumGames: 100, scaleSpan: 12 },
  inDeckUnplayed: { threshold: 55, minimumGames: 200, scaleSpan: 10 },
  drawnDifference:{ threshold: 4,  minimumGames: 100, scaleSpan: 8 },
} satisfies Record<CardStatisticMetric, Pick<CardStatisticRule, 'threshold' | 'minimumGames' | 'scaleSpan'>>;

export const CARD_STATISTIC_HIGHLIGHT_COLOURS: Record<CardStatisticMetric, number> = {
  deckShare: 0x79b7ff,
  inDeck: 0xffb05a,
  played: 0xcb9aff,
  openingHand: 0xffe272,
  inHand: 0x56dfcc,
  notInHand: 0xff94cc,
  inDeckUnplayed: 0xb7df6f,
  drawnDifference: 0xff8177,
};

const defaultRules = Object.fromEntries(CARD_STATISTIC_METRICS.map(metric => [metric, {
  ...STARTER_RULES[metric],
  enabled: metric === 'drawnDifference',
  comparison: 'atLeast',
} satisfies CardStatisticRule])) as CardStatisticRules;

export const DEFAULT_CARD_STATISTICS_SETTINGS: CardStatisticsSettings = {
  showOnHover: true,
  showOverlays: false,
  overlayMetrics: ['inDeck', 'deckShare', 'drawnDifference'],
  highlightEnabled: false,
  highlightShading: 'bands',
  highlightRules: defaultRules,
};

export function cardStatisticMinimum(metric: CardStatisticMetric): number {
  return metric === 'drawnDifference' ? -100 : 0;
}

function bounded(value: number, min: number, max: number, fallback = min): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function normalizeRule(metric: CardStatisticMetric, rule: CardStatisticRule): CardStatisticRule {
  const minimum = cardStatisticMinimum(metric);
  const fallback = STARTER_RULES[metric];
  return {
    enabled: rule.enabled,
    comparison: rule.comparison === 'atMost' ? 'atMost' : 'atLeast',
    threshold: bounded(rule.threshold, minimum, 100, fallback.threshold),
    minimumGames: Math.floor(bounded(rule.minimumGames, 0, Number.MAX_SAFE_INTEGER, fallback.minimumGames)),
    scaleSpan: bounded(rule.scaleSpan, 0, 100 - minimum, fallback.scaleSpan),
  };
}

export function normalizeCardStatisticsSettings(settings: CardStatisticsSettings): CardStatisticsSettings {
  const highlightRules = Object.fromEntries(CARD_STATISTIC_METRICS.map(metric => [
    metric, normalizeRule(metric, settings.highlightRules[metric]),
  ])) as CardStatisticRules;
  return {
    ...settings,
    overlayMetrics: [...new Set(settings.overlayMetrics.filter(key => CARD_STATISTIC_METRICS.includes(key)))].slice(0, 3),
    highlightShading: settings.highlightShading === 'smooth' ? 'smooth' : 'bands',
    highlightRules,
  };
}

export function getEnabledCardStatisticMetrics(settings: CardStatisticsSettings): CardStatisticMetric[] {
  return settings.highlightEnabled
    ? CARD_STATISTIC_METRICS.filter(metric => settings.highlightRules[metric].enabled)
    : [];
}

export function matchesCardStatistic(sample: CardStatisticValue | undefined, rule: CardStatisticRule): boolean {
  if (!sample || sample.value === null || sample.games === null || sample.games < rule.minimumGames) return false;
  return rule.comparison === 'atMost' ? sample.value <= rule.threshold : sample.value >= rule.threshold;
}

export function cardStatisticScale(metric: CardStatisticMetric, rule: CardStatisticRule): [low: number, high: number] {
  return rule.comparison === 'atMost'
    ? [Math.max(cardStatisticMinimum(metric), rule.threshold - rule.scaleSpan), rule.threshold]
    : [rule.threshold, Math.min(100, rule.threshold + rule.scaleSpan)];
}

/** Shade within one hue. Both comparisons always go from lower to higher values. */
export function cardStatisticColour(metric: CardStatisticMetric, progress: number): number {
  const base = CARD_STATISTIC_HIGHLIGHT_COLOURS[metric];
  const brightness = .52 + .48 * progress;
  const red = Math.round(((base >> 16) & 255) * brightness);
  const green = Math.round(((base >> 8) & 255) * brightness);
  const blue = Math.round((base & 255) * brightness);
  return (red << 16) | (green << 8) | blue;
}

export function cardStatisticCssColour(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

export interface CardStatisticOutline {
  metric: CardStatisticMetric;
  colour: number;
}

/** A display model shared by all instances of a card. */
export interface CardStatisticsPresentation {
  outlines: readonly CardStatisticOutline[];
  labels: readonly string[];
}

const compactCount = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function createCardStatisticsPresentations(
  asset: CardStatisticsAsset | null,
  settings: CardStatisticsSettings,
): ReadonlyMap<string, CardStatisticsPresentation> {
  const presentations = new Map<string, CardStatisticsPresentation>();
  const enabled = getEnabledCardStatisticMetrics(settings);
  const overlayMetrics = settings.showOverlays ? settings.overlayMetrics : [];
  if (!asset || (!enabled.length && !overlayMetrics.length)) return presentations;

  const scales = enabled.map(metric => ({
    metric,
    rule: settings.highlightRules[metric],
    range: cardStatisticScale(metric, settings.highlightRules[metric]),
  }));
  for (const [name, stats] of Object.entries(asset.cards)) {
    const outlines: CardStatisticOutline[] = [];
    for (const { metric, rule, range: [low, high] } of scales) {
      const sample = stats[metric];
      if (sample.value === null || !matchesCardStatistic(sample, rule)) continue;
      let progress = high === low ? 1 : bounded((sample.value - low) / (high - low), 0, 1);
      if (settings.highlightShading === 'bands') progress = Math.min(2, Math.floor(progress * 3)) / 2;
      outlines.push({ metric, colour: cardStatisticColour(metric, progress) });
    }
    const labels = overlayMetrics.map(metric => {
      const { value, games } = stats[metric];
      const sample = value !== null && games !== null ? ` · n${compactCount.format(games)}` : '';
      return `${CARD_STATISTIC_SHORT_LABELS[metric]} ${formatCardStatistic(metric, value)}${sample}`;
    });
    if (outlines.length || labels.length) presentations.set(name, { outlines, labels });
  }
  return presentations;
}
