/**
 * Left-side stacks panel for creating, browsing, and filtering stack zones.
 *
 * Responsibilities:
 * - List stack zones and open a stack detail drawer.
 * - Trigger stack creation and canvas focus actions.
 * - Filter visible stack cards by threshold group and card orientation metadata.
 *
 * Related files:
 * - `src/zones/zones.ts` (stack zone model)
 * - `src/rendering/PixiStage.ts` (stack zone interactions on canvas)
 * - `src/app/App.tsx` (panel callbacks and zone state updates)
 */

import { useEffect, useMemo, useState, useCallback, type CSSProperties } from "react";
import {
  getThresholdGroup,
  type CardType,
  type ThresholdGroup,
} from "@/data/dataModels";
import { cardNameToSlug } from "@/rendering/LODManager";
import { useAppState } from "@/app/AppState";
import type { ZoneModel } from "@/zones/zones";

interface StacksPanelProps {
  zones: ZoneModel[];
  onCreateStack: (name: string) => string | null;
  onSetZonePinned: (zoneId: string, pinned: boolean) => void;
  onFocusZone: (zoneId: string) => void;
  onRemoveCardFromStack: (zoneId: string, cardName: string) => void;
  openStackRequest?: { stackId: string; nonce: number } | null;
}

const EDGE_TRIGGER_PX = 72;
const STACK_CARD_WIDTH_MIN = 120;
const STACK_CARD_WIDTH_MAX = 320;
const STACK_CARD_WIDTH_STEP = 20;

const STACK_ELEMENT_FILTERS: Array<{
  id: ThresholdGroup;
  icon: string;
  label: string;
}> = [
  { id: "air", icon: "/assets/buttons/air.png", label: "Air" },
  { id: "earth", icon: "/assets/buttons/earth.png", label: "Earth" },
  { id: "fire", icon: "/assets/buttons/fire.png", label: "Fire" },
  { id: "water", icon: "/assets/buttons/water.png", label: "Water" },
  { id: "multiple", icon: "/assets/buttons/multi.png", label: "Multiple" },
  { id: "none", icon: "/assets/buttons/none.png", label: "None" },
];

/**
 * Render the stack-zone tabs and stack-card drawer UI.
 *
 * Inputs:
 * - `zones`: Full zone list; stack zones are filtered from this array.
 * - `onCreateStack`: Callback to create a new stack zone.
 * - `onSetZonePinned`: Callback to pin/unpin a stack on canvas.
 * - `onFocusZone`: Callback to center camera on a zone.
 * - `onRemoveCardFromStack`: Callback to remove a card from the active stack.
 * - `openStackRequest`: Optional external request to open a specific stack.
 *
 * Outputs:
 * - Returns React markup for tabs + panel; user actions call callbacks.
 */
