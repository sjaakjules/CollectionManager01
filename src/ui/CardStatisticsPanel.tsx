import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  ANALYTICS_MAX_BYTES, ANALYTICS_METRICS, PLAY_SORCERY_CARDS_URL, analyticsNameKey,
  drawnDifference, matchAnalyticsCards, parseAnalyticsText,
  type AnalyticsMetric, type AnalyticsSample, type AnalyticsSnapshot,
} from '@/data/playSorceryAnalytics';
import { loadAnalyticsSnapshot, saveAnalyticsSnapshot } from '@/data/playSorceryAnalyticsStorage';
import { downloadTextFile } from '@/data/importExport';
import './cardStatistics.css';

const METRIC_LABELS: Record<AnalyticsMetric, string> = {
  inDeck: 'In deck', played: 'Played', openingHand: 'Opening hand',
  inHand: 'In hand', notInHand: 'Never in hand', inDeckUnplayed: 'In deck, unplayed',
};
const METRIC_DESCRIPTIONS: Record<AnalyticsMetric, string> = {
  inDeck: 'The card was in the player’s deck.',
  played: 'The card was played at least once; uncertain play histories are excluded.',
  openingHand: 'The card was kept in the opening hand after the mulligan.',
  inHand: 'The card was seen in hand after the mulligan, including later draws.',
  notInHand: 'The card was in the deck but never seen in hand; incomplete hand histories are excluded.',
  inDeckUnplayed: 'The card was in the deck but not played; uncertain play histories are excluded.',
};
const PAGE_SIZE = 40;
const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
const number = (value: number | null) => value === null ? 'Not reported' : value.toLocaleString();

function SampleRate({ sample }: { sample: AnalyticsSample }) {
  return <span className="card-stats-rate">
    <strong>{percent(sample.winRate)}</strong>
    <small>{sample.playerGames === null ? 'Not reported' : `${number(sample.playerGames)} player-games`}</small>
  </span>;
}

interface CardStatisticsPanelProps {
  cards: ReadonlyArray<{ name: string }>;
  filteredCards: ReadonlyArray<{ name: string }>;
}

