import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Card, Deck } from '@/data/dataModels';
import type { DeckLibraryEntry } from '@/data/deckLibrary';
import type { DeckStyleAssociationData } from '@/data/deckStyleAssociations';
import { createDeckStyleAnalyzer, getDeckMetrics } from '@/data/deckAnalysis';
import { getAvatarShortName, getDeckElementSummary } from './deckDisplay';
import { ElementIcon } from './ElementIcon';

interface AddedDecksPanelProps {
  entries: DeckLibraryEntry[];
  cards: Card[];
  styleData: DeckStyleAssociationData | null;
  onSelectDeck?: (deck: Deck, bottomInset?: number) => void;
  onRemoveDeck?: (id: string) => void;
}

export function AddedDecksPanel({ entries, cards, styleData, onSelectDeck, onRemoveDeck }: AddedDecksPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const [focusNonce, setFocusNonce] = useState(0);
  const selected = entries.find((entry) => entry.id === selectedId);
  const analyze = useMemo(() => styleData ? createDeckStyleAnalyzer(styleData, cards) : null, [styleData, cards]);
  const metrics = useMemo(() => selected ? getDeckMetrics(selected.deck, cards) : null, [selected, cards]);
  const styles = useMemo(() => selected && analyze ? analyze(selected.deck) : null, [selected, analyze]);
  const highestCount = Math.max(1, ...(metrics?.curve.map(([, count]) => count) ?? []));
  useLayoutEffect(() => {
    if (!selected || !pendingFocus.current) return;
    pendingFocus.current = false;
    // Measure after analysis renders so the focused deck fits above the panel.
    const bounds = panelRef.current?.closest('.bottom-folder-shell')?.getBoundingClientRect();
    onSelectDeck?.(selected.deck, bounds ? Math.max(0, window.innerHeight - bounds.top) : 0);
  }, [selected, onSelectDeck, focusNonce]);
  return (
    <div className="added-decks-panel" ref={panelRef}>
      <div className="association-deck-list" aria-label="Added decks">
        {entries.length === 0 && <p className="bottom-tools-note">Use + to import a URL, create a local deck or paste deck text.</p>}
        {entries.map(({ id, deck }) => (
          <button type="button" key={id} className={`association-deck-chip user-added-deck ${id === selectedId ? 'selected' : ''}`}
            aria-label={`Load ${deck.name}`} aria-pressed={id === selectedId}
            onClick={() => { pendingFocus.current = true; setSelectedId(id); setFocusNonce((value) => value + 1); }}>
            <span className="association-deck-avatar">{deck.name}</span>
            <span>{getAvatarShortName(deck.boards.avatar[0]?.name ?? 'No avatar')}</span>
            <span className="association-deck-elements" aria-label="Deck elements">
              {getDeckElementSummary(deck, cards).map((element) => <ElementIcon key={element} element={element} decorative />)}
            </span>
          </button>
        ))}
      </div>
      {selected && metrics && (
        <section className="added-deck-analysis" aria-label={`Analysis of ${selected.deck.name}`}>
          <div className="added-deck-analysis-heading">
            <h3>{selected.deck.name}</h3>
            <button type="button" className="tool-button" onClick={() => onRemoveDeck?.(selected.id)}>Remove deck</button>
          </div>
          <div className="added-deck-analysis-columns">
            <div>
              <h4>Deck analysis</h4>
              <dl className="deck-metrics">
                {([['Spells', metrics.spells], ['Sites', metrics.sites], ['Collection', metrics.collection],
                  ['Maybe', metrics.maybe], ['Average mana', metrics.averageCost?.toFixed(1) ?? '—']] as const)
                  .map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
              <p className="deck-analysis-types">{metrics.types.map(([type, count]) => `${count} ${type}`).join(' · ') || 'No spells in this deck.'}</p>
              {metrics.curve.length > 0 && (
                <div className="deck-mana-curve" role="img" aria-label={`Mana curve: ${metrics.curve.map(([cost, count]) => `${cost} mana: ${count} cards`).join(', ')}`}>
                  {metrics.curve.map(([cost, count]) => <div className="deck-mana-column" key={cost} title={`${cost} mana: ${count} cards`}>
                    <span>{count}</span><div className="deck-mana-bar" style={{ height: `${count / highestCount * 42}px` }} /><span>{cost}</span>
                  </div>)}
                </div>
              )}
              <p className="bottom-tools-note">Mana curve and spell metrics use the active main-deck variant.</p>
              {metrics.unknown.length > 0 && <p className="deck-create-note error">Missing card details: {metrics.unknown.join(', ')}. These cards are excluded from metrics.</p>}
              {metrics.uncostedSpells > 0 && <p className="bottom-tools-note">{metrics.uncostedSpells} spells have no known mana cost and are excluded from the average.</p>}
            </div>
            <div>
              <h4>Style analysis</h4>
              {styles && styles.profiles.length > 0 ? <>
                <p className="bottom-tools-note">Estimated affinity from {styles.neighborCount} similar deck{styles.neighborCount === 1 ? '' : 's'}; closest match {Math.round(styles.closestSimilarity * 100)}%. Includes avatar and Collection; excludes Maybe.</p>
                <div className="added-deck-style-list">
                  {styles.profiles.map((style) => <div key={style.id} className={`added-deck-style ${style.primary ? 'primary' : ''}`}>
                    <div><span>{style.name}{style.primary ? ' · strongest' : ''}</span><strong>{Math.round(style.score * 100)}%</strong></div>
                    <meter min="0" max="1" value={style.score} aria-label={`${style.name} affinity`} />
                    {style.subStyles.length > 0 && <span className="deck-style-subtypes">{style.subStyles.slice(0, 2).map((sub) => `${sub.name} ${Math.round(sub.score * 100)}%`).join(' · ')}</span>}
                  </div>)}
                </div>
                <p className="bottom-tools-note">Scores describe style affinity, not win rates.</p>
              </> : <p className="bottom-tools-note">{styleData ? 'No comparable deck yet. Add recognised main-deck cards to estimate its styles.' : 'Style analysis is unavailable until the bundled style data loads.'}</p>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
