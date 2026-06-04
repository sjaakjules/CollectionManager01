import { useEffect, useMemo, useRef } from 'react';
import type { Card } from '@/data/dataModels';
import {
  applyCardFilters,
  ensureCardFilterState,
  type CardFilterState,
} from '@/data/cardFilters';
import { buildCardFilterOptions } from '@/data/cardService';
import { CardFilterChipTabs } from '@/ui/CardFilterChipTabs';
import { CardFilterDrawer } from '@/ui/CardFilterDrawer';
import { useCardFilterEditor } from '@/ui/useCardFilterEditor';
import type { CanvasArea } from '@/canvas/canvasAreas';

interface DeckFilterPopoverProps {
  canvasArea: CanvasArea | null;
  cards: Card[];
  anchorRect: { left: number; top: number; right: number; bottom: number } | null;
  requestNonce: number;
  requestedEditingFilterIndex: number | null;
  onUpdateDeckCanvasFilters: (canvasAreaId: string, filters: CardFilterState) => void;
  onClose: () => void;
}

const POPOVER_WIDTH = 660;
const VIEWPORT_PADDING = 10;

export function DeckFilterPopover({
  canvasArea,
  cards,
  anchorRect,
  requestNonce,
  requestedEditingFilterIndex,
  onUpdateDeckCanvasFilters,
  onClose,
}: DeckFilterPopoverProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const deckCanvasFilters = useMemo(
    () => ensureCardFilterState(canvasArea?.cardFilters),
    [canvasArea?.cardFilters],
  );

  const {
    filters,
    editingFilterIndex,
    setEditingFilterIndex,
    currentFilterCriteria,
    editingExistingFilter,
    editingFilterClause,
    activeFilterCount,
    beginNewFilter,
    selectFilterClause,
    toggleFilterClauseEnabled,
    deleteFilterClause,
    toggleCurrentFilterToken,
    updateCurrentFilter,
  } = useCardFilterEditor({
    filters: deckCanvasFilters,
    onFiltersChange: (next) => {
      if (!canvasArea) return;
      onUpdateDeckCanvasFilters(canvasArea.id, next);
    },
  });

  const filteredCards = useMemo(
    () => applyCardFilters(cards, filters),
    [cards, filters],
  );

  const filteredCardCount = useMemo(() => {
    if (!canvasArea) return 0;
    const visibleNames = new Set(filteredCards.map((card) => card.name));
    return canvasArea.cards.filter((entry) => visibleNames.has(entry.cardName)).length;
  }, [canvasArea, filteredCards]);

  const availableFilterOptions = useMemo(
    () => buildCardFilterOptions(cards),
    [cards],
  );

  const position = useMemo(() => {
    if (!anchorRect) return null;
    const leftLimit = VIEWPORT_PADDING;
    const rightLimit = window.innerWidth - POPOVER_WIDTH - VIEWPORT_PADDING;
    const left = Math.max(leftLimit, Math.min(anchorRect.left, rightLimit));
    const top = Math.max(VIEWPORT_PADDING, anchorRect.bottom + 8);
    return { left, top };
  }, [anchorRect]);

  useEffect(() => {
    if (!canvasArea) return;
    if (requestedEditingFilterIndex === null || requestedEditingFilterIndex < 0) {
      setEditingFilterIndex(null);
      return;
    }

    if (requestedEditingFilterIndex >= deckCanvasFilters.clauses.length) {
      setEditingFilterIndex(
        deckCanvasFilters.clauses.length > 0
          ? deckCanvasFilters.clauses.length - 1
          : null,
      );
      return;
    }

    setEditingFilterIndex(requestedEditingFilterIndex);
  }, [
    canvasArea,
    deckCanvasFilters.clauses.length,
    requestNonce,
    requestedEditingFilterIndex,
    setEditingFilterIndex,
  ]);

  useEffect(() => {
    if (!canvasArea || !anchorRect) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target)) return;
      onClose();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [anchorRect, canvasArea, onClose]);

  if (!canvasArea || !anchorRect || !position) return null;

  return (
    <div
      ref={rootRef}
      className="deck-filter-popover"
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
    >
      <div className="deck-filter-popover-header">
        <div>
          <p className="deck-filter-popover-title">{canvasArea.name} filters</p>
          <p className="deck-filter-popover-subtitle">
            Filters only affect visibility for this deck on the canvas.
          </p>
        </div>
        <button
          type="button"
          className="deck-filter-popover-close"
          onClick={onClose}
          aria-label="Close deck filters"
        >
          ×
        </button>
      </div>

      <div className="bottom-tools-tabs bottom-tools-tabs-inline deck-filter-chip-row">
        <button
          type="button"
          className="bottom-tool-tab"
          onClick={beginNewFilter}
        >
          Add Filter
        </button>
        <CardFilterChipTabs
          clauses={filters.clauses}
          editingFilterIndex={editingFilterIndex}
          filterEditorOpen
          onSelectClause={selectFilterClause}
          onRemoveClause={deleteFilterClause}
        />
      </div>

      <CardFilterDrawer
        isOpen
        currentFilterCriteria={currentFilterCriteria}
        editingExistingFilter={editingExistingFilter}
        editingFilterIndex={editingFilterIndex}
        editingFilterEnabled={editingFilterClause?.enabled ?? false}
        filteredCardCount={filteredCardCount}
        totalCardCount={canvasArea.cards.length}
        activeFilterCount={activeFilterCount}
        clauseCount={filters.clauses.length}
        availableOptions={availableFilterOptions}
        onUpdateCurrentFilter={updateCurrentFilter}
        onToggleCurrentFilterToken={toggleCurrentFilterToken}
        onToggleEditingFilterEnabled={toggleFilterClauseEnabled}
        onDeleteEditingFilter={deleteFilterClause}
      />
    </div>
  );
}
