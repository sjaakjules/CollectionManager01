import { useMemo } from 'react';
import { useAppState } from '@/app/AppState';
import { CARD_STATISTIC_DESCRIPTIONS, CARD_STATISTIC_LABELS, CARD_STATISTIC_METRICS } from '@/data/cardStatistics';
import type { CardStatisticsSettings } from '@/data/cardStatisticHighlights';
import { CardStatisticRuleTable } from './CardStatisticRuleTable';
import { useCardStatistics } from './useCardStatistics';
import './cardStatistics.css';

interface CardStatisticsPanelProps {
  cards: ReadonlyArray<{ name: string }>;
  filteredCards: ReadonlyArray<{ name: string }>;
}

export function CardStatisticsPanel({ cards, filteredCards }: CardStatisticsPanelProps) {
  const { state, dispatch } = useAppState();
  const settings = state.ui.cardStatistics;
  const { asset, loading } = useCardStatistics();
  const update = (patch: Partial<CardStatisticsSettings>) => dispatch({ type: 'SET_CARD_STATISTICS', settings: patch });
  const available = useMemo(() => asset ? cards.filter(card => Object.hasOwn(asset.cards, card.name)).length : 0, [asset, cards]);
  const unmatched = useMemo(() => asset ? Object.keys(asset.unmatched) : [], [asset]);

  return <section className="card-statistics" aria-label="Card statistics">
    <div className="card-stats-heading">
      <div><h3>Card statistics</h3><p>Play Sorcery Online · Constructed</p></div>
      {asset && <p>Released through <strong>{asset.releasedThrough} UTC</strong></p>}
    </div>
    {!asset && <p role="status">{loading ? 'Loading card statistics…' : 'Card statistics aren’t available for this version of the site.'}</p>}
    {asset && <div className="card-stats-summary">
      <span><strong>{asset.totalGames.toLocaleString()}</strong> matches</span>
      <span><strong>{asset.totalPlayerGames.toLocaleString()}</strong> player-games</span>
      <span><strong>{available.toLocaleString()}</strong> catalogue cards with data</span>
    </div>}
    <fieldset className="card-stats-settings" disabled={!asset}>
      <div className="card-stats-display">
        <label className="card-stats-toggle">
          <input type="checkbox" checked={settings.showOnHover} onChange={event => update({ showOnHover: event.target.checked })} />
          Show statistics beside the hover preview
        </label>
        <label className="card-stats-toggle">
          <input type="checkbox" checked={settings.showOverlays} onChange={event => update({ showOverlays: event.target.checked })} />
          Show statistics on cards
        </label>
      </div>
      {settings.showOverlays && <>
        <p className="bottom-tools-note card-stats-guide">Choose up to three on-card values. Zoom in to read them.</p>
        <div className="card-stats-metrics">
          {CARD_STATISTIC_METRICS.map(metric => {
            const checked = settings.overlayMetrics.includes(metric);
            return <label key={metric} className="card-stats-toggle" title={CARD_STATISTIC_DESCRIPTIONS[metric]}>
              <input type="checkbox" checked={checked} disabled={!checked && settings.overlayMetrics.length >= 3}
                onChange={event => update({ overlayMetrics: event.target.checked
                  ? [...settings.overlayMetrics, metric]
                  : settings.overlayMetrics.filter(key => key !== metric) })} />
              {CARD_STATISTIC_LABELS[metric]}
            </label>;
          })}
        </div>
      </>}
      {asset && <CardStatisticRuleTable asset={asset} filteredCards={filteredCards} settings={settings} onChange={update}
        onRuleChange={(metric, change) => dispatch({ type: 'SET_CARD_STATISTIC_RULE', metric, change })} />}
    </fieldset>
    <details className="card-stats-help"><summary>About these statistics{unmatched.length ? ` · ${unmatched.length} unmatched source names` : ''}</summary>
      <p>The starting cutoffs help you find cards to investigate. Check the sample for each rate and compare cards used in similar decks. Played win rates reflect when players could and chose to use the card.</p>
      <p>One match can contribute two player-games. Deck share uses all player-games as its denominator. Drawn difference subtracts never-drawn win rate from in-hand win rate, in percentage points. “—” means unavailable.</p>
      <p>Category, deck style and statistics highlights share the canvas. Switching highlight types keeps your statistic rules for this visit.</p>
      {unmatched.length > 0 && <p>These source names have no catalogue match: {unmatched.join(', ')}.</p>}
    </details>
  </section>;
}
