/**
 * Right-side zones panel for named zones and deck zones.
 *
 * Responsibilities:
 * - Create named zones and deck zones (via Curiosa URL import).
 * - Toggle zone visibility on canvas and focus existing zones.
 * - Surface zone-level actions (hide, center, delete).
 *
 * Related files:
 * - `src/data/curiosaService.ts` (deck URL fetch/import)
 * - `src/zones/zones.ts` (zone data model)
 * - `src/app/App.tsx` (zone callback wiring)
 */

import { useMemo, useState, useCallback, useEffect } from "react";
import type { Deck } from "@/data/dataModels";
import { fetchCuriosaDeck } from "@/data/curiosaService";
import type { ZoneModel } from "@/zones/zones";

interface ZonesPanelProps {
  zones: ZoneModel[];
  onCreateNamedZone: (name: string) => string | null;
  onCreateDeckZone: (deck: Deck) => string | null;
  onDeleteZone: (zoneId: string) => void;
  onSetZonePinned: (zoneId: string, pinned: boolean) => void;
  onFocusZone: (zoneId: string) => void;
}

const EDGE_TRIGGER_PX = 72;

/**
 * Build card-count status text for a zone row/header.
 *
 * Inputs:
 * - `zone`: Zone model to summarize.
 *
 * Outputs:
 * - Returns text showing card count and canvas visibility.
 */
function zoneCountLabel(zone: ZoneModel): string {
  return `${zone.cards.length} cards ${zone.pinned ? "on canvas" : "hidden"}`;
}

/**
 * Render the zones tabs and selected zone details drawer.
 *
 * Inputs:
 * - `zones`: All zone models.
 * - `onCreateNamedZone`: Callback to create custom zone.
 * - `onCreateDeckZone`: Callback to create deck-backed zone.
 * - `onDeleteZone`: Callback to remove zone.
 * - `onSetZonePinned`: Callback to pin/unpin zone.
 * - `onFocusZone`: Callback to center camera on zone.
 *
 * Outputs:
 * - Returns React markup for zone controls and action drawer.
 */
