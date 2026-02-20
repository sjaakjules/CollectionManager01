/**
 * React component that hosts the PixiJS canvas
 *
 * This component:
 * - Creates and manages the PixiJS application lifecycle
 * - Bridges React state to PixiJS rendering
 * - Handles canvas resize
 * - Renders a texture loading bar during initial card load
 *
 * IMPORTANT: React does NOT directly manipulate PixiJS objects.
 * State flows one-way: React state -> PixiJS reads state for rendering.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useAppState } from "@/app/AppState";
import { PixiStage } from "./PixiStage";
import {
  loadArchetypeScores,
  type ArchetypeScores,
} from "@/data/archetypeScores";

export function PixiCanvas({ splashDone }: { splashDone: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PixiStage | null>(null);
  const { state, dispatch } = useAppState();
  const [archetypeScores, setArchetypeScores] =
    useState<ArchetypeScores | null>(null);
  const [loadProgress, setLoadProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);

  // Load archetype scores once
  useEffect(() => {
    loadArchetypeScores().then(setArchetypeScores);
  }, []);

  // Stable progress callback (ref-based to avoid recreating PixiStage)
  const progressRef = useRef(setLoadProgress);
  progressRef.current = setLoadProgress;

  // Initialize PixiJS stage
  useEffect(() => {
    if (!containerRef.current) return;

    let clearTimerId: ReturnType<typeof setTimeout> | undefined;

    const stage = new PixiStage({
      container: containerRef.current,
      onAddToDeck: (cardName) => {
        dispatch({ type: "ADD_CARD_TO_DECK", cardName });
      },
      onRemoveFromDeck: (cardName) => {
        dispatch({ type: "REMOVE_CARD_FROM_DECK", cardName });
      },
      onTextureProgress: (loaded, total) => {
        // Cancel any pending clear-timeout from a previous reveal
        if (clearTimerId !== undefined) {
          clearTimeout(clearTimerId);
          clearTimerId = undefined;
        }

        progressRef.current({ loaded, total });

        if (loaded >= total) {
          // Clear after fade completes (small delay prevents flicker)
          clearTimerId = setTimeout(() => {
            progressRef.current(null);
            clearTimerId = undefined;
          }, 600);
        }
      },
    });

    stageRef.current = stage;

    return () => {
      if (clearTimerId !== undefined) clearTimeout(clearTimerId);
      stage.destroy();
      stageRef.current = null;
    };
  }, [dispatch]);

  // Update stage when cards change, start texture reveal on first load
  useEffect(() => {
    if (!stageRef.current || !state.cardsLoaded) return;

    stageRef.current.setCards(state.cards);

    // Always reset progress and replay reveal when cards change
    setLoadProgress(null);

    stageRef.current.startTextureReveal();
  }, [state.cards, state.cardsLoaded]);

  // Update overlays when deck changes, pan to deck on new load
  const prevDeckIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!stageRef.current || !state.userData) return;

    const activeDeck = state.editor.activeDeckId
      ? (state.userData.decks.find((d) => d.id === state.editor.activeDeckId) ??
        null)
      : null;

    stageRef.current.updateDeckOverlays(
      activeDeck,
      state.editor.activeBoard,
      state.userData.collection,
    );

    // Pan to deck bounds when a new deck is loaded
    const isNewDeck =
      activeDeck && state.editor.activeDeckId !== prevDeckIdRef.current;
    prevDeckIdRef.current = state.editor.activeDeckId;

    if (isNewDeck) {
      stageRef.current.panToDeckBounds();
    }
  }, [state.userData, state.editor.activeDeckId, state.editor.activeBoard]);

  // Update archetype highlighting
  useEffect(() => {
    if (!stageRef.current) return;
    stageRef.current.updateArchetypeHighlight(
      state.ui.selectedArchetype,
      archetypeScores,
    );
  }, [state.ui.selectedArchetype, archetypeScores]);

  // Prevent context menu on canvas (for right-click interactions)
  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
  }, []);

  const showLoadingBar =
    splashDone &&
    loadProgress !== null &&
    loadProgress.total > 0 &&
    loadProgress.loaded < loadProgress.total;

  return (
    <div
      ref={containerRef}
      className="pixi-canvas-container"
      onContextMenu={handleContextMenu}
    >
      {showLoadingBar && (
        <TextureLoadingBar
          loaded={loadProgress.loaded}
          total={loadProgress.total}
        />
      )}
    </div>
  );
}

function TextureLoadingBar({
  loaded,
  total,
}: {
  loaded: number;
  total: number;
}) {
  const pct = Math.round((loaded / total) * 100);

  return (
    <div
      className="texture-loading-bar"
      aria-label={`Loading cards ${loaded} of ${total}`}
    >
      <span className="texture-loading-label">Loading Cards</span>
      <progress
        className="texture-loading-progress"
        value={loaded}
        max={total}
      />
      <span className="texture-loading-count">
        {loaded} / {total} ({pct}%)
      </span>
    </div>
  );
}
