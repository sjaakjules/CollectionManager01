import { describeFilterButton, describeFilterClause } from '@/ui/cardFilterUi';
import type { CardFilterState } from '@/data/cardFilters';
import { shouldDeleteDraggedFilterChip } from '@/ui/filterDetails';
import { useEffect, useRef, useState } from 'react';

interface CardFilterChipTabsProps {
  clauses: CardFilterState['clauses'];
  editingFilterIndex: number | null;
  activeFilterIndex?: number | null;
  filterEditorOpen: boolean;
  onSelectClause: (index: number) => void;
  onRemoveClause: (index: number) => void;
  enableHoldDragDelete?: boolean;
}

export function CardFilterChipTabs({
  clauses,
  editingFilterIndex,
  activeFilterIndex = editingFilterIndex,
  filterEditorOpen,
  onSelectClause,
  onRemoveClause,
  enableHoldDragDelete = false,
}: CardFilterChipTabsProps) {
  const [dragState, setDragState] = useState<{
    index: number;
    origin: { x: number; y: number };
    current: { x: number; y: number };
    armed: boolean;
  } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enableHoldDragDelete || dragState === null) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) return;
      setDragState((previous) =>
        previous
          ? {
              ...previous,
              current: { x: event.clientX, y: event.clientY },
            }
          : previous,
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) return;
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      setDragState((previous) => {
        if (
          previous?.armed &&
          shouldDeleteDraggedFilterChip(previous.origin, {
            x: event.clientX,
            y: event.clientY,
          })
        ) {
          onRemoveClause(previous.index);
        }
        return null;
      });
      pointerIdRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerUp, true);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerUp, true);
    };
  }, [dragState, enableHoldDragDelete, onRemoveClause]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  if (clauses.length === 0) return null;

  return (
    <>
      {clauses.map((clause, index) => {
        const isActive =
          activeFilterIndex === index || (filterEditorOpen && editingFilterIndex === index);
        return (
          <div
            key={`filter-clause-${index}`}
            className={`filter-chip-wrapper ${
              dragState?.index === index && dragState.armed ? 'dragging' : ''
            }`}
            style={
              dragState?.index === index && dragState.armed
                ? {
                    transform: `translate(${dragState.current.x - dragState.origin.x}px, ${
                      dragState.current.y - dragState.origin.y
                    }px) scale(1.04)`,
                  }
                : undefined
            }
          >
          <button
            type="button"
            className={`bottom-tool-tab filter-chip-tab ${
              isActive ? 'active' : ''
            } ${clause.enabled ? '' : 'inactive'}`}
            onClick={() => {
              if (dragState?.armed) return;
              onSelectClause(index);
            }}
            onPointerDown={(event) => {
              if (!enableHoldDragDelete) return;
              pointerIdRef.current = event.pointerId;
              const origin = { x: event.clientX, y: event.clientY };
              setDragState({
                index,
                origin,
                current: origin,
                armed: false,
              });
              if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
              holdTimerRef.current = setTimeout(() => {
                setDragState((previous) =>
                  previous?.index === index ? { ...previous, armed: true } : previous,
                );
                holdTimerRef.current = null;
              }, 220);
            }}
            title={describeFilterClause(clause.criteria)}
          >
            <span className="filter-chip-label">
              {index > 0 ? 'OR ' : ''}
              {describeFilterButton(clause.criteria)}
            </span>
          </button>
          <button
            type="button"
            className="filter-chip-remove"
            aria-label={`Remove filter ${describeFilterButton(clause.criteria)}`}
            title="Remove filter"
            onClick={(event) => {
              event.stopPropagation();
              onRemoveClause(index);
            }}
          >
            ×
          </button>
          </div>
        );
      })}
    </>
  );
}
