/**
 * Bottom panel for account/deck tools plus card filter/highlight drawers.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppState, selectActiveDeck } from '@/app/AppState';
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
import { fetchCuriosaDeck } from '@/data/curiosaService';
import {
  applyCardFilters,
  ensureCardFilterState,
  isCardFilterActive,
  isCardFilterCriteriaEmpty,
  createEmptyCardFilterCriteria,
  type CardFilterState,
  type CardFilterCriteria,
} from '@/data/cardFilters';

type ToolTab = 'filter' | 'highlight' | null;
type ActionPanel = 'label' | 'account' | 'loadDeck' | null;
type MultiDraftField = 'sets' | 'types' | 'rarities' | 'thresholds';

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

function cloneCriteria(criteria: CardFilterCriteria): CardFilterCriteria {
  return {
    ...criteria,
    sets: [...criteria.sets],
    types: [...criteria.types],
    rarities: [...criteria.rarities],
    thresholds: [...criteria.thresholds],
  };
}

export function BottomPanel() {
  const { state, dispatch } = useAppState();
  const activeDeck = selectActiveDeck(state);
  const [archetypes, setArchetypes] = useState<string[]>([]);
  const [removedArchetypes, setRemovedArchetypes] = useState<string[]>([]);
  const [scores, setScores] = useState<ArchetypeScores | null>(null);
  const [deckUrl, setDeckUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeToolTab, setActiveToolTab] = useState<ToolTab>(null);
  const [activeActionPanel, setActiveActionPanel] = useState<ActionPanel>(null);
  const [highlightRemoveMode, setHighlightRemoveMode] = useState(false);

  // Add/remove-category UI state
  const [showAddInput, setShowAddInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [selectedRemovedCategory, setSelectedRemovedCategory] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removingCategory, setRemovingCategory] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const cardFilters = useMemo(
    () => ensureCardFilterState(state.ui.cardFilters),
    [state.ui.cardFilters],
  );
  const draftFilter = cardFilters.draft;

  const filteredCards = useMemo(
    () => applyCardFilters(state.cards, cardFilters),
    [state.cards, cardFilters],
  );
  const filterActive = useMemo(
    () => isCardFilterActive(cardFilters),
    [cardFilters],
  );
  const canAddFilter = useMemo(
    () => !isCardFilterCriteriaEmpty(draftFilter),
    [draftFilter],
  );

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

  const updateDraft = useCallback(
    (patch: Partial<CardFilterCriteria>) => {
      setCardFilters({
        ...cardFilters,
        draft: { ...cardFilters.draft, ...patch },
      });
    },
    [cardFilters, setCardFilters],
  );

  const toggleDraftToken = useCallback(
    (field: MultiDraftField, value: string) => {
      const nextList = toggleMultiToken(cardFilters.draft[field], value);
      updateDraft({ [field]: nextList } as Pick<CardFilterCriteria, MultiDraftField>);
    },
    [cardFilters.draft, updateDraft],
  );

  const handleAddFilter = useCallback(() => {
    if (!canAddFilter) return;
    setCardFilters({
      clauses: [...cardFilters.clauses, cloneCriteria(cardFilters.draft)],
      draft: createEmptyCardFilterCriteria(),
    });
  }, [canAddFilter, cardFilters, setCardFilters]);

  const handleRemoveFilterClause = useCallback(
    (index: number) => {
      setCardFilters({
        ...cardFilters,
        clauses: cardFilters.clauses.filter((_, clauseIndex) => clauseIndex !== index),
      });
    },
    [cardFilters, setCardFilters],
  );

  const handleResetDraft = useCallback(() => {
    setCardFilters({ ...cardFilters, draft: createEmptyCardFilterCriteria() });
  }, [cardFilters, setCardFilters]);

  const handleLoadDeck = useCallback(async () => {
    if (!deckUrl.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const deck = await fetchCuriosaDeck(deckUrl.trim());
      dispatch({ type: 'CREATE_DECK', deck });
      dispatch({ type: 'SET_ACTIVE_DECK', deckId: deck.id });
      setDeckUrl('');
      setActiveActionPanel(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load deck';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [deckUrl, isLoading, dispatch]);

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

  const openToolTab = useCallback(
    (tab: Exclude<ToolTab, null>) => {
      if (tab === 'highlight') {
        setHighlightRemoveMode(false);
      }

      const next = activeToolTab === tab ? null : tab;
      setActiveToolTab(next);

      if (next === 'filter' && activeToolTab !== 'filter' && cardFilters.clauses.length > 0) {
        setCardFilters({
          ...cardFilters,
          clauses: [],
        });
      }
    },
    [activeToolTab, cardFilters, setCardFilters],
  );

  const openActionPanel = useCallback((panel: Exclude<ActionPanel, null>) => {
    setActiveActionPanel((prev) => (prev === panel ? null : panel));
    if (panel !== 'loadDeck') {
      setError(null);
    }
  }, []);

  return (
    <>
      <div className="bottom-tools">
        <div className={`bottom-tools-drawer ${activeToolTab ? 'open' : ''}`}>
          {activeToolTab === 'filter' && (
            <div className="bottom-tools-content">
              <div className="filter-toolbar">
                <button
                  type="button"
                  className="archetype-button"
                  onClick={handleAddFilter}
                  disabled={!canAddFilter}
                >
                  Add Filter
                </button>
                <button
                  type="button"
                  className="archetype-button"
                  onClick={handleResetDraft}
                  disabled={!canAddFilter}
                >
                  Reset Current
                </button>
                <button
                  type="button"
                  className="archetype-button"
                  onClick={() => dispatch({ type: 'CLEAR_CARD_FILTERS' })}
                  disabled={!filterActive && !canAddFilter}
                >
                  Clear All
                </button>
                <span className="filter-summary">
                  {filteredCards.length} / {state.cards.length} cards • {cardFilters.clauses.length}{' '}
                  group{cardFilters.clauses.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="filter-clause-list">
                {cardFilters.clauses.length === 0 ? (
                  <p className="bottom-tools-note">
                    No filter groups yet. Configure criteria below, then click Add Filter.
                  </p>
                ) : (
                  cardFilters.clauses.map((clause, index) => (
                    <div key={index} className="filter-clause-item">
                      <span>{describeFilterClause(clause)}</span>
                      <button
                        type="button"
                        className="filter-clause-remove"
                        onClick={() => handleRemoveFilterClause(index)}
                        title="Remove filter group"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="filter-grid">
                <label className="filter-field">
                  <span>Text Search</span>
                  <input
                    type="text"
                    value={draftFilter.searchText}
                    onChange={(e) => updateDraft({ searchText: e.target.value })}
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
                          includesToken(draftFilter.sets, setName) ? 'active' : ''
                        }`}
                        onClick={() => toggleDraftToken('sets', setName)}
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
                          includesToken(draftFilter.types, typeName) ? 'active' : ''
                        }`}
                        onClick={() => toggleDraftToken('types', typeName)}
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
                          includesToken(draftFilter.rarities, rarity) ? 'active' : ''
                        }`}
                        onClick={() => toggleDraftToken('rarities', rarity)}
                      >
                        {rarity}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="filter-field">
                  <span>Sub-type</span>
                  <select
                    value={draftFilter.subType}
                    onChange={(e) => updateDraft({ subType: e.target.value })}
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
                    value={draftFilter.artist}
                    onChange={(e) => updateDraft({ artist: e.target.value })}
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
                          includesToken(draftFilter.thresholds, threshold) ? 'active' : ''
                        }`}
                        onClick={() => toggleDraftToken('thresholds', threshold)}
                      >
                        {threshold}
                      </button>
                    ))}
                    <select
                      value={draftFilter.thresholdMode}
                      onChange={(e) =>
                        updateDraft({
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
                      value={draftFilter.costMin ?? ''}
                      onChange={(e) =>
                        updateDraft({ costMin: parseNumberOrNull(e.target.value) })
                      }
                      placeholder="Min"
                    />
                    <input
                      type="number"
                      value={draftFilter.costMax ?? ''}
                      onChange={(e) =>
                        updateDraft({ costMax: parseNumberOrNull(e.target.value) })
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
                      value={draftFilter.attackMin ?? ''}
                      onChange={(e) =>
                        updateDraft({ attackMin: parseNumberOrNull(e.target.value) })
                      }
                      placeholder="Min"
                    />
                    <input
                      type="number"
                      value={draftFilter.attackMax ?? ''}
                      onChange={(e) =>
                        updateDraft({ attackMax: parseNumberOrNull(e.target.value) })
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
                      value={draftFilter.defenceMin ?? ''}
                      onChange={(e) =>
                        updateDraft({ defenceMin: parseNumberOrNull(e.target.value) })
                      }
                      placeholder="Min"
                    />
                    <input
                      type="number"
                      value={draftFilter.defenceMax ?? ''}
                      onChange={(e) =>
                        updateDraft({ defenceMax: parseNumberOrNull(e.target.value) })
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
      </div>

      <div className={`bottom-action-drawer ${activeActionPanel ? 'open' : ''}`}>
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

        {activeActionPanel === 'account' && (
          <div className="bottom-action-content">
            <p className="bottom-tools-note">
              {state.session.isGuest
                ? 'Guest mode active. Open account to sign up or log in.'
                : `Signed in as ${state.session.username ?? 'Account'}.`}
            </p>
            <button
              type="button"
              className="archetype-button"
              onClick={handleOpenAccount}
            >
              {state.session.isGuest ? 'Open Log In' : 'Open Account'}
            </button>
          </div>
        )}

        {activeActionPanel === 'loadDeck' && (
          <div className="bottom-action-content">
            <div className="load-deck-row">
              <input
                type="text"
                placeholder="curiosa.io deck URL..."
                value={deckUrl}
                onChange={(e) => setDeckUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleLoadDeck()}
                disabled={isLoading}
                autoFocus
              />
              <button
                type="button"
                onClick={() => void handleLoadDeck()}
                disabled={!deckUrl.trim() || isLoading}
              >
                {isLoading ? '...' : 'Load'}
              </button>
            </div>
            {error && <div className="load-deck-error">{error}</div>}
          </div>
        )}
      </div>

      <div className="bottom-panel">
        <div className="bottom-tools-tabs bottom-tools-tabs-inline">
          <button
            type="button"
            className={`bottom-tool-tab ${activeToolTab === 'filter' ? 'active' : ''}`}
            onClick={() => openToolTab('filter')}
          >
            Filter Cards
          </button>
          <button
            type="button"
            className={`bottom-tool-tab ${activeToolTab === 'highlight' ? 'active' : ''}`}
            onClick={() => openToolTab('highlight')}
          >
            Highlight Cards
          </button>
        </div>

        <div className="bottom-panel-deck">
          <button
            type="button"
            className={`archetype-button ${
              activeActionPanel === 'label' || state.ui.labelPlacementMode ? 'active' : ''
            }`}
            onClick={() => openActionPanel('label')}
          >
            Add Label
          </button>

          <button
            type="button"
            className={`archetype-button ${activeActionPanel === 'account' ? 'active' : ''}`}
            onClick={() => openActionPanel('account')}
          >
            {state.session.isGuest ? 'Log In' : (state.session.username ?? 'Account')}
          </button>

          <button
            type="button"
            className={`archetype-button ${activeActionPanel === 'loadDeck' ? 'active' : ''}`}
            onClick={() => openActionPanel('loadDeck')}
          >
            Load Deck
          </button>

          {activeDeck && (
            <span className="deck-label" title={activeDeck.name}>
              {activeDeck.name}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Export getter for archetype scores for use by PixiCanvas
 */
export { loadArchetypeScores } from '@/data/archetypeScores';
