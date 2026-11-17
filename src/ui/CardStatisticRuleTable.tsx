import { useMemo, useState } from 'react';
import {
  CARD_STATISTIC_DESCRIPTIONS, CARD_STATISTIC_LABELS, CARD_STATISTIC_METRICS, formatCardStatistic,
  type CardStatisticMetric, type CardStatisticsAsset,
} from '@/data/cardStatistics';
import {
  cardStatisticColour, cardStatisticCssColour, cardStatisticMinimum, cardStatisticScale, matchesCardStatistic,
  type CardStatisticRule, type CardStatisticShading, type CardStatisticsSettings,
} from '@/data/cardStatisticHighlights';

interface CardStatisticRuleTableProps {
  asset: CardStatisticsAsset;
  filteredCards: ReadonlyArray<{ name: string }>;
  settings: CardStatisticsSettings;
  onChange: (patch: Partial<CardStatisticsSettings>) => void;
  onRuleChange: (metric: CardStatisticMetric, change: Partial<CardStatisticRule>) => void;
}

function StatisticNumberInput({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max?: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input aria-label={label} type="number" min={min} max={max} step={step} value={draft ?? value}
    onChange={event => setDraft(event.currentTarget.value)}
    onBlur={event => {
      const next = event.currentTarget.valueAsNumber;
      if (draft !== null && Number.isFinite(next)) {
        onChange(Math.max(min, Math.min(max ?? Infinity, next)));
      }
      setDraft(null);
    }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
}

function StatisticScale({ metric, rule, shading }: { metric: CardStatisticMetric; rule: CardStatisticRule; shading: CardStatisticShading }) {
  const [low, high] = cardStatisticScale(metric, rule);
  const lowColour = cardStatisticCssColour(cardStatisticColour(metric, 0));
  const midColour = cardStatisticCssColour(cardStatisticColour(metric, .5));
  const highColour = cardStatisticCssColour(cardStatisticColour(metric, 1));
  let background = highColour;
  if (low !== high) {
    background = shading === 'bands'
      ? `linear-gradient(90deg, ${lowColour} 0 33.33%, ${midColour} 33.33% 66.67%, ${highColour} 66.67% 100%)`
      : `linear-gradient(90deg, ${lowColour}, ${highColour})`;
  }
  return <div className="card-stats-scale">
    <div className="card-stats-scale-bar" style={{ background }} aria-hidden="true" />
    <div className="card-stats-scale-values">
      <span>{formatCardStatistic(metric, low)}</span>
      {low !== high && <span>{formatCardStatistic(metric, high)}</span>}
    </div>
  </div>;
}

export function CardStatisticRuleTable({ asset, filteredCards, settings, onChange, onRuleChange }: CardStatisticRuleTableProps) {
  const rules = settings.highlightRules;
  const { counts, anyMatch } = useMemo(() => {
    const counts = new Map<CardStatisticMetric, number>();
    let anyMatch = 0;
    for (const { name } of filteredCards) {
      const stats = asset.cards[name];
      let matched = false;
      for (const metric of CARD_STATISTIC_METRICS) {
        const rule = rules[metric];
        if (!matchesCardStatistic(stats?.[metric], rule)) continue;
        counts.set(metric, (counts.get(metric) ?? 0) + 1);
        if (rule.enabled) matched = true;
      }
      if (matched) anyMatch++;
    }
    return { counts, anyMatch };
  }, [asset, filteredCards, rules]);

  return <>
    <div className="card-stats-toolbar">
      <label className="card-stats-toggle">
        <input type="checkbox" checked={settings.highlightEnabled} onChange={event => onChange({ highlightEnabled: event.target.checked })} />
        Highlight cards
      </label>
      <label className="card-stats-shading">Shading
        <select value={settings.highlightShading} onChange={event => onChange({ highlightShading: event.target.value === 'smooth' ? 'smooth' : 'bands' })}>
          <option value="bands">Three bands</option>
          <option value="smooth">Smooth gradient</option>
        </select>
      </label>
      <p className="card-stats-match-count" role="status">
        {anyMatch.toLocaleString()} of {filteredCards.length.toLocaleString()} catalogue cards {settings.highlightEnabled ? 'highlighted' : 'would be highlighted'}
      </p>
    </div>
    <div className="card-stats-table-scroll" role="region" aria-label="Highlight rules" tabIndex={0}>
      <table className="card-stats-table" aria-label="Card statistic thresholds">
        <thead><tr>
          <th scope="col">Outline</th>
          <th scope="col">Value cutoff</th>
          <th scope="col">Min. player-games</th>
          <th scope="col" title="The other end of the visible shading range">Scale end</th>
          <th scope="col">Low to high</th>
          <th scope="col" title="Cards in the current catalogue filter that meet this row's rule">Matches</th>
        </tr></thead>
        <tbody>{CARD_STATISTIC_METRICS.map(metric => {
          const label = CARD_STATISTIC_LABELS[metric];
          const rule = rules[metric];
          const atMost = rule.comparison === 'atMost';
          const min = cardStatisticMinimum(metric);
          const [low, high] = cardStatisticScale(metric, rule);
          const unit = metric === 'drawnDifference' ? 'pp' : '%';
          return <tr key={metric} className={rule.enabled ? 'card-stats-rule-enabled' : undefined}>
            <th scope="row">
              <label className="card-stats-toggle" title={CARD_STATISTIC_DESCRIPTIONS[metric]}>
                <input aria-label={`Highlight ${label}`} type="checkbox" checked={rule.enabled}
                  onChange={event => onRuleChange(metric, { enabled: event.target.checked })} />
                <span className="card-stats-swatch" aria-hidden="true"
                  style={{ backgroundColor: cardStatisticCssColour(cardStatisticColour(metric, 1)) }} />
                {label}
              </label>
            </th>
            <td><div className="card-stats-cutoff">
              <select aria-label={`${label} comparison`} value={rule.comparison}
                onChange={event => onRuleChange(metric, { comparison: event.target.value === 'atMost' ? 'atMost' : 'atLeast' })}>
                <option value="atLeast">≥</option><option value="atMost">≤</option>
              </select>
              <StatisticNumberInput label={`${label} cutoff (${unit})`} value={rule.threshold} min={min} max={100} step={0.1}
                onChange={threshold => onRuleChange(metric, { threshold })} />
              <span aria-hidden="true">{unit}</span>
            </div></td>
            <td><StatisticNumberInput label={`${label} minimum player-games`} value={rule.minimumGames} min={0} step={1}
              onChange={minimumGames => onRuleChange(metric, { minimumGames })} /></td>
            <td><StatisticNumberInput label={`${label} scale end (${unit})`} value={Number((atMost ? low : high).toFixed(6))} min={atMost ? min : rule.threshold}
              max={atMost ? rule.threshold : 100} step={0.1} onChange={end => onRuleChange(metric, { scaleSpan: Math.abs(end - rule.threshold) })} /></td>
            <td><StatisticScale metric={metric} rule={rule} shading={settings.highlightShading} /></td>
            <td className="card-stats-rule-count">{(counts.get(metric) ?? 0).toLocaleString()}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="bottom-tools-note card-stats-guide">Check several rows to see their colours around the same card. The cutoff and sample minimum gate each colour.
      The scale runs from darker at lower values to brighter at higher values. Drawn difference requires the minimum in both groups.</p>
  </>;
}
