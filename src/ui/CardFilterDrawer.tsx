import type { CardFilterCriteria } from '@/data/cardFilters';
import type { CardFilterOptions } from '@/data/cardService';
import {
  describeFilterButton,
  includesToken,
  type MultiCriteriaField,
} from '@/ui/cardFilterUi';

interface CardFilterDrawerProps {
  isOpen: boolean;
  currentFilterCriteria: CardFilterCriteria;
  editingExistingFilter: boolean;
  editingFilterIndex: number | null;
  editingFilterEnabled: boolean;
  filteredCardCount: number;
  totalCardCount: number;
  activeFilterCount: number;
  clauseCount: number;
  availableOptions: CardFilterOptions;
  onUpdateCurrentFilter: (patch: Partial<CardFilterCriteria>) => void;
  onToggleCurrentFilterToken: (field: MultiCriteriaField, value: string) => void;
  onToggleEditingFilterEnabled: (index: number) => void;
  onDeleteEditingFilter: (index: number) => void;
}

function parseNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

export function CardFilterDrawer({
  isOpen,
  currentFilterCriteria,
  editingExistingFilter,
  editingFilterIndex,
  editingFilterEnabled,
  filteredCardCount,
  totalCardCount,
  activeFilterCount,
  clauseCount,
  availableOptions,
  onUpdateCurrentFilter,
  onToggleCurrentFilterToken,
  onToggleEditingFilterEnabled,
  onDeleteEditingFilter,
}: CardFilterDrawerProps) {
  if (!isOpen) return null;

  return (
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
            onClick={() => onToggleEditingFilterEnabled(editingFilterIndex)}
          >
            {editingFilterEnabled ? 'Hide' : 'Activate'}
          </button>
        )}
        {editingExistingFilter && editingFilterIndex !== null && (
          <button
            type="button"
            className="archetype-button filter-delete-button"
            onClick={() => onDeleteEditingFilter(editingFilterIndex)}
          >
            Delete
          </button>
        )}
        <span className="filter-summary">
          {filteredCardCount} / {totalCardCount} cards • {activeFilterCount} active of{' '}
          {clauseCount}
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
            onChange={(e) => onUpdateCurrentFilter({ searchText: e.target.value })}
            placeholder="Search all card JSON data"
          />
        </label>

        <div className="filter-field">
          <span>Set</span>
          <div className="filter-button-row">
            {availableOptions.sets.map((setName) => (
              <button
                key={setName}
                type="button"
                className={`archetype-button ${
                  includesToken(currentFilterCriteria.sets, setName) ? 'active' : ''
                }`}
                onClick={() => onToggleCurrentFilterToken('sets', setName)}
              >
                {setName}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-field">
          <span>Type</span>
          <div className="filter-button-row">
            {availableOptions.types.map((typeName) => (
              <button
                key={typeName}
                type="button"
                className={`archetype-button ${
                  includesToken(currentFilterCriteria.types, typeName) ? 'active' : ''
                }`}
                onClick={() => onToggleCurrentFilterToken('types', typeName)}
              >
                {typeName}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-field">
          <span>Rarity</span>
          <div className="filter-button-row">
            {availableOptions.rarities.map((rarity) => (
              <button
                key={rarity}
                type="button"
                className={`archetype-button ${
                  includesToken(currentFilterCriteria.rarities, rarity) ? 'active' : ''
                }`}
                onClick={() => onToggleCurrentFilterToken('rarities', rarity)}
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
            onChange={(e) => onUpdateCurrentFilter({ subType: e.target.value })}
          >
            <option value="">Any sub-type</option>
            {availableOptions.subTypes.map((subType) => (
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
            onChange={(e) => onUpdateCurrentFilter({ artist: e.target.value })}
          >
            <option value="">Any artist</option>
            {availableOptions.artists.map((artist) => (
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
                onClick={() => onToggleCurrentFilterToken('thresholds', threshold)}
              >
                {threshold}
              </button>
            ))}
            <select
              value={currentFilterCriteria.thresholdMode}
              onChange={(e) =>
                onUpdateCurrentFilter({
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
                onUpdateCurrentFilter({ costMin: parseNumberOrNull(e.target.value) })
              }
              placeholder="Min"
            />
            <input
              type="number"
              value={currentFilterCriteria.costMax ?? ''}
              onChange={(e) =>
                onUpdateCurrentFilter({ costMax: parseNumberOrNull(e.target.value) })
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
                onUpdateCurrentFilter({ attackMin: parseNumberOrNull(e.target.value) })
              }
              placeholder="Min"
            />
            <input
              type="number"
              value={currentFilterCriteria.attackMax ?? ''}
              onChange={(e) =>
                onUpdateCurrentFilter({ attackMax: parseNumberOrNull(e.target.value) })
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
                onUpdateCurrentFilter({ defenceMin: parseNumberOrNull(e.target.value) })
              }
              placeholder="Min"
            />
            <input
              type="number"
              value={currentFilterCriteria.defenceMax ?? ''}
              onChange={(e) =>
                onUpdateCurrentFilter({ defenceMax: parseNumberOrNull(e.target.value) })
              }
              placeholder="Max"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
