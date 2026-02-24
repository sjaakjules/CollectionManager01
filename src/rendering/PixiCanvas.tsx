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
 *
 * Related files:
 * - `src/rendering/PixiStage.ts` (imperative Pixi scene implementation)
 * - `src/app/App.tsx` (prop wiring and zone events)
 * - `src/data/cardFilters.ts` and `src/data/archetypeScores.ts` (render inputs)
 */

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useAppState } from "@/app/AppState";
import { PixiStage, type CardDragDropPayload } from "./PixiStage";
import { cardNameToSlug } from "./LODManager";
import {
  loadArchetypeScores,
  setCachedArchetypeScores,
  setArchetypeSaveHandler,
  type ArchetypeScores,
} from "@/data/archetypeScores";
import {
  applyCardFilters,
  ensureCardFilterState,
  isCardFilterActive,
} from "@/data/cardFilters";
import type { ZoneModel } from "@/zones/zones";

interface PixiCanvasProps {
  splashDone: boolean;
  zones: ZoneModel[];
  onCardDragDrop?: (payload: CardDragDropPayload) => void;
  onZonesChange?: (zones: ZoneModel[]) => void;
  onStackZoneHeaderClick?: (zoneId: string) => void;
  focusZoneRequest?: { zoneId: string; nonce: number } | null;
}

/**
 * Canvas host component that bridges reducer state into PixiStage.
 *
 * Inputs:
 * - `splashDone`: Whether splash transition is complete.
 * - `zones`: Current zone models to render.
 * - `onCardDragDrop`: Optional callback for drag/drop outcomes.
 * - `onZonesChange`: Optional callback when Pixi mutates zones.
 * - `onStackZoneHeaderClick`: Optional callback when stack zone header is clicked.
 * - `focusZoneRequest`: Optional one-shot zone focus request.
 *
 * Outputs:
 * - Returns React markup containing the Pixi mount container and loading overlays.
 */
export function PixiCanvas({
  splashDone,
  zones,
  onCardDragDrop,
  onZonesChange,
  onStackZoneHeaderClick,
  focusZoneRequest,
}: PixiCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PixiStage | null>(null);
  const { state, dispatch } = useAppState();
  const userId = state.userData?.id ?? null;
  const userArchetypeScores = state.userData?.archetypeScores ?? null;
  const cardFilters = useMemo(
    () => ensureCardFilterState(state.ui.cardFilters),
    [state.ui.cardFilters],
  );
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
  const [hoveredCardName, setHoveredCardName] = useState<string | null>(null);
  const [isPointerOverStacksPanel, setIsPointerOverStacksPanel] = useState(false);

  const filteredCards = useMemo(
    () => applyCardFilters(state.cards, cardFilters),
    [state.cards, cardFilters],
  );
  const filteredMode = useMemo(
    () => isCardFilterActive(cardFilters),
    [cardFilters],
  );

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
  const cardDragDropRef = useRef(onCardDragDrop);
  cardDragDropRef.current = onCardDragDrop;
  const zonesChangeRef = useRef(onZonesChange);
  zonesChangeRef.current = onZonesChange;
  const stackZoneHeaderClickRef = useRef(onStackZoneHeaderClick);
  stackZoneHeaderClickRef.current = onStackZoneHeaderClick;

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
      onSelectionChange: (selectedCardNames) => {
        dispatch({ type: "SET_SELECTED_CARD_NAMES", names: selectedCardNames });
      },
      onCanvasLabelsChange: (labels) => {
        dispatch({ type: "SET_CANVAS_LABELS", labels });
      },
      onLabelPlacementConsumed: () => {
        dispatch({ type: "SET_LABEL_PLACEMENT_MODE", enabled: false });
      },
      onHoveredCardChange: (cardName) => {
        setHoveredCardName(cardName);
      },
      onCardDragDrop: (payload) => {
        cardDragDropRef.current?.(payload);
      },
      onZonesChange: (nextZones) => {
        zonesChangeRef.current?.(nextZones);
      },
      onStackZoneHeaderClick: (zoneId) => {
        stackZoneHeaderClickRef.current?.(zoneId);
      },
    });

    stageRef.current = stage;

    return () => {
      if (clearTimerId !== undefined) clearTimeout(clearTimerId);
      setHoveredCardName(null);
      stage.destroy();
      stageRef.current = null;
    };
  }, [dispatch]);

  // Keep rendered cards in sync with active filters.
  useEffect(() => {
    if (!stageRef.current || !state.cardsLoaded) return;

    stageRef.current.setCards(filteredCards, { filteredMode });
  }, [filteredCards, filteredMode, state.cardsLoaded]);

  useEffect(() => {
    if (!stageRef.current) return;
    stageRef.current.setZones(zones);
  }, [zones]);

  // Replay reveal/progress only when the source card dataset changes.
  useEffect(() => {
    if (!stageRef.current || !state.cardsLoaded) return;

    setLoadProgress(null);
    setBackgroundLoadProgress(null);
    stageRef.current.startTextureReveal();
  }, [state.cards, state.cardsLoaded]);

  // Update overlays when user data changes. Deck rendering is zone-driven.
  useEffect(() => {
    if (!stageRef.current || !state.userData) return;

    stageRef.current.updateDeckOverlays(
      null,
      state.editor.activeBoard,
      state.userData.collection,
      state.userData.canvasLabels ?? [],
    );
  }, [state.userData, state.editor.activeDeckId, state.editor.activeBoard]);

  useEffect(() => {
    if (!stageRef.current || !focusZoneRequest) return;
    stageRef.current.focusZone(focusZoneRequest.zoneId);
  }, [focusZoneRequest]);

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

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const overStacksPanel =
        event.target instanceof Element &&
        !!event.target.closest(".stacks-panel, .zones-slide-panel, .zones-tabs");

      setIsPointerOverStacksPanel((prev) =>
        prev === overStacksPanel ? prev : overStacksPanel,
      );
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

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
  const hoveredCardPreviewSrc = hoveredCardName
    ? `/assets/Cards/${cardNameToSlug(hoveredCardName)}.webp`
    : null;
  const hoveredCardIsLandscape = useMemo(() => {
    if (!hoveredCardName) return false;
    const card = state.cards.find((entry) => entry.name === hoveredCardName);
    return card?.guardian?.type === "Site";
  }, [hoveredCardName, state.cards]);

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
      {hoveredCardPreviewSrc && !isPointerOverStacksPanel && (
        <div
          className={`card-hover-preview ${hoveredCardIsLandscape ? "landscape" : ""}`}
          aria-hidden="true"
        >
          <img
            className={hoveredCardIsLandscape ? "landscape" : ""}
            src={hoveredCardPreviewSrc}
            alt={hoveredCardName ?? "Card preview"}
          />
        </div>
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
