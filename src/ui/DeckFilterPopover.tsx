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
import type { ZoneModel } from '@/zones/zones';

interface DeckFilterPopoverProps {
  zone: ZoneModel | null;
  cards: Card[];
  anchorRect: { left: number; top: number; right: number; bottom: number } | null;
  requestNonce: number;
  requestedEditingFilterIndex: number | null;
  onUpdateZoneFilters: (zoneId: string, filters: CardFilterState) => void;
  onClose: () => void;
}

const POPOVER_WIDTH = 660;
const VIEWPORT_PADDING = 10;

export function DeckFilterPopover({
  zone,
  cards,
  anchorRect,
  requestNonce,
  requestedEditingFilterIndex,
  onUpdateZoneFilters,
  onClose,
}: DeckFilterPopoverProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const zoneFilters = useMemo(
    () => ensureCardFilterState(zone?.cardFilters),
    [zone?.cardFilters],
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
    filters: zoneFilters,
    onFiltersChange: (next) => {
      if (!zone) return;
      onUpdateZoneFilters(zone.id, next);
    },
  });

  const filteredCards = useMemo(
    () => applyCardFilters(cards, filters),
    [cards, filters],
  );

  const filteredCardCount = useMemo(() => {
    if (!zone) return 0;
    const visibleNames = new Set(filteredCards.map((card) => card.name));
    return zone.cards.filter((entry) => visibleNames.has(entry.cardName)).length;
  }, [zone, filteredCards]);

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
    if (!zone) return;
    if (requestedEditingFilterIndex === null || requestedEditingFilterIndex < 0) {
      setEditingFilterIndex(null);
      return;
    }

    if (requestedEditingFilterIndex >= zoneFilters.clauses.length) {
      setEditingFilterIndex(zoneFilters.clauses.length > 0 ? zoneFilters.clauses.length - 1 : null);
      return;
    }

    setEditingFilterIndex(requestedEditingFilterIndex);
  }, [requestNonce, requestedEditingFilterIndex, setEditingFilterIndex, zone, zoneFilters.clauses.length]);

  useEffect(() => {
    if (!zone || !anchorRect) return;
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
  }, [anchorRect, onClose, zone]);

  if (!zone || !anchorRect || !position) return null;

  return (
    <div
      ref={rootRef}
      className="deck-filter-popover"
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
    >
      <div className="deck-filter-popover-header">
        <div>
          <p className="deck-filter-popover-title">{zone.name} filters</p>
          <p className="deck-filter-popover-subtitle">
            Filters only affect visibility for this deck zone.
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
        totalCardCount={zone.cards.length}
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
