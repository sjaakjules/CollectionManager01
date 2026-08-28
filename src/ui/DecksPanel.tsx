import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "@/app/AppState";
import type { CanvasArea } from "@/canvas/canvasAreas";
import { createLocalDeck } from "@/data/deckCreation";
import type { Deck } from "@/data/dataModels";
import { fetchCuriosaDeck } from "@/data/curiosaService";
import {
  downloadTextFile,
  exportDeckToText,
  importDeckFromText,
  importFromCuriosaDeck,
} from "@/data/importExport";
import {
  AVATAR_SHORT_NAMES,
  getAvatarShortName,
  getDeckDisplayName,
  getDeckElementSummary,
  type AvatarName,
} from "@/ui/deckDisplay";
import { ElementIcon } from "@/ui/ElementIcon";

type DeckCreateMode = "menu" | "local" | "import" | "text" | null;
type DeckEntry =
  | { id: string; kind: "deck"; deck: Deck; area: CanvasArea | null }
  | { id: string; kind: "area"; deck: null; area: CanvasArea };

const RIGHT_EDGE_TRIGGER_PX = 84;
const CURIOSA_KIND_DELAY_MESSAGE = "Slowing download to be kind to Curiosa.io";
const AVATAR_NAMES = Object.keys(AVATAR_SHORT_NAMES) as AvatarName[];
const DECK_BOARD_SECTIONS = [
  { key: "mainboard", label: "Main" },
  { key: "sideboard", label: "Side" },
  { key: "maybeboard", label: "Maybe" },
] as const;

interface DecksPanelProps {
  canvasAreas: CanvasArea[];
  isPhone?: boolean;
  phoneExpanded?: boolean;
  onPhoneTabToggle?: () => void;
  onCreateDeckZone: (deck: Deck) => string | null;
  onDeleteCanvasArea: (canvasAreaId: string) => void;
  onFocusCanvasArea: (canvasAreaId: string) => void;
}