export function ZonesPanel({
  zones,
  onCreateNamedZone,
  onCreateDeckZone,
  onDeleteZone,
  onSetZonePinned,
  onFocusZone,
}: ZonesPanelProps) {
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [edgeNear, setEdgeNear] = useState(false);
  const [hoveringTabs, setHoveringTabs] = useState(false);
  const [hoveringPanel, setHoveringPanel] = useState(false);
  const [isLoadingDeck, setIsLoadingDeck] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [pendingDeleteZoneId, setPendingDeleteZoneId] = useState<string | null>(
    null,
  );

  const deckZones = useMemo(
    () => zones.filter((zone) => zone.type === "deck"),
    [zones],
  );
  const namedZones = useMemo(
    () => zones.filter((zone) => zone.type === "custom"),
    [zones],
  );
  const activeZone = useMemo(
    () => zones.find((zone) => zone.id === activeZoneId) ?? null,
    [activeZoneId, zones],
  );
  const tabsExpanded =
    edgeNear || hoveringTabs || hoveringPanel || activeZone !== null;

  useEffect(() => {
    if (!activeZoneId) return;
    const exists = zones.some((zone) => zone.id === activeZoneId);
    if (!exists) {
      setActiveZoneId(null);
      setPendingDeleteZoneId(null);
    }
  }, [activeZoneId, zones]);

  const handleCreateNamedZone = useCallback(() => {
    const value = window.prompt("Zone name", "");
    if (value === null) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const zoneId = onCreateNamedZone(trimmed);
    if (zoneId) {
      setActiveZoneId(zoneId);
      setPendingDeleteZoneId(null);
    }
  }, [onCreateNamedZone]);

  const handleCreateDeckZone = useCallback(async () => {
    if (isLoadingDeck) return;
    const deckUrl = window.prompt("Deck URL", "");
    if (deckUrl === null) return;
    const trimmed = deckUrl.trim();
    if (!trimmed) return;

    setIsLoadingDeck(true);
    setDeckError(null);
    try {
      const deck = await fetchCuriosaDeck(trimmed);
      const zoneId = onCreateDeckZone(deck);
      if (zoneId) {
        setActiveZoneId(zoneId);
        setPendingDeleteZoneId(null);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load deck";
      setDeckError(message);
    } finally {
      setIsLoadingDeck(false);
    }
  }, [isLoadingDeck, onCreateDeckZone]);

  const handleDeleteActiveZone = useCallback(() => {
    if (!activeZone) return;
    if (pendingDeleteZoneId === activeZone.id) {
      onDeleteZone(activeZone.id);
      setActiveZoneId(null);
      setPendingDeleteZoneId(null);
      return;
    }
    setPendingDeleteZoneId(activeZone.id);
  }, [activeZone, onDeleteZone, pendingDeleteZoneId]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const near = event.clientX >= window.innerWidth - EDGE_TRIGGER_PX;
      setEdgeNear((prev) => (prev === near ? prev : near));
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

  return (
    <div className={`zones-shell ${tabsExpanded ? "tabs-expanded" : ""}`}>
      <div
        className="zones-tabs"
        onMouseEnter={() => setHoveringTabs(true)}
        onMouseLeave={() => setHoveringTabs(false)}
      >
        <div className="zone-tab-section-title">Zones</div>
        <button
          type="button"
          className="zone-tab zone-tab-add"
          onClick={handleCreateNamedZone}
          title="Create zone"
          aria-label="Create zone"
        >
          +
        </button>
        {namedZones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className={`zone-tab zone-tab-custom ${
              activeZoneId === zone.id ? "active" : ""
            }`}
            onClick={() => {
              setActiveZoneId(zone.id);
              setPendingDeleteZoneId(null);
            }}
            onDoubleClick={() => onFocusZone(zone.id)}
            title={zone.name}
          >
            {zone.name}
          </button>
        ))}

        <div className="zone-tab-section-title zone-tab-section-title-decks">
          Decks
        </div>
        <button
          type="button"
          className="zone-tab zone-tab-add"
          onClick={() => void handleCreateDeckZone()}
          disabled={isLoadingDeck}
          title="Load deck from URL"
          aria-label="Load deck from URL"
        >
          {isLoadingDeck ? "..." : "+"}
        </button>
        {deckZones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className={`zone-tab zone-tab-deck ${
              activeZoneId === zone.id ? "active" : ""
            }`}
            onClick={() => {
              setActiveZoneId(zone.id);
              setPendingDeleteZoneId(null);
            }}
            onDoubleClick={() => onFocusZone(zone.id)}
            title={zone.name}
          >
            {zone.name}
          </button>
        ))}
      </div>

      <div
        className={`zones-slide-panel ${activeZone ? "open" : ""}`}
        onMouseEnter={() => setHoveringPanel(true)}
        onMouseLeave={() => setHoveringPanel(false)}
      >
        {activeZone && (
          <>
            <div className="zones-slide-header">
              <div className="zones-slide-title-block">
                <h2>{activeZone.name}</h2>
                <span>{zoneCountLabel(activeZone)}</span>
              </div>
              <button
                type="button"
                className="zones-slide-hide"
                onClick={() => setActiveZoneId(null)}
                title="Hide zone panel"
                aria-label="Hide zone panel"
              >
                &rsaquo;
              </button>
            </div>

            <div className="zones-slide-body">
              <div className="zones-slide-actions">
                <button
                  type="button"
                  className="zones-load-zone-button"
                  onClick={() => {
                    onSetZonePinned(activeZone.id, true);
                    onFocusZone(activeZone.id);
                  }}
                >
                  {activeZone.pinned ? "Center on Canvas" : "Load to Canvas"}
                </button>
                {activeZone.pinned && (
                  <button
                    type="button"
                    className="zones-zone-toggle-button"
                    onClick={() => onSetZonePinned(activeZone.id, false)}
                  >
                    Hide from Canvas
                  </button>
                )}
                <button
                  type="button"
                  className={`zones-delete-zone-button ${
                    pendingDeleteZoneId === activeZone.id ? "delete-confirm" : ""
                  }`}
                  onClick={handleDeleteActiveZone}
                >
                  {pendingDeleteZoneId === activeZone.id ? "Delete" : "X"}
                </button>
              </div>
              {deckError && <p className="zones-error">{deckError}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
