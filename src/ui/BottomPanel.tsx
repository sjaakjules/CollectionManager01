/**
 * Bottom card tools for filters, archetype highlights, and canvas labels.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAppState } from "@/app/AppState";
import {
  addCategory,
  formatArchetypeName,
  getArchetypeNames,
  getRemovedArchetypeNames,
  invalidateArchetypeCache,
  loadArchetypeScores,
  removeCategory,
  setCachedArchetypeScores,
  type ArchetypeScores,
} from "@/data/archetypeScores";
import {
  getAssociationClusterGroups,
  getAssociationPackages,
  hasCollectionAssociationSource,
  loadCardAssociations,
  resolveAssociationNodeId,
  type CardAssociationData,
} from "@/data/cardAssociations";
import { applyCardFilters, ensureCardFilterState } from "@/data/cardFilters";
import { buildCardFilterOptions } from "@/data/cardService";
import { CardFilterChipTabs } from "@/ui/CardFilterChipTabs";
import { CardFilterDrawer } from "@/ui/CardFilterDrawer";
import { countFilterClauseMatches } from "@/ui/filterDetails";
import { describeFilterClause } from "@/ui/cardFilterUi";
import { useCardFilterEditor } from "@/ui/useCardFilterEditor";

type ToolTab = "filter" | "highlight" | "associations" | null;
type ActionPanel = "label" | null;
type FilterPanelMode = "details" | "settings" | null;

const BOTTOM_EDGE_TRIGGER_PX = 92;

interface BottomPanelProps {
  isPhone?: boolean;
  phoneExpanded?: boolean;
  onPhoneTabToggle?: () => void;
}

export function BottomPanel({
  isPhone = false,
  phoneExpanded = false,
  onPhoneTabToggle,
}: BottomPanelProps) {
  const { state, dispatch } = useAppState();
  const [archetypes, setArchetypes] = useState<string[]>([]);
  const [removedArchetypes, setRemovedArchetypes] = useState<string[]>([]);
  const [scores, setScores] = useState<ArchetypeScores | null>(null);
  const [associations, setAssociations] = useState<CardAssociationData | null>(null);
  const [activeToolTab, setActiveToolTab] = useState<ToolTab>(null);
  const [activeActionPanel, setActiveActionPanel] = useState<ActionPanel>(null);
  const [filterPanelMode, setFilterPanelMode] = useState<FilterPanelMode>(null);
  const [filterDetailIndex, setFilterDetailIndex] = useState<number | null>(null);
  const [edgeNear, setEdgeNear] = useState(false);
  const [highlightRemoveMode, setHighlightRemoveMode] = useState(false);
  const filterDetailSwipeStartRef = useRef<number | null>(null);

  const [showAddInput, setShowAddInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [selectedRemovedCategory, setSelectedRemovedCategory] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removingCategory, setRemovingCategory] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const tabsExpanded = isPhone
    ? phoneExpanded
    : edgeNear || activeToolTab !== null || activeActionPanel !== null;
  const panelOpen = isPhone
    ? phoneExpanded
    : activeToolTab !== null || activeActionPanel !== null;

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
    setEditingFilterIndex,
    toggleFilterClauseEnabled,
    deleteFilterClause,
    toggleCurrentFilterToken,
    updateCurrentFilter,
  } = useCardFilterEditor({
    filters: cardFilters,
    onFiltersChange: (next) => dispatch({ type: "SET_CARD_FILTERS", filters: next }),
  });

  const detailClause =
    filterDetailIndex !== null
      ? editableCardFilters.clauses[filterDetailIndex] ?? null
      : null;
  const detailCount = detailClause
    ? countFilterClauseMatches(state.cards, detailClause)
    : 0;
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
        console.warn("Failed to load archetype scores:", loadError);
        setScores(null);
        setArchetypes([]);
        setRemovedArchetypes([]);
      });

    return () => {
      cancelled = true;
    };
  }, [applyArchetypeState, state.userData?.archetypeScores]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const near = event.clientY >= window.innerHeight - BOTTOM_EDGE_TRIGGER_PX;
      setEdgeNear((prev) => (prev === near ? prev : near));
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(".pixi-canvas-container")) return;
      setActiveToolTab(null);
      setActiveActionPanel(null);
      setFilterPanelMode(null);
      setFilterDetailIndex(null);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, []);

  useEffect(() => {
    if (filterDetailIndex === null) return;
    if (filterDetailIndex < editableCardFilters.clauses.length) return;
    setFilterDetailIndex(
      editableCardFilters.clauses.length > 0
        ? editableCardFilters.clauses.length - 1
        : null,
    );
  }, [editableCardFilters.clauses.length, filterDetailIndex]);

  const selectedArchetype = state.ui.selectedArchetype;
  const selectedAssociationCardName =
    state.ui.selectedCardNames.length === 1 ? state.ui.selectedCardNames[0] ?? null : null;
  const selectedAssociationCard = useMemo(
    () =>
      selectedAssociationCardName
        ? state.cards.find((card) => card.name === selectedAssociationCardName) ?? null
        : null,
    [selectedAssociationCardName, state.cards],
  );
  const canUseCollectionSource = hasCollectionAssociationSource(
    associations,
    selectedAssociationCardName,
    selectedAssociationCard?.guardian.type,
  );
  const associationClusterGroups = useMemo(
    () => getAssociationClusterGroups(associations),
    [associations],
  );
  const associationPackages = useMemo(
    () => getAssociationPackages(associations),
    [associations],
  );
  const selectedAssociationClusterGroup = useMemo(
    () =>
      associationClusterGroups.find(
        (group) => group.id === state.ui.associationClusterGroupId,
      ) ?? null,
    [associationClusterGroups, state.ui.associationClusterGroupId],
  );
  const selectedAvatarAssociationClusterGroup = useMemo(() => {
    const nodeId = resolveAssociationNodeId(
      associations,
      selectedAssociationCardName,
      selectedAssociationCard?.guardian.type,
    );
    if (!nodeId?.startsWith("avatar:")) return null;
    return associationClusterGroups.find((group) => group.id === nodeId) ?? null;
  }, [
    associationClusterGroups,
    associations,
    selectedAssociationCard?.guardian.type,
    selectedAssociationCardName,
  ]);
  const effectiveAssociationClusterGroup =
    selectedAssociationClusterGroup ?? selectedAvatarAssociationClusterGroup;
  const selectedAssociationPackage = useMemo(
    () =>
      associationPackages.find(
        (pkg) => pkg.id === state.ui.associationPackageId,
      ) ?? null,
    [associationPackages, state.ui.associationPackageId],
  );

  useEffect(() => {
    let cancelled = false;
    loadCardAssociations(state.ui.associationMode)
      .then((data) => {
        if (!cancelled) setAssociations(data);
      })
      .catch((loadError) => {
        if (!cancelled) {
          console.warn("Failed to load card associations:", loadError);
          setAssociations(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state.ui.associationMode]);

  useEffect(() => {
    if (state.ui.associationSourceZone !== "collection") return;
    if (canUseCollectionSource) return;
    dispatch({ type: "SET_ASSOCIATION_SOURCE_ZONE", sourceZone: "main" });
  }, [canUseCollectionSource, dispatch, state.ui.associationSourceZone]);

  useEffect(() => {
    if (!state.ui.associationClusterGroupId) return;
    if (selectedAssociationClusterGroup) return;
    dispatch({ type: "SET_ASSOCIATION_CLUSTER_GROUP", groupId: null });
  }, [
    dispatch,
    selectedAssociationClusterGroup,
    state.ui.associationClusterGroupId,
  ]);

  useEffect(() => {
    if (!state.ui.associationPackageId) return;
    if (selectedAssociationPackage) return;
    dispatch({ type: "SET_ASSOCIATION_PACKAGE", packageId: null });
  }, [
    dispatch,
    selectedAssociationPackage,
    state.ui.associationPackageId,
  ]);

  const handleOpenAccount = useCallback(() => {
    dispatch({ type: "TOGGLE_LOGIN_MODAL" });
    setActiveActionPanel(null);
  }, [dispatch]);

  const handleToggleLabelMode = useCallback(() => {
    dispatch({
      type: "SET_LABEL_PLACEMENT_MODE",
      enabled: !state.ui.labelPlacementMode,
    });
  }, [dispatch, state.ui.labelPlacementMode]);

  const openFilterTab = useCallback(() => {
    dispatch({ type: "SET_ASSOCIATIONS_ENABLED", enabled: false });
    if (isPhone) {
      if (!phoneExpanded) {
        setActiveToolTab("filter");
        setActiveActionPanel(null);
      } else {
        setActiveToolTab(null);
        setActiveActionPanel(null);
        setFilterPanelMode(null);
        setFilterDetailIndex(null);
      }
      onPhoneTabToggle?.();
      return;
    }
    setActiveActionPanel(null);
    setHighlightRemoveMode(false);
    setActiveToolTab((previous) => {
      const next = previous === "filter" ? null : "filter";
      if (next === null) {
        setFilterPanelMode(null);
        setFilterDetailIndex(null);
      }
      return next;
    });
  }, [dispatch, isPhone, onPhoneTabToggle, phoneExpanded]);

  const openHighlightTab = useCallback(() => {
    dispatch({ type: "SET_ASSOCIATIONS_ENABLED", enabled: false });
    setActiveActionPanel(null);
    setFilterPanelMode(null);
    setFilterDetailIndex(null);
    setHighlightRemoveMode(false);
    setActiveToolTab((previous) => (previous === "highlight" ? null : "highlight"));
  }, [dispatch]);

  const openAssociationsTab = useCallback(() => {
    setActiveActionPanel(null);
    setFilterPanelMode(null);
    setFilterDetailIndex(null);
    setHighlightRemoveMode(false);
    dispatch({ type: "SET_ASSOCIATIONS_ENABLED", enabled: true });
    dispatch({ type: "SET_ASSOCIATION_SOURCE_ZONE", sourceZone: "main" });
    if (state.ui.associationPanelView !== "packages") {
      dispatch({ type: "SET_ASSOCIATION_CLUSTER_GROUP", groupId: null });
      dispatch({ type: "SET_ASSOCIATION_CLUSTER", clusterId: null });
    }
    dispatch({ type: "SET_SELECTED_ARCHETYPE", archetype: null });
    setActiveToolTab("associations");
  }, [dispatch, state.ui.associationPanelView]);

  const openLabelPanel = useCallback(() => {
    dispatch({ type: "SET_ASSOCIATIONS_ENABLED", enabled: false });
    setActiveToolTab(null);
    setFilterPanelMode(null);
    setFilterDetailIndex(null);
    setActiveActionPanel((previous) => (previous === "label" ? null : "label"));
  }, [dispatch]);

  const handleBeginNewFilter = useCallback(() => {
    beginNewFilter();
    setActiveToolTab("filter");
    setActiveActionPanel(null);
    setFilterDetailIndex(null);
    setFilterPanelMode("settings");
    if (isPhone && !phoneExpanded) {
      onPhoneTabToggle?.();
    }
  }, [beginNewFilter, isPhone, onPhoneTabToggle, phoneExpanded]);

  const openFilterSettings = useCallback(
    (index: number) => {
      selectFilterClause(index);
      setFilterDetailIndex(index);
      setFilterPanelMode("settings");
      setActiveToolTab("filter");
      setActiveActionPanel(null);
    },
    [selectFilterClause],
  );

  const handleSelectFilterClause = useCallback(
    (index: number) => {
      if (filterDetailIndex === index && filterPanelMode === "details") {
        openFilterSettings(index);
        return;
      }

      setEditingFilterIndex(index);
      setFilterDetailIndex(index);
      setFilterPanelMode("details");
      setActiveToolTab("filter");
      setActiveActionPanel(null);
    },
    [filterDetailIndex, filterPanelMode, openFilterSettings, setEditingFilterIndex],
  );

  const handleDeleteFilterClause = useCallback(
    (index: number) => {
      deleteFilterClause(index);
      if (filterDetailIndex === index) {
        setFilterDetailIndex(null);
        setFilterPanelMode(null);
      }
    },
    [deleteFilterClause, filterDetailIndex],
  );

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
      setNewCategoryName("");
      setSelectedRemovedCategory("");
      setShowAddInput(false);
      dispatch({ type: "SET_SELECTED_ARCHETYPE", archetype: sanitized });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add category";
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
          dispatch({ type: "SET_SELECTED_ARCHETYPE", archetype: null });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to remove category";
        setRemoveError(message);
      } finally {
        setRemovingCategory(null);
      }
    },
    [applyArchetypeState, dispatch, removingCategory, state.ui.selectedArchetype],
  );

  const handleAddKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      void handleAddCategory();
    } else if (event.key === "Escape") {
      setShowAddInput(false);
      setNewCategoryName("");
      setSelectedRemovedCategory("");
      setAddError(null);
      setRemoveError(null);
    }
  };

  return (
    <>
      <button type="button" className="top-login-button" onClick={handleOpenAccount}>
        {state.session.isGuest ? "Guest" : state.session.username ?? "Account"}
      </button>

      <div className={`bottom-folder-shell ${tabsExpanded ? "tabs-expanded" : ""}`}>
        <div
          className={`bottom-folder-panel ${panelOpen ? "open" : ""}`}
        >
          {activeToolTab === "filter" && (
            <>
              <div className="filter-subtabs">
                <button
                  type="button"
                  className={`bottom-tool-tab filter-add-tab ${
                    filterPanelMode === "settings" && editingFilterIndex === null
                      ? "active"
                      : ""
                  }`}
                  onClick={handleBeginNewFilter}
                  title="Add filter"
                >
                  +
                </button>
                <CardFilterChipTabs
                  clauses={editableCardFilters.clauses}
                  editingFilterIndex={editingFilterIndex}
                  activeFilterIndex={filterDetailIndex}
                  filterEditorOpen={filterPanelMode === "settings"}
                  onSelectClause={handleSelectFilterClause}
                  onRemoveClause={handleDeleteFilterClause}
                  enableHoldDragDelete
                />
              </div>

              {filterPanelMode === "details" && detailClause && (
                <div
                  className="filter-detail-panel"
                  onPointerDown={(event) => {
                    filterDetailSwipeStartRef.current = event.clientY;
                  }}
                  onPointerUp={(event) => {
                    const startY = filterDetailSwipeStartRef.current;
                    filterDetailSwipeStartRef.current = null;
                    if (startY === null || filterDetailIndex === null) return;
                    if (startY - event.clientY > 32) {
                      openFilterSettings(filterDetailIndex);
                    }
                  }}
                >
                  <div className="filter-detail-count">
                    {detailCount} / {state.cards.length} cards
                  </div>
                  <div className="filter-detail-description">
                    {describeFilterClause(detailClause.criteria) || "Empty filter"}
                  </div>
                </div>
              )}

              <div
                className={`cards-tools-drawer ${
                  filterPanelMode === "settings" ? "open" : ""
                }`}
              >
                <CardFilterDrawer
                  isOpen={filterPanelMode === "settings"}
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
                  onDeleteEditingFilter={handleDeleteFilterClause}
                />
              </div>
            </>
          )}

          {activeToolTab === "highlight" && (
            <div className="cards-tools-drawer open">
              <div className="bottom-tools-content">
                {scores && archetypes.length > 0 ? (
                  <div className="bottom-panel-buttons">
                    <button
                      type="button"
                      className={`archetype-button ${
                        selectedArchetype === null ? "active" : ""
                      }`}
                      onClick={() =>
                        dispatch({ type: "SET_SELECTED_ARCHETYPE", archetype: null })
                      }
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
                              ? "remove-mode"
                              : selectedArchetype === archetype
                                ? "active"
                                : ""
                          }`}
                          onClick={() => {
                            if (highlightRemoveMode) {
                              void handleRemoveCategory(archetype);
                            } else {
                              dispatch({
                                type: "SET_SELECTED_ARCHETYPE",
                                archetype,
                              });
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
                            ? "Removing..."
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
                              onChange={(event) => {
                                const value = event.target.value;
                                setSelectedRemovedCategory(value);
                                if (value) setNewCategoryName("");
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
                                ? "Or type a new category..."
                                : "Category name..."
                            }
                            value={newCategoryName}
                            onChange={(event) => {
                              const value = event.target.value;
                              setNewCategoryName(value);
                              if (value.trim()) setSelectedRemovedCategory("");
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
                              ? "..."
                              : selectedRemovedCategory
                                ? "Restore"
                                : "Add"}
                          </button>
                          <button
                            type="button"
                            className="add-category-cancel"
                            onClick={() => {
                              setShowAddInput(false);
                              setNewCategoryName("");
                              setSelectedRemovedCategory("");
                              setAddError(null);
                              setRemoveError(null);
                            }}
                          >
                            X
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
                        >
                          +
                        </button>
                      )}

                      <button
                        type="button"
                        className={`archetype-button highlight-remove-toggle ${
                          highlightRemoveMode ? "active remove-mode" : ""
                        }`}
                        onClick={() => setHighlightRemoveMode((previous) => !previous)}
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
            </div>
          )}

          {activeToolTab === "associations" && (
            <div className="cards-tools-drawer open">
              <div className="bottom-tools-content">
                <div className="bottom-panel-buttons associations-controls">
                  <button
                    type="button"
                    className={`archetype-button ${
                      state.ui.associationMode === "balanced" ? "active" : ""
                    }`}
                    onClick={() =>
                      dispatch({
                        type: "SET_ASSOCIATION_MODE",
                        mode: "balanced",
                      })
                    }
                  >
                    Balanced
                  </button>
                  <button
                    type="button"
                    className={`archetype-button ${
                      state.ui.associationMode === "meta" ? "active" : ""
                    }`}
                    onClick={() =>
                      dispatch({
                        type: "SET_ASSOCIATION_MODE",
                        mode: "meta",
                      })
                    }
                  >
                    Meta
                  </button>
                  <button
                    type="button"
                    className={`archetype-button ${
                      state.ui.associationSourceZone === "main" ? "active" : ""
                    }`}
                    onClick={() =>
                      dispatch({
                        type: "SET_ASSOCIATION_SOURCE_ZONE",
                        sourceZone: "main",
                      })
                    }
                  >
                    Main
                  </button>
                  <button
                    type="button"
                    className={`archetype-button ${
                      state.ui.associationSourceZone === "collection" ? "active" : ""
                    }`}
                    onClick={() =>
                      dispatch({
                        type: "SET_ASSOCIATION_SOURCE_ZONE",
                        sourceZone: "collection",
                      })
                    }
                    disabled={!canUseCollectionSource}
                    title={
                      canUseCollectionSource
                        ? undefined
                        : "No collection evidence for the selected card"
                    }
                  >
                    Collection
                  </button>
                  <button
                    type="button"
                    className="archetype-button"
                    onClick={() => {
                      dispatch({ type: "SET_ASSOCIATIONS_ENABLED", enabled: false });
                      setActiveToolTab(null);
                    }}
                  >
                    Off
                  </button>
                </div>
                <p className="bottom-tools-note associations-note">
                  {selectedAssociationCardName
                    ? `Selected: ${selectedAssociationCardName}`
                    : "Select one card to show associations."}
                </p>
                {(associationClusterGroups.length > 0 || associationPackages.length > 0) && (
                  <div className="association-cluster-picker">
                    <div className="bottom-panel-buttons association-subtab-controls">
                      <button
                        type="button"
                        className={`archetype-button ${
                          state.ui.associationPanelView === "clusters" ? "active" : ""
                        }`}
                        onClick={() =>
                          dispatch({
                            type: "SET_ASSOCIATION_PANEL_VIEW",
                            panelView: "clusters",
                          })
                        }
                      >
                        Clusters ({associationClusterGroups.length})
                      </button>
                      <button
                        type="button"
                        className={`archetype-button ${
                          state.ui.associationPanelView === "packages" ? "active" : ""
                        }`}
                        onClick={() =>
                          dispatch({
                            type: "SET_ASSOCIATION_PANEL_VIEW",
                            panelView: "packages",
                          })
                        }
                      >
                        Packages ({associationPackages.length})
                      </button>
                    </div>

                    {state.ui.associationPanelView === "clusters" && (
                      <>
                        <div className="bottom-panel-buttons associations-avatar-controls">
                          {associationClusterGroups.map((group) => {
                            const isActiveGroup =
                              effectiveAssociationClusterGroup?.id === group.id;
                            return (
                              <button
                                key={group.id}
                                type="button"
                                className={`archetype-button ${
                                  isActiveGroup ? "active" : ""
                                }`}
                                onClick={() =>
                                  dispatch({
                                    type: "SET_ASSOCIATION_CLUSTER_GROUP",
                                    groupId:
                                      state.ui.associationClusterGroupId === group.id
                                        ? null
                                        : group.id,
                                  })
                                }
                                title={`${group.clusters.length} cluster${
                                  group.clusters.length === 1 ? "" : "s"
                                }`}
                              >
                                {group.label}
                              </button>
                            );
                          })}
                        </div>
                        {effectiveAssociationClusterGroup && (
                          <div className="bottom-panel-buttons associations-cluster-controls">
                            <button
                              type="button"
                              className={`archetype-button ${
                                state.ui.associationClusterId === null ? "active" : ""
                              }`}
                              onClick={() =>
                                dispatch({
                                  type: "SET_ASSOCIATION_CLUSTER_GROUP",
                                  groupId: effectiveAssociationClusterGroup.id,
                                })
                              }
                              title={`${effectiveAssociationClusterGroup.label}\nAll ${
                                effectiveAssociationClusterGroup.clusters.length
                              } cluster${
                                effectiveAssociationClusterGroup.clusters.length === 1
                                  ? ""
                                  : "s"
                              }`}
                            >
                              All ({effectiveAssociationClusterGroup.clusters.length})
                            </button>
                            {effectiveAssociationClusterGroup.clusters.map((cluster) => {
                              const deckNames = cluster.deckIds
                                .map((deckId) => associations?.__meta.deckNames[deckId] ?? deckId)
                                .slice(0, 8);
                              const title =
                                deckNames.length > 0
                                  ? `${cluster.label}\n${deckNames.join("\n")}`
                                  : cluster.label;
                              return (
                                <button
                                  key={cluster.id}
                                  type="button"
                                  className={`archetype-button ${
                                    state.ui.associationClusterId === cluster.id ? "active" : ""
                                  }`}
                                  onClick={() =>
                                    dispatch({
                                      type: "SET_ASSOCIATION_CLUSTER",
                                      clusterId:
                                        state.ui.associationClusterId === cluster.id
                                          ? null
                                          : cluster.id,
                                    })
                                  }
                                  title={title}
                                >
                                  {cluster.label} ({cluster.size})
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}

                    {state.ui.associationPanelView === "packages" && (
                      <div className="bottom-panel-buttons associations-package-controls">
                        {associationPackages.map((pkg) => {
                          const topNodes = pkg.topNodes
                            .slice(0, 8)
                            .map((node) => `${Math.round(node.weight * 100)} ${node.displayName}`);
                          const exampleDecks = pkg.exampleDecks
                            .slice(0, 5)
                            .map((deck) => deck.deckName);
                          const title = [
                            pkg.label,
                            `${pkg.supportDeckCount} decks, ${pkg.weightedSupport.toFixed(1)} weighted support`,
                            ...topNodes,
                            ...(exampleDecks.length > 0
                              ? ["", "Example decks", ...exampleDecks]
                              : []),
                          ].join("\n");
                          return (
                            <button
                              key={pkg.id}
                              type="button"
                              className={`archetype-button ${
                                state.ui.associationPackageId === pkg.id ? "active" : ""
                              }`}
                              onClick={() =>
                                dispatch({
                                  type: "SET_ASSOCIATION_PACKAGE",
                                  packageId:
                                    state.ui.associationPackageId === pkg.id ? null : pkg.id,
                                })
                              }
                              title={title}
                            >
                              {pkg.label} ({pkg.supportDeckCount})
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeActionPanel === "label" && (
            <div className="cards-action-drawer open">
              <div className="bottom-action-content">
                <button
                  type="button"
                  className={`archetype-button ${
                    state.ui.labelPlacementMode ? "active" : ""
                  }`}
                  onClick={handleToggleLabelMode}
                >
                  {state.ui.labelPlacementMode ? "Stop Label Placement" : "Start Label Placement"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bottom-folder-tabs">
          <button
            type="button"
            className={`bottom-folder-tab filter-root-tab ${
              activeToolTab === "filter" ? "active" : ""
            }`}
            onClick={openFilterTab}
          >
            Filter
          </button>
          <button
            type="button"
            className={`bottom-folder-tab highlight-root-tab ${
              activeToolTab === "highlight" ? "active" : ""
            }`}
            onClick={openHighlightTab}
          >
            Highlight
          </button>
          <button
            type="button"
            className={`bottom-folder-tab associations-root-tab ${
              activeToolTab === "associations" || state.ui.associationsEnabled
                ? "active"
                : ""
            }`}
            onClick={openAssociationsTab}
          >
            Associations
          </button>
          <button
            type="button"
            className={`bottom-folder-tab label-root-tab ${
              activeActionPanel === "label" || state.ui.labelPlacementMode
                ? "active"
                : ""
            }`}
            onClick={openLabelPanel}
          >
            Labels
          </button>
        </div>
      </div>
    </>
  );
}
