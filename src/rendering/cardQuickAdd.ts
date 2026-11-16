import type { ActiveBoard } from '@/data/dataModels';

export type QuickAddBoard = Extract<ActiveBoard, 'mainboard' | 'collection' | 'maybeboard'>;
export type QuickAddScope = 'card' | 'selection';

/** Screen coordinates only: React never needs access to the Pixi scene. */
export interface CardQuickAddTarget {
  key: string;
  cardName: string;
  clientX: number;
  clientY: number;
  visible: boolean;
}

export interface CardQuickAddDeck {
  deckId: string;
  canvasAreaId: string;
  name: string;
}
