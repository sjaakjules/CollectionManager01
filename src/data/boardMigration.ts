import type { ActiveBoard, DeckBoards, UserData } from './dataModels';

/** Legacy names are accepted only when reading saved or imported data. */
export function normalizeSavedBoard(value: unknown): ActiveBoard | null {
  if (value === 'sideboard') return 'collection';
  return value === 'mainboard' || value === 'collection' || value === 'avatar' || value === 'maybeboard'
    ? value : null;
}

export function normalizeDeckBoards(value: unknown): DeckBoards {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const collection = Array.isArray(raw.collection) ? raw.collection : raw.sideboard;
  if (!('sideboard' in raw) && ['mainboard', 'collection', 'avatar', 'maybeboard'].every((key) => Array.isArray(raw[key]))) {
    return value as DeckBoards;
  }
  return {
    mainboard: Array.isArray(raw.mainboard) ? raw.mainboard : [],
    collection: Array.isArray(collection) ? collection : [],
    avatar: Array.isArray(raw.avatar) ? raw.avatar : [],
    maybeboard: Array.isArray(raw.maybeboard) ? raw.maybeboard : [],
  };
}

/** One migration for both guest and account JSON, with no mutation of old snapshots. */
export function normalizeUserDataBoards(data: UserData): UserData {
  return {
    ...data,
    decks: data.decks.map((deck) => ({ ...deck, boards: normalizeDeckBoards(deck.boards) })),
    ...(data.canvasAreas ? {
      // Migration runs before the canvas sanitizer. Older/incomplete snapshots
      // can omit cards or contain invalid entries; do not prevent hydration.
      canvasAreas: (Array.isArray(data.canvasAreas) ? data.canvasAreas : [])
        .filter((area) => area && typeof area === 'object')
        .map((area) => ({
          ...area,
          cards: (Array.isArray(area.cards) ? area.cards : [])
            .filter((card) => card && typeof card === 'object')
            .map((card) => ({ ...card, board: normalizeSavedBoard(card.board) })),
        })),
    } : {}),
    ...(data.canvasLabels ? {
      canvasLabels: (Array.isArray(data.canvasLabels) ? data.canvasLabels : [])
        .filter((label) => label && typeof label === 'object')
        .map((label) => ({
          ...label,
          ...(label.board ? { board: normalizeSavedBoard(label.board) ?? undefined } : {}),
        })),
    } : {}),
  };
}
