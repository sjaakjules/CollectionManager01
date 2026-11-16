import type { ActiveBoard, DeckBoards, DeckCard, UserData } from './dataModels';
import { canonicalCardName, canonicalDeckId } from './catalogueMigrations';

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
  const migrateCards = (cards: DeckCard[]): DeckCard[] => {
    const counts = new Map<string, number>();
    for (const card of cards) {
      const name = canonicalCardName(card.name);
      counts.set(name, (counts.get(name) ?? 0) + card.quantity);
    }
    return [...counts].map(([name, quantity]) => ({ name, quantity }));
  };
  const decks = new Map<string, UserData['decks'][number]>();
  for (const deck of data.decks) {
    const id = canonicalDeckId(deck.id);
    const boards = normalizeDeckBoards(deck.boards);
    const previous = decks.get(id);
    if (previous && Date.parse(previous.updatedAt) > Date.parse(deck.updatedAt)) continue;
    decks.set(id, { ...deck, id, boards: {
      mainboard: migrateCards(boards.mainboard), collection: migrateCards(boards.collection),
      avatar: migrateCards(boards.avatar), maybeboard: migrateCards(boards.maybeboard),
    } });
  }
  const removedDecks: Record<string, string> = {};
  for (const [oldId, removedAt] of Object.entries(data.removedDecks ?? {})) {
    const id = canonicalDeckId(oldId);
    if (!removedDecks[id] || removedAt > removedDecks[id]) removedDecks[id] = removedAt;
  }
  return {
    ...data,
    decks: [...decks.values()],
    collection: migrateCards(data.collection),
    ...(data.removedDecks ? { removedDecks } : {}),
    ...(data.favouriteDeckIds ? { favouriteDeckIds: [...new Set(data.favouriteDeckIds.map(canonicalDeckId))] } : {}),
    ...(data.canvasAreas ? {
      // Migration runs before the canvas sanitizer. Older/incomplete snapshots
      // can omit cards or contain invalid entries; do not prevent hydration.
      canvasAreas: (Array.isArray(data.canvasAreas) ? data.canvasAreas : [])
        .filter((area) => area && typeof area === 'object')
        .map((area) => ({
          ...area,
          ...(area.deckId ? { deckId: canonicalDeckId(area.deckId) } : {}),
          cards: (Array.isArray(area.cards) ? area.cards : [])
            .filter((card) => card && typeof card === 'object')
            .map((card) => ({ ...card, cardName: canonicalCardName(card.cardName), board: normalizeSavedBoard(card.board) })),
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
