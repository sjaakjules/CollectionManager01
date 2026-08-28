/**
 * Bottom card tools for filters, card categories, deck styles, and canvas labels.
 */

import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type MouseEvent,
} from "react";
import { useAppState } from "@/app/AppState";
import {
  addCustomCategory,
  getHiddenBaseCardCategories,
  getVisibleCardCategories,
  loadCardCategorySeed,
  normalizeCardCategoryData,
  removeCategory,
  restoreBaseCategory,
  updateCategoryDefinition,
  type CardCategoryData,
  type CardCategoryDefinition,
} from "@/data/cardCategories";
import {
  getCompetitiveDeckLookupDecks,
  getCompetitiveDeckLookupFacets,
  getDeckStyleAvatarLookupGroups,
  getDeckStyleProfilesForDeck,
  getFavouriteDeckStyleLookupDecks,
  getDeckStyleLookupDecks,
  loadDeckStyleAssociations,
  type DeckStyleAssociationData,
  type DeckStyleLookupDeck,
  type CompetitiveDeckResultTag,
} from "@/data/deckStyleAssociations";
import type { Deck } from "@/data/dataModels";
import { applyCardFilters, ensureCardFilterState } from "@/data/cardFilters";
import { buildCardFilterOptions } from "@/data/cardService";
import { CardFilterChipTabs } from "@/ui/CardFilterChipTabs";
import { CardFilterDrawer } from "@/ui/CardFilterDrawer";
import { countFilterClauseMatches } from "@/ui/filterDetails";
import { describeFilterClause } from "@/ui/cardFilterUi";
import { useCardFilterEditor } from "@/ui/useCardFilterEditor";
import { getAvatarShortName } from "@/ui/deckDisplay";
import { ElementIcon } from "@/ui/ElementIcon";

type ToolTab = "filter" | "categories" | "associations" | null;
type ActionPanel = "label" | null;
type FilterPanelMode = "details" | "settings" | null;
type CategoryDialogMode = "add" | "edit" | null;
type DeckLookupTab = "styles" | "avatars" | "competitive" | "favourites";

const BOTTOM_EDGE_TRIGGER_PX = 92;
const EMPTY_ASSOCIATION_STYLES: DeckStyleAssociationData["styles"] = [];
const EMPTY_FAVOURITE_DECK_IDS: string[] = [];