export function StacksPanel({
  zones,
  onCreateStack,
  onSetZonePinned,
  onFocusZone,
  onRemoveCardFromStack,
  openStackRequest,
}: StacksPanelProps) {
  const { state } = useAppState();
  const [activeStackId, setActiveStackId] = useState<string | null>(null);
  const [edgeNear, setEdgeNear] = useState(false);
  const [hoveringTabs, setHoveringTabs] = useState(false);
  const [hoveringPanel, setHoveringPanel] = useState(false);
  const [stackCardWidth, setStackCardWidth] = useState(250);
  const [selectedElementFilters, setSelectedElementFilters] = useState<
    ThresholdGroup[]
  >([]);

  const stacks = useMemo(
    () => zones.filter((zone) => zone.type === "stack"),
    [zones],
  );

  const cardMetadata = useMemo(() => {
    const map = new Map<
      string,
      {
        thresholdGroup: ThresholdGroup;
        isLandscape: boolean;
        type: CardType;
        manaCost: number;
      }
    >();
    for (const card of state.cards) {
      map.set(card.name, {
        thresholdGroup: getThresholdGroup(card.guardian.thresholds),
        isLandscape: card.guardian.type === "Site",
        type: card.guardian.type,
        manaCost: card.guardian.cost,
      });
    }
    return map;
  }, [state.cards]);

  const activeStack = useMemo(
    () => stacks.find((stack) => stack.id === activeStackId) ?? null,
    [activeStackId, stacks],
  );
  const selectedFilterSet = useMemo(
    () => new Set(selectedElementFilters),
    [selectedElementFilters],
  );
  const uniqueStackCardCount = useMemo(() => {
    if (!activeStack) return 0;
    return new Set(activeStack.cards.map((card) => card.cardName)).size;
  }, [activeStack]);
  const visibleStackCards = useMemo(() => {
    if (!activeStack) return [];
    const hasActiveElementFilters = selectedElementFilters.length > 0;

    const filtered = activeStack.cards.filter((card) => {
      if (!hasActiveElementFilters) return true;
      const thresholdGroup = cardMetadata.get(card.cardName)?.thresholdGroup ?? "none";
      return selectedFilterSet.has(thresholdGroup);
    });

    const uniqueByCardName = new Map<string, (typeof filtered)[number]>();
    for (const card of filtered) {
      if (!uniqueByCardName.has(card.cardName)) {
        uniqueByCardName.set(card.cardName, card);
      }
    }

    return Array.from(uniqueByCardName.values()).sort((left, right) => {
      const leftMetadata = cardMetadata.get(left.cardName);
      const rightMetadata = cardMetadata.get(right.cardName);
      const leftIsSite = leftMetadata?.type === "Site";
      const rightIsSite = rightMetadata?.type === "Site";

      if (leftIsSite !== rightIsSite) {
        return leftIsSite ? 1 : -1;
      }

      if (!leftIsSite && !rightIsSite) {
        const manaDiff =
          (leftMetadata?.manaCost ?? Number.MAX_SAFE_INTEGER) -
          (rightMetadata?.manaCost ?? Number.MAX_SAFE_INTEGER);
        if (manaDiff !== 0) return manaDiff;
      }

      const nameDiff = left.cardName.localeCompare(right.cardName);
      if (nameDiff !== 0) return nameDiff;

      return left.id.localeCompare(right.id);
    });
  }, [activeStack, cardMetadata, selectedElementFilters, selectedFilterSet]);

  useEffect(() => {
    if (!activeStackId) return;
    const exists = stacks.some((stack) => stack.id === activeStackId);
    if (!exists) {
      setActiveStackId(null);
    }
  }, [activeStackId, stacks]);

  useEffect(() => {
    if (!openStackRequest) return;
    setActiveStackId(openStackRequest.stackId);
  }, [openStackRequest]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const near = event.clientX <= EDGE_TRIGGER_PX;
      setEdgeNear((prev) => (prev === near ? prev : near));
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

  useEffect(() => {
    const handleCanvasDoubleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(".pixi-canvas-container")) return;
      setActiveStackId(null);
    };

    window.addEventListener("dblclick", handleCanvasDoubleClick);
    return () => {
      window.removeEventListener("dblclick", handleCanvasDoubleClick);
    };
  }, []);

  const tabsExpanded =
    edgeNear || hoveringTabs || hoveringPanel || activeStackId !== null;

  const handleCreateStack = useCallback(() => {
    const value = window.prompt("Stack name", "");
    if (value === null) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const createdId = onCreateStack(trimmed);
    if (!createdId) return;
    setActiveStackId(createdId);
  }, [onCreateStack]);

  const handleElementFilterToggle = useCallback((value: ThresholdGroup) => {
    setSelectedElementFilters((previous) => {
      if (!previous.includes(value)) {
        return [...previous, value];
      }
      return previous.filter((entry) => entry !== value);
    });
  }, []);

  const zoomOut = useCallback(() => {
    setStackCardWidth((value) =>
      Math.max(STACK_CARD_WIDTH_MIN, value - STACK_CARD_WIDTH_STEP),
    );
  }, []);

  const zoomIn = useCallback(() => {
    setStackCardWidth((value) =>
      Math.min(STACK_CARD_WIDTH_MAX, value + STACK_CARD_WIDTH_STEP),
    );
  }, []);

  const centerStackOnCanvas = useCallback(() => {
    if (!activeStack) return;
    onSetZonePinned(activeStack.id, true);
    onFocusZone(activeStack.id);
  }, [activeStack, onFocusZone, onSetZonePinned]);

  return (
    <div className={`stacks-shell ${tabsExpanded ? "tabs-expanded" : ""}`}>
      <div
        className="stacks-tabs"
        onMouseEnter={() => setHoveringTabs(true)}
        onMouseLeave={() => setHoveringTabs(false)}
      >
        <div className="stack-tabs-label">Stacks</div>
        <button
          type="button"
          className="stack-tab stack-tab-add"
          onClick={handleCreateStack}
          title="Create stack"
        >
          +
        </button>

        {stacks.map((stack) => (
          <button
            key={stack.id}
            type="button"
            className={`stack-tab ${activeStackId === stack.id ? "active" : ""}`}
            data-stack-zone-id={stack.id}
            onClick={() => setActiveStackId(stack.id)}
            onDoubleClick={() => {
              setActiveStackId(stack.id);
              onFocusZone(stack.id);
            }}
            title={stack.name}
          >
            {stack.name}
          </button>
        ))}
      </div>

      <div
        className={`stacks-panel ${activeStack ? "open" : ""}`}
        data-stack-zone-id={activeStack?.id ?? ""}
        onMouseEnter={() => setHoveringPanel(true)}
        onMouseLeave={() => setHoveringPanel(false)}
      >
        {activeStack && (
          <>
            <div className="stacks-panel-header">
              <div className="stacks-panel-header-main">
                <div className="stacks-panel-title-block">
                  <h2>{activeStack.name}</h2>
                  <span>{uniqueStackCardCount} cards</span>
                </div>
                <div className="stacks-panel-main-actions">
                  <button
                    type="button"
                    className="stacks-panel-hide"
                    onClick={() => setActiveStackId(null)}
                    title="Hide stack panel"
                    aria-label="Hide stack panel"
                  >
                    &lsaquo;
                  </button>
                </div>
              </div>

              <div className="stacks-panel-tools-row">
                <div className="stacks-element-filters">
                  {STACK_ELEMENT_FILTERS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={`stacks-element-filter ${
                        selectedFilterSet.has(entry.id) ? "selected" : ""
                      }`}
                      onClick={() => handleElementFilterToggle(entry.id)}
                      title={entry.label}
                      aria-label={`Filter ${entry.label}`}
                    >
                      <img src={entry.icon} alt="" aria-hidden="true" />
                    </button>
                  ))}
                </div>

                <div className="stacks-card-zoom">
                  <button
                    type="button"
                    className="stacks-card-focus-button"
                    onClick={centerStackOnCanvas}
                    title="Center stack on canvas"
                    aria-label="Center stack on canvas"
                  >
                    🔍
                  </button>
                  <button
                    type="button"
                    className="stacks-card-zoom-button"
                    onClick={zoomOut}
                    disabled={stackCardWidth <= STACK_CARD_WIDTH_MIN}
                    aria-label="Decrease stack card size"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="stacks-card-zoom-button"
                    onClick={zoomIn}
                    disabled={stackCardWidth >= STACK_CARD_WIDTH_MAX}
                    aria-label="Increase stack card size"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="stacks-panel-body">
              {activeStack.cards.length === 0 ? (
                <div className="stacks-empty">Drag and Drop Cards</div>
              ) : visibleStackCards.length === 0 ? (
                <div className="stacks-empty">No cards in selected elements</div>
              ) : (
                <div
                  className="stacks-card-column"
                  style={
                    {
                      "--stack-card-width": `${stackCardWidth}px`,
                    } as CSSProperties
                  }
                >
                  {visibleStackCards.map((card) => {
                    const metadata = cardMetadata.get(card.cardName);
                    const isLandscape = metadata?.isLandscape ?? false;
                    const imageSrc = `/assets/Cards/${cardNameToSlug(card.cardName)}.webp`;
                    return (
                      <div
                        key={card.id}
                        className={`stack-card-item ${isLandscape ? "landscape" : ""}`}
                        title={card.cardName}
                      >
                        <button
                          type="button"
                          className="stack-card-remove"
                          aria-label={`Remove ${card.cardName} from stack`}
                          title="Remove from stack"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemoveCardFromStack(activeStack.id, card.cardName);
                          }}
                        >
                          X
                        </button>
                        <img
                          src={imageSrc}
                          alt={card.cardName}
                          className={isLandscape ? "landscape" : ""}
                          loading="lazy"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
