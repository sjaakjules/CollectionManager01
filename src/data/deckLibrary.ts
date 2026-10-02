import type { CanvasArea } from '@/canvas/canvasAreas';
import type { Deck, DeckBoards, DeckCard } from './dataModels';

export interface DeckLibraryEntry {
  id: string;
  deck: Deck;
  area: CanvasArea | null;
}

/** The canvas is authoritative for the current variant and manually moved cards. */
export function deckWithCanvasCards(deck: Deck, area: CanvasArea | null): Deck {
  if (!area) return deck;
  const variant = area.deckVariants?.find((entry) => entry.id === area.activeDeckVariantId)
    ?? area.deckVariants?.[0];
  const activeIds = variant ? new Set(variant.activeCardIds) : null;
  const counts: Record<'mainboard' | 'collection' | 'maybeboard', Map<string, number>> = {
    mainboard: new Map(), collection: new Map(), maybeboard: new Map(),
  };
  for (const card of area.cards) {
    const board = card.board === 'collection' || card.board === 'maybeboard' ? card.board : 'mainboard';
    if (board === 'mainboard' && activeIds && !activeIds.has(card.id)) continue;
    counts[board].set(card.cardName, (counts[board].get(card.cardName) ?? 0) + 1);
  }
  const entries = (board: keyof typeof counts): DeckCard[] =>
    [...counts[board]].map(([name, quantity]) => ({ name, quantity }));
  const boards: DeckBoards = {
    avatar: area.avatarCardName === undefined ? deck.boards.avatar
      : area.avatarCardName ? [{ name: area.avatarCardName, quantity: 1 }] : [],
    mainboard: entries('mainboard'), collection: entries('collection'), maybeboard: entries('maybeboard'),
  };
  return { ...deck, boards };
}

/** Both deck panels use this library, including saved lookup and example decks.
 * Older standalone canvas decks remain accessible until explicitly removed. */
export function getDeckLibraryEntries(decks: Deck[], areas: CanvasArea[]): DeckLibraryEntry[] {
  const deckAreas = areas.filter((area) => area.type === 'deck' && !area.lookupDeckId);
  const byDeck = new Map(deckAreas.map((area) => [area.deckId ?? area.id, area]));
  const entries = decks.map((deck) => {
    const area = byDeck.get(deck.id) ?? null;
    return { id: deck.id, deck: deckWithCanvasCards(deck, area), area };
  });
  const ids = new Set(decks.map((deck) => deck.id));
  for (const area of deckAreas) {
    const id = area.deckId ?? area.id;
    if (ids.has(id)) continue;
    ids.add(id);
    entries.push({ id, area, deck: deckWithCanvasCards({
      id, name: area.name, author: area.deckAuthor ?? undefined, createdAt: '', updatedAt: '',
      boards: { avatar: [], mainboard: [], collection: [], maybeboard: [] },
    }, area) });
  }
  return entries;
}
