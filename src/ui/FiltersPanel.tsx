/**
 * Filtering panel for card search and highlighting
 *
 * NOTE: Filtering is explicitly excluded from MVP (see PDR section 10).
 * This file provides the structure for post-MVP implementation.
 */

import { useState, useCallback } from 'react';

// Placeholder types - to be expanded post-MVP
interface FilterState {
  searchText: string;
  types: string[];
  elements: string[];
  rarities: string[];
  costRange: [number, number];
}

const defaultFilters: FilterState = {
  searchText: '',
  types: [],
  elements: [],
  rarities: [],
  costRange: [0, 20],
};

export function FiltersPanel() {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [isOpen, setIsOpen] = useState(false);

  const handleSearchChange = useCallback((value: string) => {
    setFilters((prev) => ({ ...prev, searchText: value }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters(defaultFilters);
  }, []);

  // Filtering is excluded from MVP - render minimal UI
  return (
    <div className={`filters-panel ${isOpen ? 'open' : 'collapsed'}`}>
      <button
        className="filters-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title="Filters (coming soon)"
      >
        Filter
      </button>

      {isOpen && (
        <div className="filters-content">
          <div className="filters-header">
            <h3>Filters</h3>
            <button onClick={handleClearFilters}>Clear</button>
          </div>

          <div className="filter-group">
            <label>Search</label>
            <input
              type="text"
              placeholder="Card name..."
              value={filters.searchText}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>

          <p className="filters-note">
            Additional filters coming in a future update.
          </p>
        </div>
      )}
    </div>
  );
}
