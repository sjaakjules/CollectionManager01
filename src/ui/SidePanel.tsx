/**
 * Side panel for loading decks from curiosa.io
 */

import { useState, useCallback } from 'react';
import { useAppState, selectActiveDeck } from '@/app/AppState';
import { fetchCuriosaDeck } from '@/data/curiosaService';

export function SidePanel() {
  const { state, dispatch } = useAppState();
  const activeDeck = selectActiveDeck(state);
  const [deckUrl, setDeckUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTogglePanel = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIDE_PANEL' });
  }, [dispatch]);

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

  if (!state.ui.sidePanelOpen) {
    return (
      <button className="side-panel-toggle collapsed" onClick={handleTogglePanel}>
        &gt;
      </button>
    );
  }

  const mainboardCount = activeDeck
    ? activeDeck.boards.mainboard.reduce((sum, c) => sum + c.quantity, 0)
    : 0;
  const sideboardCount = activeDeck
    ? activeDeck.boards.sideboard.reduce((sum, c) => sum + c.quantity, 0)
    : 0;
  const avatarCount = activeDeck
    ? activeDeck.boards.avatar.reduce((sum, c) => sum + c.quantity, 0)
    : 0;

  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <h2>Load Deck</h2>
        <button className="side-panel-toggle" onClick={handleTogglePanel}>
          &lt;
        </button>
      </div>

      <div className="side-panel-content">
        <div className="load-deck-form">
          <input
            type="text"
            placeholder="curiosa.io deck URL..."
            value={deckUrl}
            onChange={(e) => setDeckUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLoadDeck()}
            disabled={isLoading}
          />
          <button onClick={handleLoadDeck} disabled={!deckUrl.trim() || isLoading}>
            {isLoading ? '...' : 'Load'}
          </button>
        </div>

        {error && <div className="load-deck-error">{error}</div>}

        {activeDeck && (
          <div className="loaded-deck-info">
            <h3>{activeDeck.name}</h3>
            <div className="deck-stats">
              <div className="stat-row">
                <span>Mainboard</span>
                <span>{mainboardCount}</span>
              </div>
              <div className="stat-row">
                <span>Sideboard</span>
                <span>{sideboardCount}</span>
              </div>
              <div className="stat-row">
                <span>Avatar</span>
                <span>{avatarCount}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
