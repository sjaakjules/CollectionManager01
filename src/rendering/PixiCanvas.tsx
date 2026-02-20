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
  setCachedArchetypeScores,
  setArchetypeSaveHandler,
  type ArchetypeScores,
} from "@/data/archetypeScores";

export function PixiCanvas({ splashDone }: { splashDone: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PixiStage | null>(null);
  const { state, dispatch } = useAppState();
  const userId = state.userData?.id ?? null;
  const userArchetypeScores = state.userData?.archetypeScores ?? null;
  const [archetypeScores, setArchetypeScores] =
    useState<ArchetypeScores | null>(null);
  const [loadProgress, setLoadProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);
  const [backgroundLoadProgress, setBackgroundLoadProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);

  // Load archetype scores from userData (when present) or static seed fallback.
  useEffect(() => {
    let cancelled = false;

    if (userArchetypeScores) {
      setCachedArchetypeScores(userArchetypeScores);
      setArchetypeScores(userArchetypeScores);
      return () => {
        cancelled = true;
      };
    }

    setCachedArchetypeScores(null);
    loadArchetypeScores().then((scores) => {
      if (cancelled) return;
      setArchetypeScores(scores);
    }).catch((error) => {
      if (cancelled) return;
      console.warn("Failed to load archetype seed scores:", error);
      setArchetypeScores(null);
    });

    return () => {
      cancelled = true;
    };
  }, [userArchetypeScores]);

  // Route archetype score saves into userData for both guest and logged-in users.
  useEffect(() => {
    if (!userId) {
      setArchetypeSaveHandler(null);
      return;
    }

    setArchetypeSaveHandler((scores) => {
      const cloned =
        typeof structuredClone === "function"
          ? structuredClone(scores)
          : (JSON.parse(JSON.stringify(scores)) as ArchetypeScores);
      dispatch({ type: "SET_ARCHETYPE_SCORES", scores: cloned });
    });

    return () => {
      setArchetypeSaveHandler(null);
    };
  }, [userId, dispatch]);

  // Stable progress callback (ref-based to avoid recreating PixiStage)
  const progressRef = useRef(setLoadProgress);
  progressRef.current = setLoadProgress;
  const backgroundProgressRef = useRef(setBackgroundLoadProgress);
  backgroundProgressRef.current = setBackgroundLoadProgress;

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
      onBackgroundTextureProgress: (loaded, total) => {
        if (total <= 0 || loaded >= total) {
          backgroundProgressRef.current(null);
          return;
        }
        backgroundProgressRef.current({ loaded, total });
      },
      onCanvasLabelsChange: (labels) => {
        dispatch({ type: "SET_CANVAS_LABELS", labels });
      },
      onLabelPlacementConsumed: () => {
        dispatch({ type: "SET_LABEL_PLACEMENT_MODE", enabled: false });
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
    setBackgroundLoadProgress(null);

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
      state.userData.canvasLabels ?? [],
    );

    // Pan to deck bounds when a new deck is loaded
    const isNewDeck =
      activeDeck && state.editor.activeDeckId !== prevDeckIdRef.current;
    prevDeckIdRef.current = state.editor.activeDeckId;

    if (isNewDeck) {
      stageRef.current.panToDeckBounds();
    }
  }, [state.userData, state.editor.activeDeckId, state.editor.activeBoard]);

  // Keep label placement mode in sync with UI toggle.
  useEffect(() => {
    if (!stageRef.current) return;
    stageRef.current.setLabelPlacementMode(state.ui.labelPlacementMode);
  }, [state.ui.labelPlacementMode]);

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
  const showBackgroundSpinner =
    splashDone &&
    backgroundLoadProgress !== null &&
    backgroundLoadProgress.total > 0 &&
    backgroundLoadProgress.loaded < backgroundLoadProgress.total;

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
      {showBackgroundSpinner && (
        <BackgroundTextureSpinner
          loaded={backgroundLoadProgress.loaded}
          total={backgroundLoadProgress.total}
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

function BackgroundTextureSpinner({
  loaded,
  total,
}: {
  loaded: number;
  total: number;
}) {
  const pct = Math.round((loaded / total) * 100);

  return (
    <div
      className="texture-background-spinner"
      aria-label={`Loading high-detail card images ${loaded} of ${total}`}
    >
      <span className="texture-background-spinner-wheel" aria-hidden="true" />
      <span className="texture-background-spinner-label">
        Loading High Detail {pct}%
      </span>
    </div>
  );
}
