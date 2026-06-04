import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  createEmptyCardFilterCriteria,
  ensureCardFilterState,
  isCardFilterCriteriaEmpty,
  type CardFilterCriteria,
  type CardFilterState,
} from '@/data/cardFilters';
import { cloneCriteria, toggleMultiToken, type MultiCriteriaField } from '@/ui/cardFilterUi';

interface UseCardFilterEditorConfig {
  filters: CardFilterState;
  onFiltersChange: (next: CardFilterState) => void;
}

export interface CardFilterEditorController {
  filters: CardFilterState;
  editingFilterIndex: number | null;
  setEditingFilterIndex: Dispatch<SetStateAction<number | null>>;
  editingFilterClause: CardFilterState['clauses'][number] | null;
  currentFilterCriteria: CardFilterCriteria;
  editingExistingFilter: boolean;
  activeFilterCount: number;
  updateCurrentFilter: (patch: Partial<CardFilterCriteria>) => void;
  toggleCurrentFilterToken: (field: MultiCriteriaField, value: string) => void;
  beginNewFilter: () => void;
  selectFilterClause: (index: number) => void;
  toggleFilterClauseEnabled: (index: number) => void;
  deleteFilterClause: (index: number) => void;
}

export function useCardFilterEditor({
  filters,
  onFiltersChange,
}: UseCardFilterEditorConfig): CardFilterEditorController {
  const safeFilters = useMemo(() => ensureCardFilterState(filters), [filters]);
  const [editingFilterIndex, setEditingFilterIndex] = useState<number | null>(null);

  const setCardFilters = useCallback(
    (next: CardFilterState) => {
      onFiltersChange(ensureCardFilterState(next));
    },
    [onFiltersChange],
  );

  const activeFilterCount = useMemo(
    () =>
      safeFilters.clauses.filter(
        (clause) => clause.enabled && !isCardFilterCriteriaEmpty(clause.criteria),
      ).length,
    [safeFilters.clauses],
  );

  const editingFilterClause = useMemo(() => {
    if (editingFilterIndex === null) return null;
    return safeFilters.clauses[editingFilterIndex] ?? null;
  }, [editingFilterIndex, safeFilters.clauses]);

  const currentFilterCriteria = editingFilterClause
    ? editingFilterClause.criteria
    : safeFilters.draft;
  const editingExistingFilter = editingFilterClause !== null;

  const updateCurrentFilter = useCallback(
    (patch: Partial<CardFilterCriteria>) => {
      if (
        editingFilterIndex !== null &&
        editingFilterIndex >= 0 &&
        editingFilterIndex < safeFilters.clauses.length
      ) {
        setCardFilters({
          ...safeFilters,
          clauses: safeFilters.clauses.map((clause, index) =>
            index === editingFilterIndex
              ? { ...clause, criteria: { ...clause.criteria, ...patch } }
              : clause,
          ),
        });
        return;
      }

      const nextDraft = { ...safeFilters.draft, ...patch };
      if (isCardFilterCriteriaEmpty(nextDraft)) {
        setCardFilters({
          ...safeFilters,
          draft: nextDraft,
        });
        return;
      }

      const nextClauses = [
        ...safeFilters.clauses,
        {
          criteria: cloneCriteria(nextDraft),
          enabled: true,
        },
      ];

      setCardFilters({
        clauses: nextClauses,
        draft: createEmptyCardFilterCriteria(),
      });
      setEditingFilterIndex(nextClauses.length - 1);
    },
    [editingFilterIndex, safeFilters, setCardFilters],
  );

  const toggleCurrentFilterToken = useCallback(
    (field: MultiCriteriaField, value: string) => {
      const nextList = toggleMultiToken(currentFilterCriteria[field], value);
      updateCurrentFilter({ [field]: nextList } as Pick<
        CardFilterCriteria,
        MultiCriteriaField
      >);
    },
    [currentFilterCriteria, updateCurrentFilter],
  );

  const beginNewFilter = useCallback(() => {
    setEditingFilterIndex(null);
    setCardFilters({
      ...safeFilters,
      draft: createEmptyCardFilterCriteria(),
    });
  }, [safeFilters, setCardFilters]);

  const selectFilterClause = useCallback((index: number) => {
    setEditingFilterIndex(index);
  }, []);

  const toggleFilterClauseEnabled = useCallback(
    (index: number) => {
      if (index < 0 || index >= safeFilters.clauses.length) return;
      setCardFilters({
        ...safeFilters,
        clauses: safeFilters.clauses.map((clause, clauseIndex) =>
          clauseIndex === index
            ? { ...clause, enabled: !clause.enabled }
            : clause,
        ),
      });
    },
    [safeFilters, setCardFilters],
  );

  const deleteFilterClause = useCallback(
    (index: number) => {
      if (index < 0 || index >= safeFilters.clauses.length) return;
      const nextClauses = safeFilters.clauses.filter(
        (_, clauseIndex) => clauseIndex !== index,
      );
      setCardFilters({
        ...safeFilters,
        clauses: nextClauses,
      });
      setEditingFilterIndex((previous) => {
        if (previous === null) return null;
        if (previous === index) {
          return nextClauses.length > 0 ? Math.min(index, nextClauses.length - 1) : null;
        }
        return previous > index ? previous - 1 : previous;
      });
    },
    [safeFilters, setCardFilters],
  );

  useEffect(() => {
    if (editingFilterIndex === null) return;
    if (editingFilterIndex < safeFilters.clauses.length) return;

    setEditingFilterIndex(
      safeFilters.clauses.length > 0 ? safeFilters.clauses.length - 1 : null,
    );
  }, [editingFilterIndex, safeFilters.clauses.length]);

  return {
    filters: safeFilters,
    editingFilterIndex,
    setEditingFilterIndex,
    editingFilterClause,
    currentFilterCriteria,
    editingExistingFilter,
    activeFilterCount,
    updateCurrentFilter,
    toggleCurrentFilterToken,
    beginNewFilter,
    selectFilterClause,
    toggleFilterClauseEnabled,
    deleteFilterClause,
  };
}