export function CardStatisticsPanel({ cards, filteredCards }: CardStatisticsPanelProps) {
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [metric, setMetric] = useState<AnalyticsMetric>('inDeck');
  const [minimum, setMinimum] = useState(0);
  const [scope, setScope] = useState('all');
  const [sort, setSort] = useState('share');
  const [page, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAnalyticsSnapshot().then((saved) => { if (!cancelled) setSnapshot(saved); })
      .catch(() => { if (!cancelled) setError('Could not read saved statistics. You can import a JSON snapshot again.'); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);

  const matched = useMemo(() => snapshot ? matchAnalyticsCards(snapshot, cards) : [], [snapshot, cards]);
  const unmatchedCount = useMemo(() => matched.filter((row) => !row.catalogueName).length, [matched]);
  const filteredNames = useMemo(() => new Set(filteredCards.map((card) => card.name)), [filteredCards]);
  const rows = useMemo(() => {
    const search = analyticsNameKey(query);
    const result = matched.filter(({ stats, catalogueName }) =>
      analyticsNameKey(stats.cardName).includes(search)
      && (scope !== 'unmatched' || !catalogueName)
      && (scope !== 'catalogue' || (catalogueName !== null && filteredNames.has(catalogueName)))
      && (minimum === 0 || (stats[metric].playerGames !== null && stats[metric].playerGames >= minimum)));
    return result.sort((a, b) => {
      if (sort === 'name') return a.stats.cardName.localeCompare(b.stats.cardName);
      const av = sort === 'share' ? a.stats.deckShare : a.stats[metric].winRate;
      const bv = sort === 'share' ? b.stats.deckShare : b.stats[metric].winRate;
      if (av === null) return bv === null ? a.stats.cardName.localeCompare(b.stats.cardName) : 1;
      if (bv === null) return -1;
      return (sort === 'low' ? av - bv : bv - av) || a.stats.cardName.localeCompare(b.stats.cardName);
    });
  }, [matched, query, scope, filteredNames, minimum, metric, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const selected = matched.find(({ stats }) => stats.cardKey === selectedKey);
  const delta = selected ? drawnDifference(selected.stats) : null;

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      if (file.size > ANALYTICS_MAX_BYTES) throw new Error('Analytics files must be smaller than 10 MB.');
      const next = parseAnalyticsText(await file.text());
      try { await saveAnalyticsSnapshot(next); }
      catch { throw new Error('Browser storage could not save this import. Your previous snapshot has been kept.'); }
      setSnapshot(next); setPage(0); setSelectedKey(null);
      setNotice(`Saved ${next.data.cards.length.toLocaleString()} card statistics in this browser.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not import these statistics.');
    } finally { setBusy(false); }
  }

  return <section className="card-statistics" aria-label="Card statistics">
    <div className="card-stats-heading">
      <div><h3>Card performance</h3><p>Play Sorcery Online · Constructed · Local snapshot</p></div>
      <div className="card-stats-actions">
        <label className={`tool-button card-stats-import ${busy ? 'is-busy' : ''}`}>
          {busy ? 'Loading…' : 'Import JSON'}
          <input aria-label="Import constructed card statistics JSON" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void importFile(event)} />
        </label>
        {snapshot && <button className="tool-button" type="button" onClick={() => downloadTextFile(`playsorcery-constructed-${snapshot.data.releasedThrough}.json`, JSON.stringify(snapshot, null, 2))}>Export snapshot</button>}
        <a className="tool-button" href={PLAY_SORCERY_CARDS_URL} target="_blank" rel="noreferrer">Open data export ↗</a>
      </div>
    </div>
    {error && <p className="card-stats-error" role="alert">{error}</p>}
    {notice && <p className="bottom-tools-note" role="status">{notice}</p>}
    <details className="card-stats-help">
      <summary>Download and read these statistics</summary>
      <p>Sign in yourself at <a href="https://playsorceryonline.com/game-analytics" target="_blank" rel="noreferrer">Play Sorcery Online</a>, then open the data export in that same browser. Save the JSON response and import it here. Use the full Constructed response without date or Avatar filters.</p>
      <p>In Safari’s Network inspector, select the cards request and choose Save File. Import the response body only. Keep cookies, request headers and HAR files out of the import.</p>
      <p>Refresh manually when the site releases a new batch. Statistics stay in this browser and work in guest mode; they are not uploaded with your decks. The app never polls the source.</p>
      <p>One match can contribute two player-games. Rates describe observed outcomes, not the effect of adding a card or a prediction for your deck. Small samples are noisy, and played-card rates depend on which games lasted long enough to play the card. “—” means not reported, not zero.</p>
    </details>
    {!snapshot && !busy && <p className="card-stats-empty">Import a Constructed JSON snapshot to explore card usage, win rates and sample sizes.</p>}
    {snapshot && <>
      <div className="card-stats-summary">
        <span><strong>{number(snapshot.data.totalGames)}</strong> matches</span>
        <span><strong>{number(snapshot.data.totalPlayerGames)}</strong> player-games</span>
        <span><strong>{number(matched.length)}</strong> cards</span>
        <span>Released through <strong>{snapshot.data.releasedThrough} UTC</strong></span>
      </div>
      <p className="bottom-tools-note">Generated {new Date(snapshot.data.generatedAt).toISOString().slice(0, 10)} · Imported {snapshot.importedAt.slice(0, 10)} · {unmatchedCount} unmatched card names, retained below.</p>
      <div className="card-stats-controls">
        <label>Search cards<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
        <label>Win rate<select value={metric} onChange={(event) => { setMetric(event.target.value as AnalyticsMetric); setPage(0); }}>{ANALYTICS_METRICS.map((key) => <option key={key} value={key}>{METRIC_LABELS[key]}</option>)}</select></label>
        <label>Minimum player-games<select value={minimum} onChange={(event) => { setMinimum(Number(event.target.value)); setPage(0); }}><option value={0}>All samples</option><option value={100}>100+</option><option value={1000}>1,000+</option></select></label>
        <label>Show<select value={scope} onChange={(event) => { setScope(event.target.value); setPage(0); }}><option value="all">All source cards</option><option value="catalogue">Current catalogue filter</option><option value="unmatched">Unmatched names ({unmatchedCount})</option></select></label>
        <label>Sort<select value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }}><option value="share">Deck share</option><option value="high">Win rate: high first</option><option value="low">Win rate: low first</option><option value="name">Card name</option></select></label>
      </div>
      <p className="bottom-tools-note">{METRIC_DESCRIPTIONS[metric]} Minimum sample and win-rate sorting use this column.</p>
      {selected && <section className="card-stats-detail" aria-label={`Statistics for ${selected.stats.cardName}`}>
        <div className="card-stats-heading"><h4>{selected.catalogueName ?? selected.stats.cardName}</h4><button type="button" className="tool-button" onClick={() => setSelectedKey(null)}>Close details</button></div>
        {!selected.catalogueName && <p className="card-stats-unmatched">Unmatched in the local catalogue. Statistics are retained under the source name.</p>}
        <div className="card-stats-cohorts">{ANALYTICS_METRICS.map((key) => <div key={key} title={METRIC_DESCRIPTIONS[key]}><h5>{METRIC_LABELS[key]}</h5><SampleRate sample={selected.stats[key]} /><small>{number(selected.stats[key].wins)} wins · {number(selected.stats[key].matches)} matches</small></div>)}</div>
        <p className="bottom-tools-note">In hand versus never in hand: {delta === null ? 'not reported' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} percentage points`}. The two groups can differ in other ways.</p>
      </section>}
      <div className="card-stats-table-wrap"><table className="card-stats-table">
        <thead><tr><th scope="col">Card</th><th scope="col" title="Share of player-games with this card in the deck">Deck share</th><th scope="col">{METRIC_LABELS[metric]} win rate</th></tr></thead>
        <tbody>{visibleRows.map(({ stats, catalogueName }) => <tr key={stats.cardKey} className={selectedKey === stats.cardKey ? 'selected' : ''}>
          <td><button type="button" aria-expanded={selectedKey === stats.cardKey} onClick={() => setSelectedKey(stats.cardKey)}>{catalogueName ?? stats.cardName}</button>{!catalogueName && <small className="card-stats-unmatched">Unmatched</small>}</td>
          <td><strong>{percent(stats.deckShare)}</strong><meter min={0} max={1} value={stats.deckShare} aria-label={`${stats.cardName} deck share`} /></td>
          <td><SampleRate sample={stats[metric]} /></td>
        </tr>)}</tbody>
      </table></div>
      {rows.length === 0 && <p className="bottom-tools-note">No cards match these filters.</p>}
      <nav className="card-stats-pagination" aria-label="Card statistics pages">
        <button className="tool-button" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>{rows.length ? `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, rows.length)}` : '0'} of {rows.length.toLocaleString()} cards</span>
        <button className="tool-button" type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
      </nav>
    </>}
  </section>;
}
