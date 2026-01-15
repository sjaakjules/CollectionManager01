/**
 * React component that hosts the PixiJS canvas
 *
 * This component:
 * - Creates and manages the PixiJS application lifecycle
 * - Bridges React state to PixiJS rendering
 * - Handles canvas resize
 *
 * IMPORTANT: React does NOT directly manipulate PixiJS objects.
 * State flows one-way: React state -> PixiJS reads state for rendering.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppState } from '@/app/AppState';
import { PixiStage } from './PixiStage';

export function PixiCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PixiStage | null>(null);
  const { state, dispatch } = useAppState();

  // Initialize PixiJS stage
  useEffect(() => {
    if (!containerRef.current) return;

    const stage = new PixiStage({
      container: containerRef.current,
      onAddToDeck: (cardName) => {
        dispatch({ type: 'ADD_CARD_TO_DECK', cardName });
      },
      onRemoveFromDeck: (cardName) => {
        dispatch({ type: 'REMOVE_CARD_FROM_DECK', cardName });
      },
    });

    stageRef.current = stage;

    return () => {
      stage.destroy();
      stageRef.current = null;
    };
  }, [dispatch]);

  // Update stage when cards change
  useEffect(() => {
    if (!stageRef.current || !state.cardsLoaded) return;
    stageRef.current.setCards(state.cards);
  }, [state.cards, state.cardsLoaded]);

  // Update overlays when deck changes
  useEffect(() => {
    if (!stageRef.current || !state.userData) return;

    const activeDeck = state.editor.activeDeckId
      ? state.userData.decks.find((d) => d.id === state.editor.activeDeckId)
      : null;

    stageRef.current.updateDeckOverlays(
      activeDeck,
      state.editor.activeBoard,
      state.userData.collection
    );
  }, [state.userData, state.editor.activeDeckId, state.editor.activeBoard]);

  // Prevent context menu on canvas (for right-click interactions)
  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
  }, []);

  return (
    <div
      ref={containerRef}
      className="pixi-canvas-container"
      onContextMenu={handleContextMenu}
    />
  );
}
