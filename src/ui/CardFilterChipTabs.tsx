import { describeFilterButton, describeFilterClause } from '@/ui/cardFilterUi';
import type { CardFilterState } from '@/data/cardFilters';

interface CardFilterChipTabsProps {
  clauses: CardFilterState['clauses'];
  editingFilterIndex: number | null;
  filterEditorOpen: boolean;
  onSelectClause: (index: number) => void;
  onRemoveClause: (index: number) => void;
}

export function CardFilterChipTabs({
  clauses,
  editingFilterIndex,
  filterEditorOpen,
  onSelectClause,
  onRemoveClause,
}: CardFilterChipTabsProps) {
  if (clauses.length === 0) return null;

  return (
    <>
      {clauses.map((clause, index) => (
        <div
          key={`filter-clause-${index}`}
          className="filter-chip-wrapper"
        >
          <button
            type="button"
            className={`bottom-tool-tab filter-chip-tab ${
              filterEditorOpen && editingFilterIndex === index ? 'active' : ''
            } ${clause.enabled ? '' : 'inactive'}`}
            onClick={() => onSelectClause(index)}
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
      ))}
    </>
  );
}