export function DecksPanel({
  canvasAreas,
  isPhone = false,
  phoneExpanded = false,
  onPhoneTabToggle,
  onCreateDeckZone,
  onDeleteCanvasArea,
  onFocusCanvasArea,
}: DecksPanelProps) {
  const { state, dispatch } = useAppState();
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [edgeNear, setEdgeNear] = useState(false);
  const [hoveringTabs, setHoveringTabs] = useState(false);
  const [hoveringPanel, setHoveringPanel] = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  const [createMode, setCreateMode] = useState<DeckCreateMode>(null);
  const [selectedAvatarName, setSelectedAvatarName] = useState<AvatarName>("Animist");
  const [localDeckName, setLocalDeckName] = useState(
    `${getAvatarShortName("Animist")} Deck`,
  );
  const [deckUrlInput, setDeckUrlInput] = useState("");
  const [deckTextInput, setDeckTextInput] = useState("");
  const [textDeckName, setTextDeckName] = useState("");
  const [isLoadingDeck, setIsLoadingDeck] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [deckImportNotice, setDeckImportNotice] = useState<string | null>(null);
  const deckImportAbortRef = useRef<AbortController | null>(null);

  const deckAreas = useMemo(
    () => canvasAreas.filter((area) => area.type === "deck"),
    [canvasAreas],
  );
  const deckAreasByDeckId = useMemo(() => {
    const map = new Map<string, CanvasArea>();
    for (const area of deckAreas) {
      if (area.deckId) map.set(area.deckId, area);
    }
    return map;
  }, [deckAreas]);
  const entries = useMemo<DeckEntry[]>(() => {
    const deckEntries: DeckEntry[] = (state.userData?.decks ?? []).map((deck) => ({
      id: deck.id,
      kind: "deck",
      deck,
      area: deckAreasByDeckId.get(deck.id) ?? null,
    }));
    const deckIds = new Set(deckEntries.map((entry) => entry.id));
    const areaOnlyEntries: DeckEntry[] = deckAreas
      .filter((area) => !area.deckId || !deckIds.has(area.deckId))
      .map((area) => ({ id: area.id, kind: "area", deck: null, area }));
    return [...deckEntries, ...areaOnlyEntries];
  }, [deckAreas, deckAreasByDeckId, state.userData?.decks]);

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
    return () => {
      deckImportAbortRef.current?.abort();
      deckImportAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!activeDeckId) return;
    if (entries.some((entry) => entry.id === activeDeckId)) return;
    setActiveDeckId(null);
  }, [activeDeckId, entries]);

  const abortDeckImport = useCallback(() => {
    const controller = deckImportAbortRef.current;
    if (!controller) return;
    controller.abort();
    deckImportAbortRef.current = null;
    setIsLoadingDeck(false);
    setDeckImportNotice(null);
  }, []);

  const selectDeckEntry = useCallback((entry: DeckEntry) => {
    setActiveDeckId(entry.id);
    setCreateMode(null);
    setDeckError(null);
    setDeckImportNotice(null);
  }, []);

  const placeDeckEntryOnCanvas = useCallback(
    (entry: DeckEntry) => {
      setActiveDeckId(entry.id);
      setCreateMode(null);
      setDeckError(null);
      setDeckImportNotice(null);
      if (entry.area) {
        onFocusCanvasArea(entry.area.id);
        return;
      }
      if (entry.deck) {
        const canvasAreaId = onCreateDeckZone(entry.deck);
        if (canvasAreaId) onFocusCanvasArea(canvasAreaId);
      }
    },
    [onCreateDeckZone, onFocusCanvasArea],
  );

  const handleAvatarChange = useCallback((avatarName: AvatarName) => {
    setSelectedAvatarName(avatarName);
    setLocalDeckName((previous) => {
      const defaultNames = AVATAR_NAMES.map(
        (entry) => `${getAvatarShortName(entry)} Deck`,
      );
      return previous.trim().length === 0 || defaultNames.includes(previous)
        ? `${getAvatarShortName(avatarName)} Deck`
        : previous;
    });
  }, []);

  const handleCreateLocalDeck = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const name = localDeckName.trim();
      const avatarName = selectedAvatarName.trim();
      if (!name || !avatarName) return;

      const deck = createLocalDeck({ name, avatarName });
      const canvasAreaId = onCreateDeckZone(deck);
      if (canvasAreaId) onFocusCanvasArea(canvasAreaId);
      setActiveDeckId(deck.id);
      setCreateMode(null);
      setDeckError(null);
      setLocalDeckName(`${getAvatarShortName(selectedAvatarName)} Deck`);
    },
    [localDeckName, onCreateDeckZone, onFocusCanvasArea, selectedAvatarName],
  );

  const handleCreateDeckZone = useCallback(async () => {
    if (isLoadingDeck) return;
    const trimmed = deckUrlInput.trim();
    if (!trimmed) return;

    const controller = new AbortController();
    deckImportAbortRef.current = controller;
    setIsLoadingDeck(true);
    setDeckError(null);
    setDeckImportNotice(null);

    const slowNoticeTimer = setTimeout(() => {
      if (controller.signal.aborted || deckImportAbortRef.current !== controller) return;
      setDeckImportNotice(CURIOSA_KIND_DELAY_MESSAGE);
    }, 1000);

    try {
      const fetched = await fetchCuriosaDeck(trimmed, {
        signal: controller.signal,
        onDelay: (delay) => {
          if (delay.delayMs >= 1000) {
            setDeckImportNotice(CURIOSA_KIND_DELAY_MESSAGE);
          }
        },
      });
      if (controller.signal.aborted || deckImportAbortRef.current !== controller) return;
      // Canonicalize card names against the local database and filter token
      // cards; keeps the Curiosa deck id so re-imports resolve to the same
      // deck instead of duplicating it.
      const importResult = importFromCuriosaDeck(
        {
          id: fetched.id,
          name: fetched.name,
          author: fetched.author ?? "",
          mainboard: fetched.boards.mainboard,
          avatar: fetched.boards.avatar,
          sideboard: fetched.boards.sideboard,
          maybeboard: fetched.boards.maybeboard,
        },
        state.cards,
      );
      const deck = importResult.deck;
      const unknownCards = state.cards.length > 0 ? importResult.unknownCards : [];
      const canvasAreaId = onCreateDeckZone(deck);
      if (!canvasAreaId) return;
      onFocusCanvasArea(canvasAreaId);
      setActiveDeckId(deck.id);
      setDeckUrlInput("");
      setCreateMode(null);
      setDeckImportNotice(null);
      if (unknownCards.length > 0) {
        const preview = unknownCards.slice(0, 4).join(", ");
        const suffix = unknownCards.length > 4 ? `, +${unknownCards.length - 4} more` : "";
        dispatch({
          type: "ADD_NOTIFICATION",
          notification: {
            type: "warning",
            message: `Imported deck contains ${unknownCards.length} unknown card ${
              unknownCards.length === 1 ? "name" : "names"
            }: ${preview}${suffix}`,
          },
        });
      }
      if (importResult.warnings.length > 0) {
        dispatch({
          type: "ADD_NOTIFICATION",
          notification: {
            type: "warning",
            message: importResult.warnings.slice(0, 3).join(" · "),
          },
        });
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        return;
      }
      const message = error instanceof Error ? error.message : "Failed to load deck";
      setDeckError(message);
    } finally {
      clearTimeout(slowNoticeTimer);
      if (deckImportAbortRef.current === controller) {
        deckImportAbortRef.current = null;
        setIsLoadingDeck(false);
      }
    }
  }, [
    deckUrlInput,
    dispatch,
    isLoadingDeck,
    onCreateDeckZone,
    onFocusCanvasArea,
    state.cards,
  ]);

  const handleDeckImportSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void handleCreateDeckZone();
    },
    [handleCreateDeckZone],
  );

  const handleTextImportSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = deckTextInput.trim();
      if (!text) return;

      const name = textDeckName.trim() || "Imported Deck";
      const result = importDeckFromText(text, name, state.cards);
      const hasCards = Object.values(result.deck.boards).some(
        (board) => board.length > 0,
      );
      if (!hasCards) {
        setDeckError("No cards found in the pasted text");
        return;
      }

      const canvasAreaId = onCreateDeckZone(result.deck);
      if (canvasAreaId) onFocusCanvasArea(canvasAreaId);
      setActiveDeckId(result.deck.id);
      setCreateMode(null);
      setDeckTextInput("");
      setTextDeckName("");
      setDeckError(null);

      const unknownCards = state.cards.length > 0 ? result.unknownCards : [];
      if (unknownCards.length > 0) {
        const preview = unknownCards.slice(0, 4).join(", ");
        const suffix = unknownCards.length > 4 ? `, +${unknownCards.length - 4} more` : "";
        dispatch({
          type: "ADD_NOTIFICATION",
          notification: {
            type: "warning",
            message: `Imported deck contains ${unknownCards.length} unknown card ${
              unknownCards.length === 1 ? "name" : "names"
            }: ${preview}${suffix}`,
          },
        });
      }
      if (result.warnings.length > 0) {
        dispatch({
          type: "ADD_NOTIFICATION",
          notification: {
            type: "warning",
            message: result.warnings.slice(0, 3).join(" · "),
          },
        });
      }
    },
    [
      deckTextInput,
      dispatch,
      onCreateDeckZone,
      onFocusCanvasArea,
      state.cards,
      textDeckName,
    ],
  );

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
      createMode !== null;
  const activeArea = activeEntry?.area ?? null;
  const panelOpen = (createMode !== null || activeEntry !== null) && (!isPhone || phoneExpanded);

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
            setCreateMode((previous) => (previous === "menu" ? null : "menu"));
            setActiveDeckId(null);
            setDeckError(null);
            setDeckImportNotice(null);
          }}
          title="Create or import deck"
        >
          +
        </button>
        {entries.map((entry) => {
          const area = entry.area;
          const deck = entry.deck;
          const elements = getDeckElementSummary(deck, state.cards, area);
          const label =
            entry.kind === "deck"
              ? getDeckDisplayName(entry.deck, area)
              : getAvatarShortName(entry.area.avatarCardName ?? entry.area.name);
          const title = deck?.name ?? area?.name ?? "Deck";
          return (
            <button
              key={entry.id}
              type="button"
              className={`deck-tab ${activeDeckId === entry.id ? "active" : ""}`}
              data-canvas-drop-zone-id={area?.id}
              data-canvas-drop-deck-id={deck?.id ?? area?.deckId}
              data-canvas-drop-zone-type="deck"
              onClick={() => selectDeckEntry(entry)}
              onDoubleClick={() => placeDeckEntryOnCanvas(entry)}
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
        {createMode === "menu" && (
          <div className="deck-create-menu">
            <button type="button" className="deck-create-choice" onClick={() => setCreateMode("local")}>
              New local deck
            </button>
            <button type="button" className="deck-create-choice" onClick={() => setCreateMode("import")}>
              Import Curiosa URL
            </button>
            <button type="button" className="deck-create-choice" onClick={() => setCreateMode("text")}>
              Paste deck text
            </button>
          </div>
        )}

        {createMode === "local" && (
          <form className="deck-create-form" onSubmit={handleCreateLocalDeck}>
            <label className="deck-create-field">
              <span>Avatar</span>
              <select
                value={selectedAvatarName}
                onChange={(event) => handleAvatarChange(event.target.value as AvatarName)}
              >
                {AVATAR_NAMES.map((avatarName) => (
                  <option key={avatarName} value={avatarName}>
                    {avatarName}
                  </option>
                ))}
              </select>
            </label>
            <label className="deck-create-field">
              <span>Name</span>
              <input
                type="text"
                value={localDeckName}
                onChange={(event) => setLocalDeckName(event.target.value)}
                placeholder="Deck name"
              />
            </label>
            <div className="deck-create-actions">
              <button type="submit" disabled={!localDeckName.trim()}>
                Create
              </button>
              <button type="button" onClick={() => setCreateMode("menu")}>
                Back
              </button>
            </div>
          </form>
        )}

        {createMode === "import" && (
          <form className="deck-create-form" onSubmit={handleDeckImportSubmit}>
            <label className="deck-create-field">
              <span>Curiosa URL</span>
              <input
                type="url"
                value={deckUrlInput}
                onChange={(event) => {
                  setDeckUrlInput(event.target.value);
                  setDeckError(null);
                  setDeckImportNotice(null);
                }}
                placeholder="https://curiosa.io/decks/..."
                disabled={isLoadingDeck}
              />
            </label>
            <div className="deck-create-actions">
              <button type="submit" disabled={isLoadingDeck || !deckUrlInput.trim()}>
                {isLoadingDeck ? "Loading..." : "Load"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isLoadingDeck) {
                    abortDeckImport();
                    return;
                  }
                  setCreateMode("menu");
                  setDeckUrlInput("");
                  setDeckError(null);
                  setDeckImportNotice(null);
                }}
              >
                {isLoadingDeck ? "Cancel" : "Back"}
              </button>
            </div>
            {deckImportNotice && (
              <p className="deck-create-note deck-import-notice">{deckImportNotice}</p>
            )}
            {deckError && <p className="deck-create-note error">{deckError}</p>}
          </form>
        )}

        {createMode === "text" && (
          <form className="deck-create-form" onSubmit={handleTextImportSubmit}>
            <label className="deck-create-field">
              <span>Name</span>
              <input
                type="text"
                value={textDeckName}
                onChange={(event) => setTextDeckName(event.target.value)}
                placeholder="Imported Deck"
              />
            </label>
            <label className="deck-create-field">
              <span>Deck list</span>
              <textarea
                value={deckTextInput}
                onChange={(event) => {
                  setDeckTextInput(event.target.value);
                  setDeckError(null);
                }}
                placeholder={"2 Lightning Bolt\n// Sideboard\n1 Riptide"}
                spellCheck={false}
              />
            </label>
            <div className="deck-create-actions">
              <button type="submit" disabled={!deckTextInput.trim()}>
                Import
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateMode("menu");
                  setDeckError(null);
                }}
              >
                Back
              </button>
            </div>
            {deckError && <p className="deck-create-note error">{deckError}</p>}
          </form>
        )}

        {activeEntry && createMode === null && (
          <div className="deck-active-panel">
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
                    <button
                      type="button"
                      onClick={() => onFocusCanvasArea(activeArea.id)}
                    >
                      Center
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteCanvasArea(activeArea.id);
                        setActiveDeckId(null);
                      }}
                    >
                      Hide
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
