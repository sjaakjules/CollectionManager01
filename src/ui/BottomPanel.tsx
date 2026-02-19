/**
 * Bottom panel for archetype highlighting
 *
 * Displays archetype category buttons that, when selected,
 * highlight cards in the collection/deck matching that archetype.
 * Clicking an already-selected archetype deselects it.
 */

import { useEffect, useState } from 'react';
import { useAppState } from '@/app/AppState';
import {
  loadArchetypeScores,
  getArchetypeNames,
  formatArchetypeName,
  type ArchetypeScores,
} from '@/data/archetypeScores';

export function BottomPanel() {
  const { state, dispatch } = useAppState();
  const [archetypes, setArchetypes] = useState<string[]>([]);
  const [scores, setScores] = useState<ArchetypeScores | null>(null);

  useEffect(() => {
    loadArchetypeScores().then((data) => {
      setScores(data);
      setArchetypes(getArchetypeNames(data));
    });
  }, []);

  const selectedArchetype = state.ui.selectedArchetype;

  const handleClick = (archetype: string) => {
    dispatch({ type: 'SET_SELECTED_ARCHETYPE', archetype });
  };

  if (!scores || archetypes.length === 0) return null;

  return (
    <div className="bottom-panel">
      <div className="bottom-panel-buttons">
        {archetypes.map((archetype) => (
          <button
            key={archetype}
            className={`archetype-button ${selectedArchetype === archetype ? 'active' : ''}`}
            onClick={() => handleClick(archetype)}
          >
            {formatArchetypeName(archetype)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Export getter for archetype scores for use by PixiCanvas
 */
export { loadArchetypeScores } from '@/data/archetypeScores';
