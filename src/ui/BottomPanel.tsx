/**
 * Bottom panel for archetype highlighting and deck loading
 *
 * Displays archetype category buttons that, when selected,
 * highlight cards in the collection/deck matching that archetype.
 * Also provides a deck URL input to load decks from curiosa.io.
 */

import { useEffect, useState, useCallback } from 'react';
import { useAppState, selectActiveDeck } from '@/app/AppState';
import {
  loadArchetypeScores,
  getArchetypeNames,
  formatArchetypeName,
  type ArchetypeScores,
} from '@/data/archetypeScores';
import { fetchCuriosaDeck } from '@/data/curiosaService';

export function BottomPanel() {
  const { state, dispatch } = useAppState();
  const activeDeck = selectActiveDeck(state);
  const [archetypes, setArchetypes] = useState<string[]>([]);
  const [scores, setScores] = useState<ArchetypeScores | null>(null);
  const [deckUrl, setDeckUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadArchetypeScores().then((data) => {
      setScores(data);
      setArchetypes(getArchetypeNames(data));
    });
  }, []);

  const selectedArchetype = state.ui.selectedArchetype;

  const handleClick = (archetype: string) => {
    dispatch({ type: 'SET_SELECTED_ARCHETYPE', archetype });
  };

  const handleLoadDeck = useCallback(async () => {
    if (!deckUrl.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const deck = await fetchCuriosaDeck(deckUrl.trim());
      dispatch({ type: 'CREATE_DECK', deck });
      dispatch({ type: 'SET_ACTIVE_DECK', deckId: deck.id });
      setDeckUrl('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load deck';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [deckUrl, isLoading, dispatch]);

  return (
    <div className="bottom-panel">
      {scores && archetypes.length > 0 && (
        <div className="bottom-panel-buttons">
          {archetypes.map((archetype) => (
            <button
              key={archetype}
              className={`archetype-button ${selectedArchetype === archetype ? 'active' : ''}`}
              onClick={() => handleClick(archetype)}
            >
              {formatArchetypeName(archetype)}
            </button>
          ))}
        </div>
      )}

      <div className="bottom-panel-deck">
        <span className="deck-label">
          {activeDeck ? activeDeck.name : 'Load Deck'}
        </span>
        <div className="load-deck-row">
          <input
            type="text"
            placeholder="curiosa.io deck URL..."
            value={deckUrl}
            onChange={(e) => setDeckUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLoadDeck()}
            disabled={isLoading}
          />
          <button type="button" onClick={handleLoadDeck} disabled={!deckUrl.trim() || isLoading}>
            {isLoading ? '...' : 'Load'}
          </button>
        </div>
        {error && <div className="load-deck-error">{error}</div>}
      </div>
    </div>
  );
}

/**
 * Export getter for archetype scores for use by PixiCanvas
 */
export { loadArchetypeScores } from '@/data/archetypeScores';
