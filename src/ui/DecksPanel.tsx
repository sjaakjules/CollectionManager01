import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppState } from "@/app/AppState";
import type { CanvasArea } from "@/canvas/canvasAreas";
import type { Deck } from "@/data/dataModels";
import {
  downloadTextFile,
  exportDeckToText,
} from "@/data/importExport";
import {
  getDeckDisplayName,
  getDeckElementSummary,
} from "@/ui/deckDisplay";
import { ElementIcon } from "@/ui/ElementIcon";
import { DeckCreatePanel } from "@/ui/DeckCreatePanel";
import { getDeckLibraryEntries, type DeckLibraryEntry } from '@/data/deckLibrary';

type DeckEntry = DeckLibraryEntry;

const RIGHT_EDGE_TRIGGER_PX = 84;
const DECK_BOARD_SECTIONS = [
  { key: "mainboard", label: "Main" },
  { key: "collection", label: "Collection" },
  { key: "maybeboard", label: "Maybe" },
] as const;

interface DecksPanelProps {
  canvasAreas: CanvasArea[];
  isPhone?: boolean;
  phoneExpanded?: boolean;
  onPhoneTabToggle?: () => void;
  /** Creates/reopens the area and requests canvas focus in the same state update. */
  onCreateDeckZone: (deck: Deck) => string | null;
  onHideCanvasArea: (canvasAreaId: string) => void;
  onFocusCanvasArea: (canvasAreaId: string) => void;
  onResetDeckLayout: (canvasAreaId: string) => void;
  onRemoveDeck: (deckId: string) => void;
}

