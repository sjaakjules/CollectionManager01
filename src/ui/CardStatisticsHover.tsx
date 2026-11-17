import { CARD_STATISTIC_LABELS, CARD_STATISTIC_METRICS, formatCardStatistic, type CardStatistics } from '@/data/cardStatistics';
import { cardStatisticCssColour, type CardStatisticOutline, type CardStatisticRules } from '@/data/cardStatisticHighlights';
import './cardStatisticsHover.css';

export function CardStatisticsHover({ name, stats, releasedThrough, rules, outlines }: {
  name: string;
  stats: CardStatistics | undefined;
  releasedThrough: string;
  rules: CardStatisticRules;
  outlines?: readonly CardStatisticOutline[];
}) {
  return <aside className="card-hover-statistics" aria-label={`Card statistics for ${name}`}>
    <h3>{name}</h3>
    <p>Constructed · through {releasedThrough}</p>
    {stats ? <>
      <dl>{CARD_STATISTIC_METRICS.map(metric => {
        const sample = stats[metric];
        const lowSample = sample.games !== null && sample.games < rules[metric].minimumGames && sample.value !== null;
        const outline = outlines?.find(entry => entry.metric === metric);
        return <div key={metric} className={lowSample ? 'low-sample' : undefined}>
          <dt>{outline && <span className="card-hover-stat-colour" role="img" aria-label="Highlighted"
            style={{ backgroundColor: cardStatisticCssColour(outline.colour) }} />}{CARD_STATISTIC_LABELS[metric]}</dt>
          <dd><strong>{formatCardStatistic(metric, sample.value)}</strong><small>{sample.games === null ? 'Not reported' : `n ${sample.games.toLocaleString()}${lowSample ? ' · small sample' : ''}`}</small></dd>
        </div>;
      })}</dl>
      <p>n = player-games; drawn difference uses the smaller group. — = not reported. Observed results, not a deck prediction.</p>
    </> : <p>No published statistics for this card.</p>}
    <footer>Play Sorcery Online</footer>
  </aside>;
}