function formatPlacement(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

interface BottomPanelProps {
  isPhone?: boolean;
  phoneExpanded?: boolean;
  onPhoneTabToggle?: () => void;
  onLoadLookupDeck?: (deck: Deck) => void;
  onSaveLookupDeck?: (deck: Deck) => void;
}

export function BottomPanel({
  isPhone = false,
  phoneExpanded = false,
  onPhoneTabToggle,
  onLoadLookupDeck,
  onSaveLookupDeck,
}: BottomPanelProps) {
  const { state, dispatch } = useAppState();
  const [categoryData, setCategoryData] = useState<CardCategoryData | null>(null);
  const [deckStyleData, setDeckStyleData] = useState<DeckStyleAssociationData | null>(null);
  const [activeToolTab, setActiveToolTab] = useState<ToolTab>(null);
  const [pinnedToolTab, setPinnedToolTab] = useState<ToolTab>(null);
  const [activeActionPanel, setActiveActionPanel] = useState<ActionPanel>(null);
  const [deckLookupTab, setDeckLookupTab] = useState<DeckLookupTab>("styles");
  const [selectedLookupAvatar, setSelectedLookupAvatar] = useState<string | null>(null);
  const [selectedAvatarDeckId, setSelectedAvatarDeckId] = useState<string | null>(null);
  const [competitiveSeason, setCompetitiveSeason] = useState<number | null>(2026);
  const [competitiveEvent, setCompetitiveEvent] = useState<string | null>(null);
  const [competitiveLocation, setCompetitiveLocation] = useState<string | null>(null);
  const [competitiveResult, setCompetitiveResult] =
    useState<CompetitiveDeckResultTag | null>(null);
  const [filterPanelMode, setFilterPanelMode] = useState<FilterPanelMode>(null);
  const [filterDetailIndex, setFilterDetailIndex] = useState<number | null>(null);
  const [edgeNear, setEdgeNear] = useState(false);
  const [categoryRemoveMode, setCategoryRemoveMode] = useState(false);
  const filterDetailSwipeStartRef = useRef<number | null>(null);

  const [categoryDialogMode, setCategoryDialogMode] =
    useState<CategoryDialogMode>(null);
  const [editingCategory, setEditingCategory] =
    useState<CardCategoryDefinition | null>(null);
  const [categoryNameInput, setCategoryNameInput] = useState("");
  const [categoryDescriptionInput, setCategoryDescriptionInput] = useState("");
  const [restoreCategoryId, setRestoreCategoryId] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const displayedToolTab = activeToolTab ?? pinnedToolTab;
  const isDeckLookupPinned = pinnedToolTab === "associations";
  const tabsExpanded = isPhone
    ? phoneExpanded
    : edgeNear || displayedToolTab !== null || activeActionPanel !== null;
  const panelOpen = isPhone
    ? phoneExpanded
    : displayedToolTab !== null || activeActionPanel !== null;

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

  useEffect(() => {
    let cancelled = false;

    loadCardCategorySeed()
      .then((seed) => {
        if (cancelled) return;
        const normalized = normalizeCardCategoryData(state.userData?.cardCategories, seed);
        setCategoryData(normalized);
        const shouldPersist =
          !!state.userData &&
          (!state.userData.cardCategories ||
            JSON.stringify(state.userData.cardCategories) !== JSON.stringify(normalized));
        if (shouldPersist) {
          dispatch({ type: "SET_CARD_CATEGORIES", data: normalized });
        }
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.warn("Failed to load card category data:", loadError);
        setCategoryData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch, state.userData, state.userData?.cardCategories]);

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

  const selectedCategory = state.ui.selectedCardCategory;
  const visibleCategories = useMemo(
    () => getVisibleCardCategories(categoryData),
    [categoryData],
  );
  const hiddenBaseCategories = useMemo(
    () => getHiddenBaseCardCategories(categoryData),
    [categoryData],
  );
  const associationStyles = deckStyleData?.styles ?? EMPTY_ASSOCIATION_STYLES;
  const selectedAssociationStyle = useMemo(
    () =>
      associationStyles.find((style) => style.id === state.ui.associationStyleId) ??
      null,
    [associationStyles, state.ui.associationStyleId],
  );
  const lookupDecks = useMemo(
    () =>
      getDeckStyleLookupDecks(
        deckStyleData,
        state.ui.associationMode,
        state.ui.associationStyleId,
        state.ui.associationSubStyleId,
      ),
    [
      deckStyleData,
      state.ui.associationMode,
      state.ui.associationStyleId,
      state.ui.associationSubStyleId,
    ],
  );
  const favouriteDeckIds = state.userData?.favouriteDeckIds ?? EMPTY_FAVOURITE_DECK_IDS;
  const favouriteDeckIdSet = useMemo(
    () => new Set(favouriteDeckIds),
    [favouriteDeckIds],
  );
  const avatarLookupGroups = useMemo(
    () => getDeckStyleAvatarLookupGroups(deckStyleData),
    [deckStyleData],
  );
  const selectedAvatarGroup =
    avatarLookupGroups.find((group) => group.avatar === selectedLookupAvatar) ??
    avatarLookupGroups[0] ??
    null;
  const favouriteLookupDecks = useMemo(
    () => getFavouriteDeckStyleLookupDecks(deckStyleData, favouriteDeckIds),
    [deckStyleData, favouriteDeckIds],
  );
  const competitiveFacets = useMemo(
    () => getCompetitiveDeckLookupFacets(deckStyleData),
    [deckStyleData],
  );
  const competitiveLookupDecks = useMemo(
    () => getCompetitiveDeckLookupDecks(deckStyleData, {
      season: competitiveSeason,
      event: competitiveEvent,
      location: competitiveLocation,
      result: competitiveResult,
    }),
    [
      competitiveEvent,
      competitiveLocation,
      competitiveResult,
      competitiveSeason,
      deckStyleData,
    ],
  );
  const selectedAvatarDeck =
    selectedAvatarGroup?.decks.find((entry) => entry.source.id === selectedAvatarDeckId) ??
    null;
  const selectedAvatarDeckStyles = useMemo(
    () => getDeckStyleProfilesForDeck(deckStyleData, selectedAvatarDeck?.source.id ?? null),
    [deckStyleData, selectedAvatarDeck?.source.id],
  );

  useEffect(() => {
    let cancelled = false;
    loadDeckStyleAssociations()
      .then((data) => {
        if (!cancelled) setDeckStyleData(data);
      })
      .catch((loadError) => {
        if (!cancelled) {
          console.warn("Failed to load deck style associations:", loadError);
          setDeckStyleData(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.ui.associationStyleId) return;
    if (selectedAssociationStyle) return;
    dispatch({ type: "SET_ASSOCIATION_STYLE", styleId: null });
  }, [dispatch, selectedAssociationStyle, state.ui.associationStyleId]);

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
      if (phoneExpanded && displayedToolTab === "filter") {
        setActiveToolTab(null);
        setActiveActionPanel(null);
        setFilterPanelMode(null);
        setFilterDetailIndex(null);
        onPhoneTabToggle?.();
        return;
      }

      setActiveToolTab("filter");
      setActiveActionPanel(null);
      setCategoryRemoveMode(false);
      setFilterDetailIndex(null);
      setFilterPanelMode("settings");
      if (!phoneExpanded) onPhoneTabToggle?.();
      return;
    }
    setActiveActionPanel(null);
    setCategoryRemoveMode(false);
    setActiveToolTab((previous) => {
      const next = previous === "filter" ? null : "filter";
      if (next === null) {
        setFilterPanelMode(null);
        setFilterDetailIndex(null);
      }
      return next;
    });
  }, [dispatch, displayedToolTab, isPhone, onPhoneTabToggle, phoneExpanded]);

  const openCategoriesTab = useCallback(() => {
    dispatch({ type: "SET_ASSOCIATIONS_ENABLED", enabled: false });
    setActiveActionPanel(null);
    setFilterPanelMode(null);
    setFilterDetailIndex(null);
    setCategoryRemoveMode(false);
    setActiveToolTab((previous) => (previous === "categories" ? null : "categories"));
  }, [dispatch]);

  const openAssociationsTab = useCallback(() => {
    setActiveActionPanel(null);
    setFilterPanelMode(null);
    setFilterDetailIndex(null);
    setCategoryRemoveMode(false);
    if (isPhone && phoneExpanded && displayedToolTab === "associations") {
      setActiveToolTab(null);
      onPhoneTabToggle?.();
      return;
    }

    dispatch({ type: "SET_ASSOCIATIONS_ENABLED", enabled: true });
    dispatch({ type: "SET_SELECTED_CARD_CATEGORY", categoryId: null });
    setActiveToolTab("associations");
    if (isPhone && !phoneExpanded) onPhoneTabToggle?.();
  }, [dispatch, displayedToolTab, isPhone, onPhoneTabToggle, phoneExpanded]);

  const handleDeckLookupDoubleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setPinnedToolTab(isDeckLookupPinned ? null : "associations");
      if (!isDeckLookupPinned) {
        openAssociationsTab();
      }
    },
    [isDeckLookupPinned, openAssociationsTab],
  );

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

  const persistCategories = useCallback(
    (next: CardCategoryData) => {
      setCategoryData(next);
      dispatch({ type: "SET_CARD_CATEGORIES", data: next });
    },
    [dispatch],
  );

  const openAddCategoryDialog = useCallback(() => {
    setCategoryDialogMode("add");
    setEditingCategory(null);
    setCategoryNameInput("");
    setCategoryDescriptionInput("");
    setRestoreCategoryId("");
    setCategoryError(null);
  }, []);

  const openEditCategoryDialog = useCallback((category: CardCategoryDefinition) => {
    setCategoryDialogMode("edit");
    setEditingCategory(category);
    setCategoryNameInput(category.name);
    setCategoryDescriptionInput(category.description || category.tooltip);
    setRestoreCategoryId("");
    setCategoryError(null);
  }, []);

  const closeCategoryDialog = useCallback(() => {
    setCategoryDialogMode(null);
    setEditingCategory(null);
    setCategoryNameInput("");
    setCategoryDescriptionInput("");
    setRestoreCategoryId("");
    setCategoryError(null);
  }, []);

  const handleSaveCategoryDialog = useCallback(() => {
    if (!categoryData) return;
    try {
      if (categoryDialogMode === "add") {
        if (restoreCategoryId) {
          const next = restoreBaseCategory(categoryData, restoreCategoryId);
          persistCategories(next);
          dispatch({
            type: "SET_SELECTED_CARD_CATEGORY",
            categoryId: restoreCategoryId,
          });
          closeCategoryDialog();
          return;
        }

        const next = addCustomCategory(
          categoryData,
          categoryNameInput,
          categoryDescriptionInput,
        );
        const added = next.categories[next.categories.length - 1];
        persistCategories(next);
        dispatch({
          type: "SET_SELECTED_CARD_CATEGORY",
          categoryId: added?.id ?? null,
        });
        closeCategoryDialog();
        return;
      }

      if (categoryDialogMode === "edit" && editingCategory) {
        const next = updateCategoryDefinition(categoryData, editingCategory.id, {
          name: categoryNameInput,
          description: categoryDescriptionInput,
        });
        persistCategories(next);
        closeCategoryDialog();
      }
    } catch (error) {
      setCategoryError(
        error instanceof Error ? error.message : "Failed to save category",
      );
    }
  }, [
    categoryData,
    categoryDescriptionInput,
    categoryDialogMode,
    categoryNameInput,
    closeCategoryDialog,
    dispatch,
    editingCategory,
    persistCategories,
    restoreCategoryId,
  ]);

  const handleRemoveCategory = useCallback(
    (categoryId: string) => {
      if (!categoryData) return;
      try {
        const next = removeCategory(categoryData, categoryId);
        persistCategories(next);
        if (state.ui.selectedCardCategory === categoryId) {
          dispatch({ type: "SET_SELECTED_CARD_CATEGORY", categoryId: null });
        }
      } catch (error) {
        setCategoryError(
          error instanceof Error ? error.message : "Failed to remove category",
        );
      }
    },
    [categoryData, dispatch, persistCategories, state.ui.selectedCardCategory],
  );

  const handleToggleFavouriteDeck = useCallback(
    (deckId: string) => {
      dispatch({ type: "TOGGLE_FAVOURITE_DECK", deckId });
    },
    [dispatch],
  );

  const renderLookupDeckList = useCallback(
    (
      decks: DeckStyleLookupDeck[],
      emptyMessage: string,
      options: {
        selectedDeckId?: string | null;
        onSelectDeck?: (deckId: string) => void;
        showCompetitiveMetadata?: boolean;
      } = {},
    ) => {
      if (decks.length === 0) {
        return <p className="bottom-tools-note">{emptyMessage}</p>;
      }

      return (
        <div className="association-deck-list">
          {decks.map(({ deck, source, score }) => {
            const isFavourite = favouriteDeckIdSet.has(source.id);
            const isSelected = options.selectedDeckId === source.id;
            const avatarName = getAvatarShortName(source.avatar ?? deck.name);
            const competitive = source.competitive;
            const bestPlacement = competitive?.placements[0];
            const competitiveBadges = options.showCompetitiveMetadata && competitive
              ? [
                  bestPlacement !== undefined
                    ? formatPlacement(bestPlacement)
                    : competitive.resultTags.includes("winner")
                      ? "Winner"
                      : competitive.topCuts[0] !== undefined
                        ? `Top ${competitive.topCuts[0]}`
                        : competitive.resultTags.includes("undefeated")
                          ? "Undefeated"
                          : competitive.records[0] ?? null,
                  competitive.events[0] ?? null,
                  competitive.locations[0] ?? null,
                ].filter((value): value is string => value !== null)
              : [];
            return (
              <div
                key={source.id}
                role="button"
                tabIndex={0}
                className={`association-deck-chip ${
                  isFavourite ? "favourite" : ""
                } ${isSelected ? "selected" : ""} ${
                  options.showCompetitiveMetadata ? "competitive" : ""
                }`}
                onClick={() => {
                  options.onSelectDeck?.(source.id);
                  onLoadLookupDeck?.(deck);
                }}
                onDoubleClick={() => onSaveLookupDeck?.(deck)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  options.onSelectDeck?.(source.id);
                  onLoadLookupDeck?.(deck);
                }}
                title={source.name}
                aria-label={`Load ${source.name}`}
              >
                <span className="association-deck-avatar">{avatarName}</span>
                <span className="association-deck-elements" aria-label="Deck elements">
                  {source.elements.length === 0 ? (
                    <ElementIcon element="none" decorative />
                  ) : (
                    source.elements.map((element) => (
                      <ElementIcon key={element} element={element} decorative />
                    ))
                  )}
                </span>
                {typeof score === "number" && (
                  <span className="association-deck-score">{score.toFixed(2)}</span>
                )}
                {competitiveBadges.length > 0 && (
                  <span className="association-deck-competitive-meta">
                    {competitiveBadges.map((badge) => (
                      <span key={badge} className="association-deck-competitive-badge">
                        {badge}
                      </span>
                    ))}
                  </span>
                )}
                <button
                  type="button"
                  className={`association-deck-favourite ${
                    isFavourite ? "active" : ""
                  }`}
                  aria-label={
                    isFavourite
                      ? `Remove ${source.name} from favourites`
                      : `Add ${source.name} to favourites`
                  }
                  title={
                    isFavourite
                      ? "Remove from favourites"
                      : "Add to favourites"
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    handleToggleFavouriteDeck(source.id);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  {isFavourite ? "♥" : "♡"}
                </button>
              </div>
            );
          })}
        </div>
      );
    },
    [
      favouriteDeckIdSet,
      handleToggleFavouriteDeck,
      onLoadLookupDeck,
      onSaveLookupDeck,
    ],
  );

  const handleCategoryDialogKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      handleSaveCategoryDialog();
    } else if (event.key === "Escape") {
      closeCategoryDialog();
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
          {displayedToolTab === "filter" && (
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

          {displayedToolTab === "categories" && (
            <div className="cards-tools-drawer open">
              <div className="bottom-tools-content">
                {categoryData && visibleCategories.length > 0 ? (
                  <div className="bottom-panel-buttons">
                    <button
                      type="button"
                      className={`tool-button ${
                        selectedCategory === null ? "active" : ""
                      }`}
                      onClick={() =>
                        dispatch({ type: "SET_SELECTED_CARD_CATEGORY", categoryId: null })
                      }
                      disabled={categoryRemoveMode}
                    >
                      None
                    </button>

                    {visibleCategories.map((category) => (
                      <div key={category.id} className="category-item">
                        <button
                          type="button"
                          className={`tool-button ${
                            categoryRemoveMode
                              ? "remove-mode"
                              : selectedCategory === category.id
                                ? "active"
                                : ""
                          }`}
                          onClick={() => {
                            if (categoryRemoveMode) {
                              handleRemoveCategory(category.id);
                            } else {
                              dispatch({
                                type: "SET_SELECTED_CARD_CATEGORY",
                                categoryId: category.id,
                              });
                            }
                          }}
                          onDoubleClick={() => openEditCategoryDialog(category)}
                          title={
                            categoryRemoveMode
                              ? `Remove ${category.name}`
                              : category.tooltip || category.description
                          }
                        >
                          {category.name}
                        </button>
                      </div>
                    ))}

                    <div className="category-mode-controls">
                      <button
                        type="button"
                        className="tool-button add-category-btn"
                        onClick={openAddCategoryDialog}
                        disabled={categoryRemoveMode}
                      >
                        +
                      </button>

                      <button
                        type="button"
                        className={`tool-button category-remove-toggle ${
                          categoryRemoveMode ? "active remove-mode" : ""
                        }`}
                        onClick={() => setCategoryRemoveMode((previous) => !previous)}
                      >
                        -
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="bottom-tools-note">No card categories available.</p>
                )}

                {categoryError && <p className="bottom-tools-note">{categoryError}</p>}
              </div>
            </div>
          )}

          {displayedToolTab === "associations" && (
            <div className="cards-tools-drawer open">
              <div className="bottom-tools-content">
                <div className="bottom-panel-buttons deck-lookup-tabs">
                  <button
                    type="button"
                    className={`tool-button ${
                      deckLookupTab === "styles" ? "active" : ""
                    }`}
                    onClick={() => setDeckLookupTab("styles")}
                  >
                    Deck Styles
                  </button>
                  <button
                    type="button"
                    className={`tool-button ${
                      deckLookupTab === "avatars" ? "active" : ""
                    }`}
                    onClick={() => setDeckLookupTab("avatars")}
                  >
                    Avatars
                  </button>
                  <button
                    type="button"
                    className={`tool-button ${
                      deckLookupTab === "competitive" ? "active" : ""
                    }`}
                    onClick={() => setDeckLookupTab("competitive")}
                  >
                    Competitive
                  </button>
                  <button
                    type="button"
                    className={`tool-button ${
                      deckLookupTab === "favourites" ? "active" : ""
                    }`}
                    onClick={() => setDeckLookupTab("favourites")}
                  >
                    Favourites
                  </button>
                </div>

                {deckLookupTab === "styles" && (
                  <>
                    <div className="bottom-panel-buttons associations-controls">
                      <button
                        type="button"
                        className={`tool-button ${
                          state.ui.associationMode === "primary" ? "active" : ""
                        }`}
                        onClick={() =>
                          dispatch({
                            type: "SET_ASSOCIATION_MODE",
                            mode: "primary",
                          })
                        }
                      >
                        Primary
                      </button>
                      <button
                        type="button"
                        className={`tool-button ${
                          state.ui.associationMode === "fractional" ? "active" : ""
                        }`}
                        onClick={() =>
                          dispatch({
                            type: "SET_ASSOCIATION_MODE",
                            mode: "fractional",
                          })
                        }
                      >
                        Fractional
                      </button>
                      <button
                        type="button"
                        className="tool-button"
                        onClick={() => {
                          dispatch({ type: "SET_ASSOCIATIONS_ENABLED", enabled: false });
                          setActiveToolTab(null);
                        }}
                      >
                        Off
                      </button>
                    </div>

                    {associationStyles.length > 0 ? (
                      <div className="association-style-picker">
                        <div className="bottom-panel-buttons associations-avatar-controls">
                          {associationStyles.map((style) => (
                            <button
                              key={style.id}
                              type="button"
                              className={`tool-button ${
                                state.ui.associationStyleId === style.id ? "active" : ""
                              }`}
                              onClick={() =>
                                dispatch({
                                  type: "SET_ASSOCIATION_STYLE",
                                  styleId:
                                    state.ui.associationStyleId === style.id
                                      ? null
                                      : style.id,
                                })
                              }
                              title={style.tooltip || style.description}
                            >
                              {style.name}
                            </button>
                          ))}
                        </div>
                        {selectedAssociationStyle && (
                          <div className="bottom-panel-buttons associations-substyle-controls">
                            <button
                              type="button"
                              className={`tool-button ${
                                state.ui.associationSubStyleId === null ? "active" : ""
                              }`}
                              onClick={() =>
                                dispatch({
                                  type: "SET_ASSOCIATION_SUB_STYLE",
                                  subStyleId: null,
                                })
                              }
                            >
                              All
                            </button>
                            {selectedAssociationStyle.subStyles.map((subStyle) => (
                              <button
                                key={subStyle.id}
                                type="button"
                                className={`tool-button ${
                                  state.ui.associationSubStyleId === subStyle.id
                                    ? "active"
                                    : ""
                                }`}
                                onClick={() =>
                                  dispatch({
                                    type: "SET_ASSOCIATION_SUB_STYLE",
                                    subStyleId:
                                      state.ui.associationSubStyleId === subStyle.id
                                        ? null
                                        : subStyle.id,
                                  })
                                }
                                title={subStyle.tooltip || subStyle.description}
                              >
                                {subStyle.name}
                              </button>
                            ))}
                          </div>
                        )}
                        {selectedAssociationStyle && (
                          <div className="association-deck-lookup">
                            <div className="association-deck-lookup-heading">
                              Decks
                              <span>{lookupDecks.length}</span>
                            </div>
                            {renderLookupDeckList(
                              lookupDecks,
                              "No decks for this style.",
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="bottom-tools-note">No deck styles available.</p>
                    )}
                  </>
                )}

                {deckLookupTab === "avatars" && (
                  <>
                    {avatarLookupGroups.length > 0 ? (
                      <div className="association-style-picker">
                        <div className="bottom-panel-buttons associations-avatar-controls deck-lookup-avatar-controls">
                          {avatarLookupGroups.map((group) => (
                            <button
                              key={group.avatar}
                              type="button"
                              className={`tool-button ${
                                selectedAvatarGroup?.avatar === group.avatar ? "active" : ""
                              }`}
                              onClick={() => {
                                setSelectedLookupAvatar(group.avatar);
                                setSelectedAvatarDeckId(null);
                              }}
                              title={`${group.decks.length} deck${
                                group.decks.length === 1 ? "" : "s"
                              }`}
                            >
                              {getAvatarShortName(group.avatar)}
                              <span className="deck-lookup-count">{group.decks.length}</span>
                            </button>
                          ))}
                        </div>
                        {selectedAvatarGroup && (
                          <div className="association-deck-lookup">
                            <div className="association-deck-lookup-heading">
                              {selectedAvatarGroup.avatar}
                              <span>{selectedAvatarGroup.decks.length}</span>
                            </div>
                            {renderLookupDeckList(
                              selectedAvatarGroup.decks,
                              "No decks for this avatar.",
                              {
                                selectedDeckId: selectedAvatarDeckId,
                                onSelectDeck: setSelectedAvatarDeckId,
                              },
                            )}
                            {selectedAvatarDeck && (
                              <div className="association-deck-style-profile">
                                <div className="association-deck-lookup-heading">
                                  Deck Styles
                                  <span>{selectedAvatarDeck.source.name}</span>
                                </div>
                                {selectedAvatarDeckStyles.length > 0 ? (
                                  <div className="association-style-profile-list">
                                    {selectedAvatarDeckStyles.map((style) => (
                                      <div
                                        key={style.id}
                                        className={`association-style-profile-chip ${
                                          style.primary ? "primary" : ""
                                        }`}
                                        title={style.primary ? "Primary deck style" : undefined}
                                      >
                                        <div className="association-style-profile-header">
                                          <span className="association-style-profile-name">
                                            {style.name}
                                          </span>
                                          <span className="association-style-profile-score">
                                            {style.score.toFixed(2)}
                                          </span>
                                          {style.primary && (
                                            <span className="association-style-profile-primary">
                                              Primary
                                            </span>
                                          )}
                                        </div>
                                        {style.subStyles.length > 0 && (
                                          <span className="association-substyle-profile-list">
                                            {style.subStyles.map((subStyle) => (
                                              <span
                                                key={subStyle.id}
                                                className={`association-substyle-profile-chip ${
                                                  subStyle.primary ? "primary" : ""
                                                }`}
                                              >
                                                {subStyle.name}
                                                <span>{subStyle.score.toFixed(2)}</span>
                                              </span>
                                            ))}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="bottom-tools-note">
                                    No deck-style scores for this deck.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="bottom-tools-note">No deck avatars available.</p>
                    )}
                  </>
                )}

                {deckLookupTab === "competitive" && (
                  <div className="association-deck-lookup competitive-deck-lookup">
                    <div className="competitive-deck-filters">
                      <label>
                        <span>Season</span>
                        <select
                          aria-label="Competitive deck season"
                          value={competitiveSeason ?? ""}
                          onChange={(event) => {
                            setCompetitiveSeason(
                              event.target.value ? Number(event.target.value) : null,
                            );
                          }}
                        >
                          <option value="">All</option>
                          {competitiveFacets.seasons.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label} ({option.count})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Event</span>
                        <select
                          aria-label="Competitive deck event"
                          value={competitiveEvent ?? ""}
                          onChange={(event) => setCompetitiveEvent(event.target.value || null)}
                        >
                          <option value="">All</option>
                          {competitiveFacets.events.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label} ({option.count})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Location</span>
                        <select
                          aria-label="Competitive deck location"
                          value={competitiveLocation ?? ""}
                          onChange={(event) => setCompetitiveLocation(event.target.value || null)}
                        >
                          <option value="">All</option>
                          {competitiveFacets.locations.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label} ({option.count})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Result</span>
                        <select
                          aria-label="Competitive deck result"
                          value={competitiveResult ?? ""}
                          onChange={(event) => {
                            setCompetitiveResult(
                              (event.target.value || null) as CompetitiveDeckResultTag | null,
                            );
                          }}
                        >
                          <option value="">All</option>
                          {competitiveFacets.results.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label} ({option.count})
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="association-deck-lookup-heading">
                      Competitive
                      <span>{competitiveLookupDecks.length}</span>
                    </div>
                    {renderLookupDeckList(
                      competitiveLookupDecks,
                      "No competitive decks match these filters.",
                      { showCompetitiveMetadata: true },
                    )}
                  </div>
                )}

                {deckLookupTab === "favourites" && (
                  <div className="association-deck-lookup favourites-deck-lookup">
                    <div className="association-deck-lookup-heading">
                      Favourites
                      <span>{favouriteLookupDecks.length}</span>
                    </div>
                    {renderLookupDeckList(
                      favouriteLookupDecks,
                      "No favourite decks yet.",
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
                  className={`tool-button ${
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
              displayedToolTab === "filter" ? "active" : ""
            }`}
            onClick={openFilterTab}
          >
            Filter
          </button>
          <button
            type="button"
            className={`bottom-folder-tab categories-root-tab ${
              displayedToolTab === "categories" ? "active" : ""
            }`}
            onClick={openCategoriesTab}
          >
            Categories
          </button>
          <button
            type="button"
            className={`bottom-folder-tab associations-root-tab ${
              displayedToolTab === "associations" || state.ui.associationsEnabled
                ? "active"
                : ""
            } ${isDeckLookupPinned ? "pinned" : ""}`}
            onClick={openAssociationsTab}
            onDoubleClick={handleDeckLookupDoubleClick}
            title={
              isDeckLookupPinned
                ? "Deck Lookup pinned open"
                : "Double-click to pin Deck Lookup open"
            }
          >
            Deck Lookup
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
      {categoryDialogMode && (
        <div className="modal-overlay" onClick={closeCategoryDialog}>
          <div
            className="modal category-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-label={categoryDialogMode === "add" ? "Add category" : "Edit category"}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleCategoryDialogKeyDown}
          >
            <div className="modal-header">
              <h2>{categoryDialogMode === "add" ? "Category" : "Edit Category"}</h2>
              <button className="modal-close" onClick={closeCategoryDialog}>
                ×
              </button>
            </div>
            <div className="modal-content">
              {categoryDialogMode === "add" && hiddenBaseCategories.length > 0 && (
                <div className="form-field">
                  <label htmlFor="restore-category">Restore category</label>
                  <select
                    id="restore-category"
                    value={restoreCategoryId}
                    onChange={(event) => {
                      setRestoreCategoryId(event.target.value);
                      setCategoryError(null);
                    }}
                  >
                    <option value="">New category</option>
                    {hiddenBaseCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!restoreCategoryId && (
                <>
                  <div className="form-field">
                    <label htmlFor="category-name">Name</label>
                    <input
                      id="category-name"
                      type="text"
                      value={categoryNameInput}
                      onChange={(event) => {
                        setCategoryNameInput(event.target.value);
                        setCategoryError(null);
                      }}
                      autoFocus
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="category-description">Description</label>
                    <textarea
                      id="category-description"
                      value={categoryDescriptionInput}
                      onChange={(event) => {
                        setCategoryDescriptionInput(event.target.value);
                        setCategoryError(null);
                      }}
                      rows={4}
                    />
                  </div>
                </>
              )}
              {categoryError && <div className="form-error">{categoryError}</div>}
              <div className="modal-actions">
                <button onClick={closeCategoryDialog}>Cancel</button>
                <button
                  className="primary"
                  onClick={handleSaveCategoryDialog}
                  disabled={
                    !restoreCategoryId &&
                    categoryDialogMode === "add" &&
                    categoryNameInput.trim().length === 0
                  }
                >
                  {restoreCategoryId ? "Restore" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
