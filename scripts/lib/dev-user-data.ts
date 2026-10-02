import { ensureInteractionEffects } from '../../src/data/interactionEffects';
import { normalizeDeckRemovals } from '../../src/data/deckRemovals';
import { normalizeDeckBoards, normalizeSavedBoard } from '../../src/data/boardMigration';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean)
    )
  );
}

/** The local account emulator preserves the same board and canvas schema as PHP. */
export function sanitizeDevUserData(
  payload: Record<string, unknown>,
  userId: string,
  username: string
): Record<string, unknown> {
  const decks = Array.isArray(payload.decks) ? payload.decks.map((deck) => {
    if (!isRecord(deck)) return deck;
    return { ...deck, boards: normalizeDeckBoards(deck.boards) };
  }) : [];
  const collection = Array.isArray(payload.collection) ? payload.collection : [];
  const selectedCardCategory =
    typeof payload.selectedCardCategory === 'string' || payload.selectedCardCategory === null
      ? payload.selectedCardCategory
      : null;
  const cardCategories =
    payload.cardCategories && typeof payload.cardCategories === 'object'
      ? payload.cardCategories
      : undefined;
  const canvasLabels = Array.isArray(payload.canvasLabels)
    ? payload.canvasLabels.filter((obj): obj is Record<string, unknown> => {
        if (!isRecord(obj)) return false;
        return (
          typeof obj.id === 'string' &&
          typeof obj.text === 'string' &&
          typeof obj.x === 'number' &&
          Number.isFinite(obj.x) &&
          typeof obj.y === 'number' &&
          Number.isFinite(obj.y)
        );
      })
    : [];
  const canvasAreas = Array.isArray(payload.canvasAreas)
    ? payload.canvasAreas.filter((obj): obj is Record<string, unknown> => {
        if (!isRecord(obj)) return false;
        return (
          typeof obj.id === 'string' &&
          typeof obj.name === 'string' &&
          (obj.type === 'stack' || obj.type === 'deck')
        );
      })
    : [];

  return {
    name: username,
    id: userId,
    decks,
    collection,
    selectedCardCategory,
    cardCategories,
    favouriteDeckIds: sanitizeStringList(payload.favouriteDeckIds),
    removedDecks: normalizeDeckRemovals(payload.removedDecks),
    canvasLabels: canvasLabels.map((label) => ({ ...label,
      ...(label.board ? { board: normalizeSavedBoard(label.board) ?? undefined } : {}),
    })),
    canvasAreas: canvasAreas.map((area) => ({ ...area,
      ...(Array.isArray(area.cards) ? { cards: area.cards.map((card: unknown) => !isRecord(card) ? card : ({
        ...card, ...(Object.hasOwn(card, 'board') ? { board: normalizeSavedBoard(card.board) } : {}),
      })) } : {}),
    })),
    ...(isRecord(payload.interactionEffects) ? { interactionEffects: ensureInteractionEffects(payload.interactionEffects) } : {}),
    ...(payload.catalogueLayout && typeof payload.catalogueLayout === 'object' && !Array.isArray(payload.catalogueLayout)
      ? { catalogueLayout: payload.catalogueLayout } : {}),
  };
}
