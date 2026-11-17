import type { TextStyleOptions } from 'pixi.js';
import type { CanvasLabel } from '@/data/dataModels';
import type { DeckRegionId } from '@/canvas/canvasAreas';
import { MANGA_PALETTE } from './mangaStyle';

export const CANVAS_LABEL_FONT_SIZE = 14;

/** The same hierarchy is used by resting titles and region drag previews. */
export function getDeckHeadingStyle(region: DeckRegionId): TextStyleOptions {
  const section = region === 'spellbook' || region === 'atlas';
  return {
    fontFamily: 'Arial', fontSize: section ? 17 : 20,
    fontWeight: section ? '600' : '800', fill: MANGA_PALETTE.paper,
  };
}

export function getLabelHeadingStyle(label: CanvasLabel, labels: CanvasLabel[]): TextStyleOptions {
  const visited = new Set([label.id]);
  let current = label;
  let depth = 0;
  while (current.parentLabelId && !visited.has(current.parentLabelId)) {
    const parent = labels.find(entry => entry.id === current.parentLabelId && entry.areaId === label.areaId);
    if (!parent) break;
    visited.add(parent.id);
    depth++;
    current = parent;
  }
  return {
    fontFamily: 'Arial', fontSize: Math.max(10, CANVAS_LABEL_FONT_SIZE - depth * 2), fontWeight: '400',
    fill: depth ? MANGA_PALETTE.muted : MANGA_PALETTE.paper,
    stroke: { color: MANGA_PALETTE.ink, width: 2 },
  };
}
