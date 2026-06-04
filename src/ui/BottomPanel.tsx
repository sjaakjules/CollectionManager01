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
  setCachedArchetypeScores,
  type ArchetypeScores,
} from '@/data/archetypeScores';
import {
  applyCardFilters,
  ensureCardFilterState,
} from '@/data/cardFilters';
import { buildCardFilterOptions } from '@/data/cardService';
import { CardFilterDrawer } from '@/ui/CardFilterDrawer';
import { CardFilterChipTabs } from '@/ui/CardFilterChipTabs';
import { useCardFilterEditor } from '@/ui/useCardFilterEditor';
import type { ZoneModel } from '@/zones/zones';

type ToolTab = 'filter' | 'highlight' | null;
type ActionPanel = 'label' | null;
type BottomHubTab = 'cards' | 'decks' | null;

const BOTTOM_EDGE_TRIGGER_PX = 92;

interface BottomPanelProps {
  zones: ZoneModel[];
  onCreateDeckZone: (deck: Deck) => string | null;
  onDeleteZone: (zoneId: string) => void;
  onFocusZone: (zoneId: string) => void;
}

export function BottomPanel({
  zones,
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
  const {
    filters: editableCardFilters,
    editingFilterIndex,
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
    filters: cardFilters,
    onFiltersChange: (next) => dispatch({ type: 'SET_CARD_FILTERS', filters: next }),
  });

  const availableFilterOptions = useMemo(
    () => buildCardFilterOptions(state.cards),
    [state.cards],
  );

  const applyArchetypeState = useCallback((nextScores: ArchetypeScores) => {
    setScores(nextScores);
    invalidateArchetypeCache();
    setArchetypes(getArchetypeNames(nextScores));
    setRemovedArchetypes(getRemovedArchetypeNames(nextScores));
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (state.userData?.archetypeScores) {
      setCachedArchetypeScores(state.userData.archetypeScores);
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
        setCachedArchetypeScores(data);
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

  const handleSelectFilterClause = useCallback(
    (index: number) => {
      selectFilterClause(index);
      setActiveToolTab('filter');
    },
    [selectFilterClause],
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

                <CardFilterChipTabs
                  clauses={editableCardFilters.clauses}
                  editingFilterIndex={editingFilterIndex}
                  filterEditorOpen={activeToolTab === 'filter'}
                  onSelectClause={handleSelectFilterClause}
                  onRemoveClause={deleteFilterClause}
                />
              </div>

              <div className="bottom-panel-deck" />
            </div>

            <div className={`cards-tools-drawer ${activeToolTab ? 'open' : ''}`}>
              <CardFilterDrawer
                isOpen={activeToolTab === 'filter'}
                currentFilterCriteria={currentFilterCriteria}
                editingExistingFilter={editingExistingFilter}
                editingFilterIndex={editingFilterIndex}
                editingFilterEnabled={editingFilterClause?.enabled ?? false}
                filteredCardCount={filteredCards.length}
                totalCardCount={state.cards.length}
                activeFilterCount={activeFilterCount}
                clauseCount={editableCardFilters.clauses.length}
                availableOptions={availableFilterOptions}
                onUpdateCurrentFilter={updateCurrentFilter}
                onToggleCurrentFilterToken={toggleCurrentFilterToken}
                onToggleEditingFilterEnabled={toggleFilterClauseEnabled}
                onDeleteEditingFilter={deleteFilterClause}
              />

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
