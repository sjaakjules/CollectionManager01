import type { ActiveBoard } from '@/data/dataModels';

export type QuickAddBoard = Extract<ActiveBoard, 'mainboard' | 'collection' | 'maybeboard'>;
export type QuickAddScope = 'card' | 'selection';

export type CatalogueStackDestination = { stackId: string } | { name: string };

export interface CardScreenBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Screen coordinates only: React never needs access to the Pixi scene. */
export interface CardQuickAddTarget {
  key: string;
  cardName: string;
  clientX: number;
  clientY: number;
  visible: boolean;
  /** Omitted while canvas gestures hide the selection controls. */
  bounds?: CardScreenBounds;
  canLayout?: boolean;
  canQuickSort?: boolean;
  canCleanUp?: boolean;
}

/** Client coordinates for the top center of an eligible label's displayed heading. */
export interface LabelCleanUpTarget {
  id: string;
  clientX: number;
  clientY: number;
  visible: boolean;
}

export interface CardQuickAddDeck {
  deckId: string;
  canvasAreaId: string;
  name: string;
}
