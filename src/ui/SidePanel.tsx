/**
 * Collapsible side panel for deck management
 *
 * Features:
 * - Deck list with create/rename/delete
 * - Active deck selection
 * - Board selection (mainboard, sideboard, avatar, maybeboard)
 * - Deck statistics and validation status
 */

import { useState, useCallback } from 'react';
import { useAppState, selectActiveDeck } from '@/app/AppState';
import { createEmptyDeck, DECK_LIMITS } from '@/data/dataModels';
import { generateUUID } from '@/utils/uuid';
import { validateDeck, type ValidationResult } from '@/rules/deckRules';

export function SidePanel() {
  const { state, dispatch } = useAppState();
  const activeDeck = selectActiveDeck(state);
  const [newDeckName, setNewDeckName] = useState('');
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleTogglePanel = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIDE_PANEL' });
  }, [dispatch]);

  const handleCreateDeck = useCallback(() => {
    if (!newDeckName.trim()) return;

    const deck = createEmptyDeck(newDeckName.trim(), generateUUID());
    dispatch({ type: 'CREATE_DECK', deck });
    dispatch({ type: 'SET_ACTIVE_DECK', deckId: deck.id });
    setNewDeckName('');
  }, [newDeckName, dispatch]);

  const handleSelectDeck = useCallback(
    (deckId: string) => {
      dispatch({ type: 'SET_ACTIVE_DECK', deckId });
    },
    [dispatch]
  );

  const handleDeleteDeck = useCallback(
    (deckId: string) => {
      dispatch({ type: 'DELETE_DECK', deckId });
    },
    [dispatch]
  );

  const handleStartRename = useCallback((deckId: string, currentName: string) => {
    setEditingDeckId(deckId);
    setEditingName(currentName);
  }, []);

  const handleFinishRename = useCallback(() => {
    if (editingDeckId && editingName.trim()) {
      dispatch({
        type: 'RENAME_DECK',
        deckId: editingDeckId,
        name: editingName.trim(),
      });
    }
    setEditingDeckId(null);
    setEditingName('');
  }, [editingDeckId, editingName, dispatch]);

  const handleSetActiveBoard = useCallback(
    (board: 'mainboard' | 'sideboard' | 'avatar' | 'maybeboard') => {
      dispatch({ type: 'SET_ACTIVE_BOARD', board });
    },
    [dispatch]
  );

  if (!state.ui.sidePanelOpen) {
    return (
      <button className="side-panel-toggle collapsed" onClick={handleTogglePanel}>
        &gt;
      </button>
    );
  }

  const validation = activeDeck ? validateDeck(activeDeck, state.cards) : null;

  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <h2>Decks</h2>
        <button className="side-panel-toggle" onClick={handleTogglePanel}>
          &lt;
        </button>
      </div>

      <div className="side-panel-content">
        {/* Create new deck */}
        <div className="create-deck">
          <input
            type="text"
            placeholder="New deck name..."
            value={newDeckName}
            onChange={(e) => setNewDeckName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateDeck()}
          />
          <button onClick={handleCreateDeck} disabled={!newDeckName.trim()}>
            Create
          </button>
        </div>

        {/* Deck list */}
        <ul className="deck-list">
          {state.userData?.decks.map((deck) => (
            <li
              key={deck.id}
              className={`deck-item ${deck.id === state.editor.activeDeckId ? 'active' : ''}`}
            >
              {editingDeckId === deck.id ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={handleFinishRename}
                  onKeyDown={(e) => e.key === 'Enter' && handleFinishRename()}
                  autoFocus
                />
              ) : (
                <>
                  <span
                    className="deck-name"
                    onClick={() => handleSelectDeck(deck.id)}
                  >
                    {deck.name}
                  </span>
                  <div className="deck-actions">
                    <button
                      onClick={() => handleStartRename(deck.id, deck.name)}
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDeleteDeck(deck.id)}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>

        {/* Active deck details */}
        {activeDeck && (
          <div className="active-deck-details">
            <h3>{activeDeck.name}</h3>

            {/* Board selector */}
            <div className="board-selector">
              {(['mainboard', 'sideboard', 'avatar', 'maybeboard'] as const).map(
                (board) => (
                  <button
                    key={board}
                    className={state.editor.activeBoard === board ? 'active' : ''}
                    onClick={() => handleSetActiveBoard(board)}
                  >
                    {board.charAt(0).toUpperCase() + board.slice(1)}
                  </button>
                )
              )}
            </div>

            {/* Deck statistics */}
            <DeckStats deck={activeDeck} validation={validation} />
          </div>
        )}

        {/* Login button */}
        <div className="side-panel-footer">
          <button onClick={() => dispatch({ type: 'TOGGLE_LOGIN_MODAL' })}>
            {state.session.isGuest ? 'Login' : `Logged in as ${state.session.username}`}
          </button>
        </div>
      </div>
    </div>
  );
}

interface DeckStatsProps {
  deck: ReturnType<typeof selectActiveDeck>;
  validation: ValidationResult | null;
}

function DeckStats({ deck, validation }: DeckStatsProps) {
  if (!deck) return null;

  const mainboardCount = deck.boards.mainboard.reduce((sum, c) => sum + c.quantity, 0);
  const sideboardCount = deck.boards.sideboard.reduce((sum, c) => sum + c.quantity, 0);
  const avatarCount = deck.boards.avatar.reduce((sum, c) => sum + c.quantity, 0);

  return (
    <div className="deck-stats">
      <div className="stat-row">
        <span>Mainboard:</span>
        <span className={mainboardCount > 90 ? 'warning' : ''}>
          {mainboardCount} / 90 (60 spells + 30 sites)
        </span>
      </div>
      <div className="stat-row">
        <span>Sideboard:</span>
        <span className={sideboardCount > DECK_LIMITS.SIDEBOARD_COUNT ? 'warning' : ''}>
          {sideboardCount} / {DECK_LIMITS.SIDEBOARD_COUNT}
        </span>
      </div>
      <div className="stat-row">
        <span>Avatar:</span>
        <span className={avatarCount > DECK_LIMITS.AVATAR_COUNT ? 'warning' : ''}>
          {avatarCount} / {DECK_LIMITS.AVATAR_COUNT}
        </span>
      </div>

      {validation && validation.errors.length > 0 && (
        <div className="validation-errors">
          <h4>Issues:</h4>
          <ul>
            {validation.errors.map((error, i) => (
              <li key={i} className="error">
                {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
