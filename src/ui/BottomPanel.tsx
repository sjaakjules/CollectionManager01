/**
 * Bottom panel for account/deck tools plus card filter/highlight drawers.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppState } from '@/app/AppState';
import type { Deck } from '@/data/dataModels';
import { fetchCuriosaDeck } from '@/data/curiosaService';
import {
  loadArchetypeScores,
  getArchetypeNames,
  getRemovedArchetypeNames,
  formatArchetypeName,
  addCategory,
  removeCategory,
  invalidateArchetypeCache,
  type ArchetypeScores,
} from '@/data/archetypeScores';
import {
  applyCardFilters,
  ensureCardFilterState,
  isCardFilterCriteriaEmpty,
  createEmptyCardFilterCriteria,
  type CardFilterState,
  type CardFilterCriteria,
} from '@/data/cardFilters';
import type { ZoneModel } from '@/zones/zones';

type ToolTab = 'filter' | 'highlight' | null;
type ActionPanel = 'label' | null;
type BottomHubTab = 'cards' | 'zones' | 'decks' | null;
type MultiCriteriaField = 'sets' | 'types' | 'rarities' | 'thresholds';

const BOTTOM_EDGE_TRIGGER_PX = 92;

interface BottomPanelProps {
  zones: ZoneModel[];
  onCreateNamedZone: (name: string) => string | null;
  onCreateDeckZone: (deck: Deck) => string | null;
  onDeleteZone: (zoneId: string) => void;
  onFocusZone: (zoneId: string) => void;
}

function parseNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function includesToken(list: string[], token: string): boolean {
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) return false;

  return list.some((entry) => normalizeToken(entry) === normalizedToken);
}

function toggleMultiToken(list: string[], token: string): string[] {
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) return list;

  if (includesToken(list, normalizedToken)) {
    return list.filter((entry) => normalizeToken(entry) !== normalizedToken);
  }
  return [...list, normalizedToken];
}

function parseSubTypeTokens(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/[,/|]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function describeNumericRange(
  label: string,
  min: number | null,
  max: number | null,
): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${label} ${min}-${max}`;
  if (min !== null) return `${label} >= ${min}`;
  return `${label} <= ${max}`;
}

function describeFilterClause(criteria: CardFilterCriteria): string {
  const parts: string[] = [];

  if (criteria.sets.length > 0) {
    parts.push(`Set: ${criteria.sets.join(' or ')}`);
  }
  if (criteria.types.length > 0) {
    parts.push(`Type: ${criteria.types.join(' or ')}`);
  }
  if (criteria.rarities.length > 0) {
    parts.push(`Rarity: ${criteria.rarities.join(' or ')}`);
  }
  if (criteria.subType.trim()) {
    parts.push(`Sub-type: ${criteria.subType.trim()}`);
  }
  if (criteria.artist.trim()) {
    parts.push(`Artist: ${criteria.artist.trim()}`);
  }
  if (criteria.thresholds.length > 0) {
    parts.push(
      `Threshold: ${criteria.thresholds.join(' + ')} (${criteria.thresholdMode})`,
    );
  }

  const costText = describeNumericRange('Cost', criteria.costMin, criteria.costMax);
  const attackText = describeNumericRange(
    'Attack',
    criteria.attackMin,
    criteria.attackMax,
  );
  const defenceText = describeNumericRange(
    'Defence',
    criteria.defenceMin,
    criteria.defenceMax,
  );

  if (costText) parts.push(costText);
  if (attackText) parts.push(attackText);
  if (defenceText) parts.push(defenceText);

  if (criteria.searchText.trim()) {
    parts.push(`Text: "${criteria.searchText.trim()}"`);
  }

  return parts.join(' • ');
}

function toTitleToken(token: string): string {
  if (!token.trim()) return '';
  return token
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function summarizeTokens(
  label: string,
  values: string[],
  maxTokens = 2,
): string | null {
  if (values.length === 0) return null;
  const shown = values.slice(0, maxTokens).map((token) => toTitleToken(token));
  const suffix = values.length > maxTokens ? '+' : '';
  return `${label}:${shown.join('/')}${suffix}`;
}

function compactRange(
  label: string,
  min: number | null,
  max: number | null,
): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${label}:${min}-${max}`;
  if (min !== null) return `${label}:>=${min}`;
  return `${label}:<=${max}`;
}

function describeFilterButton(criteria: CardFilterCriteria): string {
  const parts: string[] = [];

  if (criteria.searchText.trim()) {
    parts.push(`Text:${criteria.searchText.trim().slice(0, 10)}`);
  }

  const setPart = summarizeTokens('Set', criteria.sets, 1);
  if (setPart) parts.push(setPart);

  const typePart = summarizeTokens('Type', criteria.types, 2);
  if (typePart) parts.push(typePart);

  const rarityPart = summarizeTokens('R', criteria.rarities, 1);
  if (rarityPart) parts.push(rarityPart);

  if (criteria.subType.trim()) {
    parts.push(`Sub:${toTitleToken(criteria.subType.trim())}`);
  }
  if (criteria.artist.trim()) {
    parts.push(`Artist:${criteria.artist.trim().slice(0, 10)}`);
  }

  const thresholdPart = summarizeTokens('Th', criteria.thresholds, 2);
  if (thresholdPart) parts.push(thresholdPart);

  const costPart = compactRange('C', criteria.costMin, criteria.costMax);
  const attackPart = compactRange('A', criteria.attackMin, criteria.attackMax);
  const defencePart = compactRange('D', criteria.defenceMin, criteria.defenceMax);
  if (costPart) parts.push(costPart);
  if (attackPart) parts.push(attackPart);
  if (defencePart) parts.push(defencePart);

  if (parts.length === 0) return 'Empty';
  return parts.slice(0, 2).join(' | ');
}

function cloneCriteria(criteria: CardFilterCriteria): CardFilterCriteria {
  return {
    ...criteria,
    sets: [...criteria.sets],
    types: [...criteria.types],
    rarities: [...criteria.rarities],
    thresholds: [...criteria.thresholds],
  };
}

export function BottomPanel({
  zones,
  onCreateNamedZone,
  onCreateDeckZone,
  onDeleteZone,
  onFocusZone,
}: BottomPanelProps) {
  const { state, dispatch } = useAppState();
  const [archetypes, setArchetypes] = useState<string[]>([]);
  const [removedArchetypes, setRemovedArchetypes] = useState<string[]>([]);
  const [scores, setScores] = useState<ArchetypeScores | null>(null);
  const [activeHubTab, setActiveHubTab] = useState<BottomHubTab>(null);
  const [activeToolTab, setActiveToolTab] = useState<ToolTab>(null);
  const [activeActionPanel, setActiveActionPanel] = useState<ActionPanel>(null);
  const [edgeNear, setEdgeNear] = useState(false);
  const [highlightRemoveMode, setHighlightRemoveMode] = useState(false);
  const [editingFilterIndex, setEditingFilterIndex] = useState<number | null>(null);
  const [isLoadingDeck, setIsLoadingDeck] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);

  // Add/remove-category UI state
  const [showAddInput, setShowAddInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [selectedRemovedCategory, setSelectedRemovedCategory] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removingCategory, setRemovingCategory] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const namedZones = useMemo(
    () => zones.filter((zone) => zone.type === 'custom'),
    [zones],
  );
  const deckZones = useMemo(
    () => zones.filter((zone) => zone.type === 'deck'),
    [zones],
  );
  const tabsExpanded = edgeNear || activeHubTab !== null;

  const cardFilters = useMemo(
    () => ensureCardFilterState(state.ui.cardFilters),
    [state.ui.cardFilters],
  );

  const filteredCards = useMemo(
    () => applyCardFilters(state.cards, cardFilters),
    [state.cards, cardFilters],
  );
  const activeFilterCount = useMemo(
    () =>
      cardFilters.clauses.filter(
        (clause) =>
          clause.enabled && !isCardFilterCriteriaEmpty(clause.criteria),
      ).length,
    [cardFilters.clauses],
  );
  const editingFilterClause = useMemo(() => {
    if (editingFilterIndex === null) return null;
    return cardFilters.clauses[editingFilterIndex] ?? null;
  }, [cardFilters.clauses, editingFilterIndex]);
  const currentFilterCriteria = editingFilterClause
    ? editingFilterClause.criteria
    : cardFilters.draft;
  const editingExistingFilter = editingFilterClause !== null;

  const availableSets = useMemo(() => {
    const unique = new Set<string>();
    for (const card of state.cards) {
      for (const setEntry of card.sets) {
        if (typeof setEntry.name === 'string' && setEntry.name.trim()) {
          unique.add(setEntry.name.trim());
        }
      }
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [state.cards]);

  const availableTypes = useMemo(() => {
    const unique = new Set<string>();
    for (const card of state.cards) {
      if (typeof card.guardian.type === 'string' && card.guardian.type.trim()) {
        unique.add(card.guardian.type.trim());
      }
    }

    const typeOrder = ['Avatar', 'Minion', 'Magic', 'Aura', 'Artifact', 'Site'];
    return [...unique].sort((a, b) => {
      const aIndex = typeOrder.indexOf(a);
      const bIndex = typeOrder.indexOf(b);
      const safeA = aIndex === -1 ? typeOrder.length : aIndex;
      const safeB = bIndex === -1 ? typeOrder.length : bIndex;
      if (safeA !== safeB) return safeA - safeB;
      return a.localeCompare(b);
    });
  }, [state.cards]);

  const availableRarities = useMemo(() => {
    const unique = new Set<string>();
    for (const card of state.cards) {
      if (typeof card.guardian.rarity === 'string' && card.guardian.rarity.trim()) {
        unique.add(card.guardian.rarity.trim());
      }
    }

    const rarityOrder = ['Ordinary', 'Exceptional', 'Elite', 'Unique'];
    return [...unique].sort((a, b) => {
      const aIndex = rarityOrder.indexOf(a);
      const bIndex = rarityOrder.indexOf(b);
      const safeA = aIndex === -1 ? rarityOrder.length : aIndex;
      const safeB = bIndex === -1 ? rarityOrder.length : bIndex;
      if (safeA !== safeB) return safeA - safeB;
      return a.localeCompare(b);
    });
  }, [state.cards]);

  const availableArtists = useMemo(() => {
    const unique = new Set<string>();
    for (const card of state.cards) {
      for (const setEntry of card.sets) {
        for (const variant of setEntry.variants) {
          if (variant.artist.trim()) {
            unique.add(variant.artist.trim());
          }
        }
      }
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [state.cards]);

  const availableSubTypes = useMemo(() => {
    const unique = new Set<string>();
    for (const card of state.cards) {
      for (const token of parseSubTypeTokens(card.subTypes)) {
        if (token.trim()) unique.add(token.trim());
      }
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [state.cards]);

  const applyArchetypeState = useCallback((nextScores: ArchetypeScores) => {
    setScores(nextScores);
    invalidateArchetypeCache();
    setArchetypes(getArchetypeNames(nextScores));
    setRemovedArchetypes(getRemovedArchetypeNames(nextScores));
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (state.userData?.archetypeScores) {
      if (!cancelled) {
        applyArchetypeState(state.userData.archetypeScores);
      }
      return () => {
        cancelled = true;
      };
    }

    loadArchetypeScores()
      .then((data) => {
        if (cancelled) return;
        applyArchetypeState(data);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.warn('Failed to load archetype scores:', loadError);
        setScores(null);
        setArchetypes([]);
        setRemovedArchetypes([]);
      });

    return () => {
      cancelled = true;
    };
  }, [applyArchetypeState, state.userData?.archetypeScores]);

  const selectedArchetype = state.ui.selectedArchetype;

  const setCardFilters = useCallback(
    (next: CardFilterState) => {
      dispatch({ type: 'SET_CARD_FILTERS', filters: next });
    },
    [dispatch],
  );

  const updateCurrentFilter = useCallback(
    (patch: Partial<CardFilterCriteria>) => {
      if (
        editingFilterIndex !== null &&
        editingFilterIndex >= 0 &&
        editingFilterIndex < cardFilters.clauses.length
      ) {
        setCardFilters({
          ...cardFilters,
          clauses: cardFilters.clauses.map((clause, index) =>
            index === editingFilterIndex
              ? { ...clause, criteria: { ...clause.criteria, ...patch } }
              : clause,
          ),
        });
        return;
      }

      const nextDraft = { ...cardFilters.draft, ...patch };
      if (isCardFilterCriteriaEmpty(nextDraft)) {
        setCardFilters({
          ...cardFilters,
          draft: nextDraft,
        });
        return;
      }

      const nextClauses = [
        ...cardFilters.clauses,
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
    [cardFilters, editingFilterIndex, setCardFilters],
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
      ...cardFilters,
      draft: createEmptyCardFilterCriteria(),
    });
  }, [cardFilters, setCardFilters]);

  const handleSelectFilterClause = useCallback((index: number) => {
    setEditingFilterIndex(index);
    setActiveToolTab('filter');
  }, []);

  const handleToggleFilterClauseEnabled = useCallback(
    (index: number) => {
      if (index < 0 || index >= cardFilters.clauses.length) return;
      setCardFilters({
        ...cardFilters,
        clauses: cardFilters.clauses.map((clause, clauseIndex) =>
          clauseIndex === index
            ? { ...clause, enabled: !clause.enabled }
            : clause,
        ),
      });
    },
    [cardFilters, setCardFilters],
  );

  const handleDeleteFilterClause = useCallback(
    (index: number) => {
      if (index < 0 || index >= cardFilters.clauses.length) return;
      const nextClauses = cardFilters.clauses.filter(
        (_, clauseIndex) => clauseIndex !== index,
      );
      setCardFilters({
        ...cardFilters,
        clauses: nextClauses,
      });
      setEditingFilterIndex((prev) => {
        if (prev === null) return null;
        if (prev === index) {
          return nextClauses.length > 0 ? Math.min(index, nextClauses.length - 1) : null;
        }
        return prev > index ? prev - 1 : prev;
      });
    },
    [cardFilters, setCardFilters],
  );

  const handleOpenAccount = useCallback(() => {
    dispatch({ type: 'TOGGLE_LOGIN_MODAL' });
    setActiveActionPanel(null);
  }, [dispatch]);

  const handleToggleLabelMode = useCallback(() => {
    dispatch({
      type: 'SET_LABEL_PLACEMENT_MODE',
      enabled: !state.ui.labelPlacementMode,
    });
  }, [dispatch, state.ui.labelPlacementMode]);

  const handleAddCategory = useCallback(async () => {
    const candidate = selectedRemovedCategory || newCategoryName;
    const trimmed = candidate.trim();
    if (!trimmed || addingCategory) return;

    setAddingCategory(true);
    setAddError(null);
    setRemoveError(null);

    try {
      const sanitized = await addCategory(trimmed);
      const refreshed = await loadArchetypeScores();
      applyArchetypeState(refreshed);
      setNewCategoryName('');
      setSelectedRemovedCategory('');
      setShowAddInput(false);
      dispatch({ type: 'SET_SELECTED_ARCHETYPE', archetype: sanitized });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add category';
      setAddError(message);
    } finally {
      setAddingCategory(false);
    }
  }, [
    addingCategory,
    applyArchetypeState,
    dispatch,
    newCategoryName,
    selectedRemovedCategory,
  ]);

  const handleRemoveCategory = useCallback(
    async (archetype: string) => {
      if (removingCategory) return;

      setRemovingCategory(archetype);
      setRemoveError(null);
      setAddError(null);

      try {
        const removed = await removeCategory(archetype);
        const refreshed = await loadArchetypeScores();
        applyArchetypeState(refreshed);

        if (state.ui.selectedArchetype === removed) {
          dispatch({ type: 'SET_SELECTED_ARCHETYPE', archetype: null });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove category';
        setRemoveError(message);
      } finally {
        setRemovingCategory(null);
      }
    },
    [applyArchetypeState, dispatch, removingCategory, state.ui.selectedArchetype],
  );

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      void handleAddCategory();
    } else if (e.key === 'Escape') {
      setShowAddInput(false);
      setNewCategoryName('');
      setSelectedRemovedCategory('');
      setAddError(null);
      setRemoveError(null);
    }
  };

  useEffect(() => {
    if (editingFilterIndex === null) return;
    if (editingFilterIndex < cardFilters.clauses.length) return;

    setEditingFilterIndex(
      cardFilters.clauses.length > 0 ? cardFilters.clauses.length - 1 : null,
    );
  }, [cardFilters.clauses.length, editingFilterIndex]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const near = event.clientY >= window.innerHeight - BOTTOM_EDGE_TRIGGER_PX;
      setEdgeNear((prev) => (prev === near ? prev : near));
    };

    window.addEventListener('pointermove', handlePointerMove);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('.pixi-canvas-container')) return;
      setActiveHubTab(null);
      setActiveToolTab(null);
      setActiveActionPanel(null);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, []);

  const openToolTab = useCallback(
    (tab: Exclude<ToolTab, null>) => {
      if (tab === 'highlight') {
        setHighlightRemoveMode(false);
        setActiveToolTab(activeToolTab === 'highlight' ? null : 'highlight');
        return;
      }

      if (activeToolTab !== 'filter') {
        beginNewFilter();
        setActiveToolTab('filter');
        return;
      }

      if (editingFilterIndex !== null) {
        beginNewFilter();
        return;
      }

      setActiveToolTab(null);
    },
    [activeToolTab, beginNewFilter, editingFilterIndex],
  );

  const openActionPanel = useCallback((panel: Exclude<ActionPanel, null>) => {
    setActiveActionPanel((prev) => (prev === panel ? null : panel));
  }, []);

  const openHubTab = useCallback(
    (tab: Exclude<BottomHubTab, null>) => {
      const nextTab = activeHubTab === tab ? null : tab;
      setActiveHubTab(nextTab);
      if (nextTab !== 'cards') {
        setActiveToolTab(null);
        setActiveActionPanel(null);
        setHighlightRemoveMode(false);
      }
      if (nextTab !== 'decks') {
        setDeckError(null);
      }
    },
    [activeHubTab],
  );

  const handleCreateNamedZone = useCallback(() => {
    const value = window.prompt('Zone name', '');
    if (value === null) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const zoneId = onCreateNamedZone(trimmed);
    if (!zoneId) return;
    setActiveHubTab('zones');
  }, [onCreateNamedZone]);

  const handleCreateDeckZone = useCallback(async () => {
    if (isLoadingDeck) return;
    const deckUrl = window.prompt('Deck URL', '');
    if (deckUrl === null) return;
    const trimmed = deckUrl.trim();
    if (!trimmed) return;

    setIsLoadingDeck(true);
    setDeckError(null);
    try {
      const deck = await fetchCuriosaDeck(trimmed);
      const zoneId = onCreateDeckZone(deck);
      if (!zoneId) return;
      setActiveHubTab('decks');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load deck';
      setDeckError(message);
    } finally {
      setIsLoadingDeck(false);
    }
  }, [isLoadingDeck, onCreateDeckZone]);

  return (
    <>
      <button
        type="button"
        className="top-login-button"
        onClick={handleOpenAccount}
      >
        {state.session.isGuest ? 'Log In' : (state.session.username ?? 'Account')}
      </button>

      <div
        className={`bottom-folder-shell ${activeHubTab ? 'open' : ''} ${
          tabsExpanded ? 'tabs-expanded' : ''
        }`}
      >
        <div className={`bottom-folder-panel ${activeHubTab ? 'open' : ''}`}>
        {activeHubTab === 'cards' && (
          <>
            <div className="cards-panel-toolbar">
              <div className="bottom-tools-tabs bottom-tools-tabs-inline">
                <button
                  type="button"
                  className={`bottom-tool-tab ${activeToolTab === 'highlight' ? 'active' : ''}`}
                  onClick={() => openToolTab('highlight')}
                >
                  Highlight Cards
                </button>
                <button
                  type="button"
                  className={`bottom-tool-tab ${activeToolTab === 'filter' ? 'active' : ''}`}
                  onClick={() => openToolTab('filter')}
                  >
                    Filter Cards
                  </button>
                  <button
                    type="button"
                    className={`bottom-tool-tab ${
                      activeActionPanel === 'label' || state.ui.labelPlacementMode ? 'active' : ''
                    }`}
                    onClick={() => openActionPanel('label')}
                  >
                    Add Label
                  </button>

                {cardFilters.clauses.map((clause, index) => (
                  <button
                    key={`filter-clause-${index}`}
                    type="button"
                    className={`bottom-tool-tab filter-chip-tab ${
                      activeToolTab === 'filter' && editingFilterIndex === index ? 'active' : ''
                    } ${clause.enabled ? '' : 'inactive'}`}
                    onClick={() => handleSelectFilterClause(index)}
                    title={describeFilterClause(clause.criteria)}
                  >
                    {index > 0 ? 'OR ' : ''}
                    {describeFilterButton(clause.criteria)}
                  </button>
                ))}
              </div>

              <div className="bottom-panel-deck" />
            </div>

            <div className={`cards-tools-drawer ${activeToolTab ? 'open' : ''}`}>
              {activeToolTab === 'filter' && (
                <div className="bottom-tools-content">
                  <div className="filter-toolbar">
                    <span className="filter-editor-title">
                      {editingExistingFilter
                        ? `Editing: ${describeFilterButton(currentFilterCriteria)}`
                        : 'New OR filter: choose criteria to create it'}
                    </span>
                    {editingExistingFilter && editingFilterIndex !== null && (
                      <button
                        type="button"
                        className="archetype-button"
                        onClick={() => handleToggleFilterClauseEnabled(editingFilterIndex)}
                      >
                        {editingFilterClause?.enabled ? 'Hide' : 'Activate'}
                      </button>
                    )}
                    {editingExistingFilter && editingFilterIndex !== null && (
                      <button
                        type="button"
                        className="archetype-button filter-delete-button"
                        onClick={() => handleDeleteFilterClause(editingFilterIndex)}
                      >
                        Delete
                      </button>
                    )}
                    <span className="filter-summary">
                      {filteredCards.length} / {state.cards.length} cards • {activeFilterCount}{' '}
                      active of {cardFilters.clauses.length}
                    </span>
                  </div>

                  <p className="bottom-tools-note">
                    {editingExistingFilter
                      ? 'Changes apply immediately. Use Hide to keep this filter without applying it.'
                      : 'Selecting options creates a new filter button automatically.'}
                  </p>

                  <div className="filter-grid">
                    <label className="filter-field">
                      <span>Text Search</span>
                      <input
                        type="text"
                        value={currentFilterCriteria.searchText}
                        onChange={(e) => updateCurrentFilter({ searchText: e.target.value })}
                        placeholder="Search all card JSON data"
                      />
                    </label>

                    <div className="filter-field">
                      <span>Set</span>
                      <div className="filter-button-row">
                        {availableSets.map((setName) => (
                          <button
                            key={setName}
                            type="button"
                            className={`archetype-button ${
                              includesToken(currentFilterCriteria.sets, setName) ? 'active' : ''
                            }`}
                            onClick={() => toggleCurrentFilterToken('sets', setName)}
                          >
                            {setName}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="filter-field">
                      <span>Type</span>
                      <div className="filter-button-row">
                        {availableTypes.map((typeName) => (
                          <button
                            key={typeName}
                            type="button"
                            className={`archetype-button ${
                              includesToken(currentFilterCriteria.types, typeName) ? 'active' : ''
                            }`}
                            onClick={() => toggleCurrentFilterToken('types', typeName)}
                          >
                            {typeName}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="filter-field">
                      <span>Rarity</span>
                      <div className="filter-button-row">
                        {availableRarities.map((rarity) => (
                          <button
                            key={rarity}
                            type="button"
                            className={`archetype-button ${
                              includesToken(currentFilterCriteria.rarities, rarity) ? 'active' : ''
                            }`}
                            onClick={() => toggleCurrentFilterToken('rarities', rarity)}
                          >
                            {rarity}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="filter-field">
                      <span>Sub-type</span>
                      <select
                        value={currentFilterCriteria.subType}
                        onChange={(e) => updateCurrentFilter({ subType: e.target.value })}
                      >
                        <option value="">Any sub-type</option>
                        {availableSubTypes.map((subType) => (
                          <option key={subType} value={subType}>
                            {subType}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="filter-field">
                      <span>Artist</span>
                      <select
                        value={currentFilterCriteria.artist}
                        onChange={(e) => updateCurrentFilter({ artist: e.target.value })}
                      >
                        <option value="">Any artist</option>
                        {availableArtists.map((artist) => (
                          <option key={artist} value={artist}>
                            {artist}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="filter-field">
                      <span>Threshold</span>
                      <div className="threshold-filter-row">
                        {['air', 'earth', 'fire', 'water'].map((threshold) => (
                          <button
                            key={threshold}
                            type="button"
                            className={`archetype-button ${
                              includesToken(currentFilterCriteria.thresholds, threshold)
                                ? 'active'
                                : ''
                            }`}
                            onClick={() => toggleCurrentFilterToken('thresholds', threshold)}
                          >
                            {threshold}
                          </button>
                        ))}
                        <select
                          value={currentFilterCriteria.thresholdMode}
                          onChange={(e) =>
                            updateCurrentFilter({
                              thresholdMode: e.target.value as CardFilterCriteria['thresholdMode'],
                            })
                          }
                        >
                          <option value="inclusive">Inclusive</option>
                          <option value="exclusive">Exclusive</option>
                        </select>
                      </div>
                    </div>

                    <div className="filter-field">
                      <span>Cost</span>
                      <div className="range-row">
                        <input
                          type="number"
                          value={currentFilterCriteria.costMin ?? ''}
                          onChange={(e) =>
                            updateCurrentFilter({ costMin: parseNumberOrNull(e.target.value) })
                          }
                          placeholder="Min"
                        />
                        <input
                          type="number"
                          value={currentFilterCriteria.costMax ?? ''}
                          onChange={(e) =>
                            updateCurrentFilter({ costMax: parseNumberOrNull(e.target.value) })
                          }
                          placeholder="Max"
                        />
                      </div>
                    </div>

                    <div className="filter-field">
                      <span>Attack</span>
                      <div className="range-row">
                        <input
                          type="number"
                          value={currentFilterCriteria.attackMin ?? ''}
                          onChange={(e) =>
                            updateCurrentFilter({ attackMin: parseNumberOrNull(e.target.value) })
                          }
                          placeholder="Min"
                        />
                        <input
                          type="number"
                          value={currentFilterCriteria.attackMax ?? ''}
                          onChange={(e) =>
                            updateCurrentFilter({ attackMax: parseNumberOrNull(e.target.value) })
                          }
                          placeholder="Max"
                        />
                      </div>
                    </div>

                    <div className="filter-field">
                      <span>Defence</span>
                      <div className="range-row">
                        <input
                          type="number"
                          value={currentFilterCriteria.defenceMin ?? ''}
                          onChange={(e) =>
                            updateCurrentFilter({ defenceMin: parseNumberOrNull(e.target.value) })
                          }
                          placeholder="Min"
                        />
                        <input
                          type="number"
                          value={currentFilterCriteria.defenceMax ?? ''}
                          onChange={(e) =>
                            updateCurrentFilter({ defenceMax: parseNumberOrNull(e.target.value) })
                          }
                          placeholder="Max"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeToolTab === 'highlight' && (
                <div className="bottom-tools-content">
                  {scores && archetypes.length > 0 ? (
                    <div className="bottom-panel-buttons">
                      <button
                        type="button"
                        className={`archetype-button ${selectedArchetype === null ? 'active' : ''}`}
                        onClick={() => dispatch({ type: 'SET_SELECTED_ARCHETYPE', archetype: null })}
                        disabled={highlightRemoveMode}
                      >
                        None
                      </button>

                      {archetypes.map((archetype) => (
                        <div key={archetype} className="highlight-category-item">
                          <button
                            type="button"
                            className={`archetype-button ${
                              highlightRemoveMode
                                ? 'remove-mode'
                                : selectedArchetype === archetype
                                  ? 'active'
                                  : ''
                            }`}
                            onClick={() => {
                              if (highlightRemoveMode) {
                                void handleRemoveCategory(archetype);
                              } else {
                                dispatch({ type: 'SET_SELECTED_ARCHETYPE', archetype });
                              }
                            }}
                            disabled={!!removingCategory}
                            title={
                              highlightRemoveMode
                                ? `Remove ${formatArchetypeName(archetype)}`
                                : undefined
                            }
                          >
                            {removingCategory === archetype
                              ? 'Removing...'
                              : formatArchetypeName(archetype)}
                          </button>
                        </div>
                      ))}

                      <div className="highlight-mode-controls">
                        {showAddInput ? (
                          <div className="add-category-inline add-category-inline-expanded">
                            {removedArchetypes.length > 0 && (
                              <select
                                className="add-category-select"
                                value={selectedRemovedCategory}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setSelectedRemovedCategory(value);
                                  if (value) setNewCategoryName('');
                                  setAddError(null);
                                }}
                                disabled={addingCategory}
                              >
                                <option value="">Restore removed category...</option>
                                {removedArchetypes.map((removed) => (
                                  <option key={removed} value={removed}>
                                    {formatArchetypeName(removed)}
                                  </option>
                                ))}
                              </select>
                            )}

                            <input
                              type="text"
                              className="add-category-input"
                              placeholder={
                                removedArchetypes.length > 0
                                  ? 'Or type a new category...'
                                  : 'Category name...'
                              }
                              value={newCategoryName}
                              onChange={(e) => {
                                const value = e.target.value;
                                setNewCategoryName(value);
                                if (value.trim()) setSelectedRemovedCategory('');
                                setAddError(null);
                              }}
                              onKeyDown={handleAddKeyDown}
                              disabled={addingCategory}
                              autoFocus
                            />
                            <button
                              type="button"
                              className="add-category-confirm"
                              onClick={() => void handleAddCategory()}
                              disabled={
                                addingCategory ||
                                (!selectedRemovedCategory && newCategoryName.trim().length === 0)
                              }
                            >
                              {addingCategory
                                ? '...'
                                : selectedRemovedCategory
                                  ? 'Restore'
                                  : 'Add'}
                            </button>
                            <button
                              type="button"
                              className="add-category-cancel"
                              onClick={() => {
                                setShowAddInput(false);
                                setNewCategoryName('');
                                setSelectedRemovedCategory('');
                                setAddError(null);
                                setRemoveError(null);
                              }}
                            >
                              ✕
                            </button>
                            {addError && <span className="add-category-error">{addError}</span>}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="archetype-button add-category-btn"
                            onClick={() => {
                              setShowAddInput(true);
                              setAddError(null);
                              setRemoveError(null);
                            }}
                            disabled={highlightRemoveMode}
                            title={
                              highlightRemoveMode
                                ? 'Disable remove mode to add/restore categories'
                                : undefined
                            }
                          >
                            +
                          </button>
                        )}

                        <button
                          type="button"
                          className={`archetype-button highlight-remove-toggle ${
                            highlightRemoveMode ? 'active remove-mode' : ''
                          }`}
                          onClick={() => {
                            setHighlightRemoveMode((prev) => !prev);
                          }}
                          disabled={!!removingCategory || addingCategory}
                        >
                          -
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="bottom-tools-note">No highlight categories available.</p>
                  )}

                  {removeError && <p className="bottom-tools-note">{removeError}</p>}
                </div>
              )}
            </div>

            <div className={`cards-action-drawer ${activeActionPanel ? 'open' : ''}`}>
              {activeActionPanel === 'label' && (
                <div className="bottom-action-content">
                  <button
                    type="button"
                    className={`archetype-button ${state.ui.labelPlacementMode ? 'active' : ''}`}
                    onClick={handleToggleLabelMode}
                  >
                    {state.ui.labelPlacementMode ? 'Stop Label Placement' : 'Start Label Placement'}
                  </button>
                  <p className="bottom-tools-note">
                    When enabled, click the canvas to place a label. Double-click a label to edit.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {activeHubTab === 'zones' && (
          <div className="folder-list-panel">
            <div className="folder-chip-row">
              <button
                type="button"
                className="bottom-tool-tab folder-add-button"
                onClick={handleCreateNamedZone}
                title="Create zone"
              >
                +
              </button>
              {namedZones.map((zone) => (
                <div key={zone.id} className="folder-chip">
                  <button
                    type="button"
                    className="bottom-tool-tab folder-chip-main"
                    onClick={() => onFocusZone(zone.id)}
                    title={zone.name}
                  >
                    {zone.name}
                  </button>
                  <button
                    type="button"
                    className="folder-chip-delete"
                    onClick={() => onDeleteZone(zone.id)}
                    aria-label={`Delete ${zone.name}`}
                    title={`Delete ${zone.name}`}
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
            {namedZones.length === 0 && (
              <p className="bottom-tools-note">No zones created yet.</p>
            )}
          </div>
        )}

        {activeHubTab === 'decks' && (
          <div className="folder-list-panel">
            <div className="folder-chip-row">
              <button
                type="button"
                className="bottom-tool-tab folder-add-button"
                onClick={() => void handleCreateDeckZone()}
                disabled={isLoadingDeck}
                title="Load deck from URL"
              >
                {isLoadingDeck ? '...' : '+'}
              </button>
              {deckZones.map((zone) => (
                <div key={zone.id} className="folder-chip">
                  <button
                    type="button"
                    className="bottom-tool-tab folder-chip-main"
                    onClick={() => onFocusZone(zone.id)}
                    title={zone.name}
                  >
                    {zone.name}
                  </button>
                  <button
                    type="button"
                    className="folder-chip-delete"
                    onClick={() => onDeleteZone(zone.id)}
                    aria-label={`Delete ${zone.name}`}
                    title={`Delete ${zone.name}`}
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
            {deckZones.length === 0 && (
              <p className="bottom-tools-note">No decks loaded yet.</p>
            )}
            {deckError && <p className="bottom-tools-note">{deckError}</p>}
          </div>
        )}
      </div>

      <div
        className="bottom-folder-tabs"
      >
        {([
          ['cards', 'Canvas'],
          ['zones', 'Zones'],
          ['decks', 'Decks'],
        ] as const).map(([tabId, label]) => {
          const isActive = activeHubTab === tabId;
          const hidden = activeHubTab !== null && !isActive;
          return (
            <button
              key={tabId}
              type="button"
              className={`bottom-folder-tab ${isActive ? 'active' : ''} ${
                hidden ? 'hidden' : ''
              }`}
              onClick={() => openHubTab(tabId)}
            >
              {label}
            </button>
          );
        })}
      </div>
      </div>
    </>
  );
}

/**
 * Export getter for archetype scores for use by PixiCanvas
 */
export { loadArchetypeScores } from '@/data/archetypeScores';