export function DecksPanel({
  canvasAreas,
  isPhone = false,
  phoneExpanded = false,
  onPhoneTabToggle,
  onCreateDeckZone,
  onHideCanvasArea,
  onFocusCanvasArea,
  onResetDeckLayout,
  onRemoveDeck,
}: DecksPanelProps) {
  const { state } = useAppState();
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [edgeNear, setEdgeNear] = useState(false);
  const [hoveringTabs, setHoveringTabs] = useState(false);
  const [hoveringPanel, setHoveringPanel] = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  const [creatingDeck, setCreatingDeck] = useState(false);

  const entries = useMemo(() => getDeckLibraryEntries(state.userData?.decks ?? [], canvasAreas),
    [canvasAreas, state.userData?.decks]);

  const activeEntry = useMemo(
    () => entries.find((entry) => entry.id === activeDeckId) ?? null,
    [activeDeckId, entries],
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const near = event.clientX >= window.innerWidth - RIGHT_EDGE_TRIGGER_PX;
      setEdgeNear((prev) => (prev === near ? prev : near));
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  useEffect(() => {
    if (!activeDeckId) return;
    if (entries.some((entry) => entry.id === activeDeckId)) return;
    setActiveDeckId(null);
  }, [activeDeckId, entries]);

  const placeDeckEntryOnCanvas = useCallback(
    (entry: DeckEntry) => {
      setActiveDeckId(entry.id);
      setCreatingDeck(false);
      if (entry.deck) {
        onCreateDeckZone(entry.deck);
      } else if (entry.area) {
        onFocusCanvasArea(entry.area.id);
      }
    },
    [onCreateDeckZone, onFocusCanvasArea],
  );

  const handleCreateDeck = useCallback((deck: Deck) => {
    const canvasAreaId = onCreateDeckZone(deck);
    if (!canvasAreaId) return false;
    setActiveDeckId(deck.id);
    setCreatingDeck(false);
    return true;
  }, [onCreateDeckZone]);

  const handleExportDeck = useCallback((deck: Deck) => {
    const safeName = deck.name.trim().replace(/[\\/:*?"<>|]+/g, "-") || "deck";
    downloadTextFile(`${safeName}.txt`, exportDeckToText(deck));
  }, []);

  const tabsExpanded = isPhone
    ? phoneExpanded
    : manualExpanded ||
      edgeNear ||
      hoveringTabs ||
      hoveringPanel ||
      activeEntry !== null ||
      creatingDeck;
  const activeArea = activeEntry?.area ?? null;
  const panelOpen = (creatingDeck || activeEntry !== null) && (!isPhone || phoneExpanded);

  return (
    <div className={`decks-shell ${tabsExpanded ? "tabs-expanded" : ""}`}>
      <div
        className="decks-tabs"
        onMouseEnter={() => setHoveringTabs(true)}
        onMouseLeave={() => setHoveringTabs(false)}
      >
        <button
          type="button"
          className="deck-tabs-label"
          onClick={() => {
            if (isPhone) {
              onPhoneTabToggle?.();
              return;
            }
            setManualExpanded((previous) => !previous);
          }}
        >
          Decks
        </button>
        <button
          type="button"
          className="deck-tab deck-tab-add"
          onClick={() => {
            setCreatingDeck((previous) => !previous);
            setActiveDeckId(null);
          }}
          title="Create or import deck"
        >
          +
        </button>
        {entries.map((entry) => {
          const area = entry.area;
          const deck = entry.deck;
          const elements = getDeckElementSummary(deck, state.cards, area);
          const label = getDeckDisplayName(entry.deck, area);
          const title = deck?.name ?? area?.name ?? "Deck";
          return (
            <button
              key={entry.id}
              type="button"
              className={`deck-tab ${activeDeckId === entry.id ? "active" : ""}`}
              data-canvas-drop-zone-id={area?.id}
              data-canvas-drop-deck-id={deck?.id ?? area?.deckId}
              data-canvas-drop-zone-type="deck"
              onClick={() => placeDeckEntryOnCanvas(entry)}
              title={title}
            >
              <span className="deck-tab-name">{label}</span>
              <span className="deck-tab-elements" aria-label="Deck elements">
                {elements.length === 0 ? (
                  <ElementIcon element="none" decorative />
                ) : (
                  elements.map((element) => (
                    <ElementIcon key={element} element={element} decorative />
                  ))
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={`decks-panel ${panelOpen ? "open" : ""}`}
        onMouseEnter={() => setHoveringPanel(true)}
        onMouseLeave={() => setHoveringPanel(false)}
      >
        {creatingDeck && <DeckCreatePanel onCreateDeck={handleCreateDeck} />}

        {activeEntry && !creatingDeck && (
          <div className="deck-active-panel">
            <button
              type="button"
              className="deck-panel-hide"
              onClick={() => {
                setActiveDeckId(null);
                setManualExpanded(false);
                if (isPhone && phoneExpanded) onPhoneTabToggle?.();
              }}
              title="Hide the panel; keep the deck on the canvas"
            >
              Hide
            </button>
            <div>
              <h2>
                {activeEntry.deck
                  ? getDeckDisplayName(activeEntry.deck, activeArea)
                  : activeArea?.name ?? "Deck"}
              </h2>
              {activeEntry.deck ? (
                <span>
                  Avatar: {activeEntry.deck.boards.avatar[0]?.name ?? "None"}
                </span>
              ) : (
                <span>{activeArea?.cards.length ?? 0} cards on canvas</span>
              )}
            </div>
            {activeEntry.deck && (
              <div className="deck-board-list">
                {DECK_BOARD_SECTIONS.map((section) => {
                  const cards = activeEntry.deck?.boards[section.key] ?? [];
                  return (
                    <section key={section.key} className="deck-board-section">
                      <h3>
                        {section.label}
                        <span>{cards.reduce((total, card) => total + card.quantity, 0)}</span>
                      </h3>
                      {cards.length === 0 ? (
                        <p>Empty</p>
                      ) : (
                        <ul>
                          {cards.map((card) => (
                            <li key={card.name}>
                              <span>{card.quantity}</span>
                              {card.name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
            {(activeEntry.deck || activeArea) && (
              <div className="deck-active-actions">
                {activeEntry.deck && (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeEntry.deck) handleExportDeck(activeEntry.deck);
                    }}
                  >
                    Export .txt
                  </button>
                )}
                {activeArea && (
                  <>
                    <button type="button" onClick={() => onResetDeckLayout(activeArea.id)}>
                      Reset layout
                    </button>
                    <button
                      type="button"
                      onClick={() => onFocusCanvasArea(activeArea.id)}
                    >
                      Center
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onHideCanvasArea(activeArea.id);
                        setActiveDeckId(null);
                      }}
                    >
                      Hide deck
                    </button>
                  </>
                )}
                <button type="button" onClick={() => onRemoveDeck(activeEntry.id)}>Remove deck</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
