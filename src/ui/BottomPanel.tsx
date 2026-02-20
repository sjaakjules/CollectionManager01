/**
 * Bottom panel for archetype highlighting and deck loading
 *
 * Displays archetype category buttons that, when selected,
 * highlight cards in the collection/deck matching that archetype.
 * Also provides a deck URL input to load decks from curiosa.io.
 * Includes an "Add Category" button to create new categories.
 */

import { useEffect, useState, useCallback } from 'react';
import { useAppState, selectActiveDeck } from '@/app/AppState';
import {
  loadArchetypeScores,
  getArchetypeNames,
  formatArchetypeName,
  addCategory,
  invalidateArchetypeCache,
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
  const [showLoadDeckInput, setShowLoadDeckInput] = useState(false);

  // Add-category UI state
  const [showAddInput, setShowAddInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (state.userData?.archetypeScores) {
      const userScores = state.userData.archetypeScores;
      setScores(userScores);
      setArchetypes(getArchetypeNames(userScores));
    } else {
      loadArchetypeScores().then((data) => {
        if (cancelled) return;
        setScores(data);
        setArchetypes(getArchetypeNames(data));
      }).catch((error) => {
        if (cancelled) return;
        console.warn('Failed to load archetype scores:', error);
        setScores(null);
        setArchetypes([]);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [state.userData?.id, state.userData?.archetypeScores]);

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
      setShowLoadDeckInput(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load deck';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [deckUrl, isLoading, dispatch]);

  const handleOpenAccount = useCallback(() => {
    dispatch({ type: 'TOGGLE_LOGIN_MODAL' });
  }, [dispatch]);

  const handleToggleLoadDeck = useCallback(() => {
    setShowLoadDeckInput((prev) => !prev);
    setError(null);
  }, []);

  const handleToggleLabelMode = useCallback(() => {
    dispatch({
      type: 'SET_LABEL_PLACEMENT_MODE',
      enabled: !state.ui.labelPlacementMode,
    });
  }, [dispatch, state.ui.labelPlacementMode]);

  const handleAddCategory = useCallback(async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed || addingCategory) return;

    setAddingCategory(true);
    setAddError(null);

    try {
      const sanitized = await addCategory(trimmed);

      // Refresh the archetype list from updated cache
      const refreshed = await loadArchetypeScores();
      setScores(refreshed);
      invalidateArchetypeCache();
      setArchetypes(getArchetypeNames(refreshed));

      setNewCategoryName('');
      setShowAddInput(false);

      // Auto-select the new category
      dispatch({ type: 'SET_SELECTED_ARCHETYPE', archetype: sanitized });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add category';
      setAddError(message);
    } finally {
      setAddingCategory(false);
    }
  }, [newCategoryName, addingCategory, dispatch]);

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddCategory();
    } else if (e.key === 'Escape') {
      setShowAddInput(false);
      setNewCategoryName('');
      setAddError(null);
    }
  };

  return (
    <div className="bottom-panel">
      {scores && archetypes.length > 0 && (
        <div className="bottom-panel-buttons">
          {archetypes.map((archetype) => (
            <button
              type="button"
              key={archetype}
              className={`archetype-button ${selectedArchetype === archetype ? 'active' : ''}`}
              onClick={() => handleClick(archetype)}
            >
              {formatArchetypeName(archetype)}
            </button>
          ))}

          {showAddInput ? (
            <div className="add-category-inline">
              <input
                type="text"
                className="add-category-input"
                placeholder="Category name..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={handleAddKeyDown}
                disabled={addingCategory}
                autoFocus
              />
              <button
                type="button"
                className="add-category-confirm"
                onClick={handleAddCategory}
                disabled={!newCategoryName.trim() || addingCategory}
              >
                {addingCategory ? '...' : 'Add'}
              </button>
              <button
                type="button"
                className="add-category-cancel"
                onClick={() => {
                  setShowAddInput(false);
                  setNewCategoryName('');
                  setAddError(null);
                }}
              >
                ✕
              </button>
              {addError && <span className="add-category-error">{addError}</span>}
            </div>
          ) : (
            <button
              type="button"
              className="archetype-button add-category-btn"
              onClick={() => setShowAddInput(true)}
            >
              +
            </button>
          )}
        </div>
      )}

      <div className="bottom-panel-deck">
        <button
          type="button"
          className={`archetype-button ${state.ui.labelPlacementMode ? 'active' : ''}`}
          onClick={handleToggleLabelMode}
        >
          {state.ui.labelPlacementMode ? 'Click Canvas...' : 'Add Label'}
        </button>

        <button
          type="button"
          className="archetype-button"
          onClick={handleOpenAccount}
        >
          {state.session.isGuest ? 'Log In' : (state.session.username ?? 'Account')}
        </button>

        <button
          type="button"
          className={`archetype-button ${showLoadDeckInput ? 'active' : ''}`}
          onClick={handleToggleLoadDeck}
        >
          Load Deck
        </button>

        {activeDeck && (
          <span className="deck-label" title={activeDeck.name}>
            {activeDeck.name}
          </span>
        )}

        {showLoadDeckInput && (
          <>
            <div className="load-deck-row">
              <input
                type="text"
                placeholder="curiosa.io deck URL..."
                value={deckUrl}
                onChange={(e) => setDeckUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLoadDeck()}
                disabled={isLoading}
                autoFocus
              />
              <button
                type="button"
                onClick={handleLoadDeck}
                disabled={!deckUrl.trim() || isLoading}
              >
                {isLoading ? '...' : 'Load'}
              </button>
            </div>
            {error && <div className="load-deck-error">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Export getter for archetype scores for use by PixiCanvas
 */
export { loadArchetypeScores } from '@/data/archetypeScores';
