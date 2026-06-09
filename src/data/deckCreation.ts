import { createEmptyDeck, type Deck } from "@/data/dataModels";
import { generateUUID } from "@/utils/uuid";

export interface CreateLocalDeckOptions {
  name: string;
  avatarName: string;
  id?: string;
  mainboardCardNames?: string[];
}

export function createLocalDeck({
  name,
  avatarName,
  id,
  mainboardCardNames = [],
}: CreateLocalDeckOptions): Deck {
  const deck = createEmptyDeck(name.trim(), id ?? generateUUID());
  deck.boards.avatar = [{ name: avatarName.trim(), quantity: 1 }];

  const quantities = new Map<string, number>();
  for (const cardName of mainboardCardNames) {
    const trimmed = cardName.trim();
    if (!trimmed) continue;
    quantities.set(trimmed, (quantities.get(trimmed) ?? 0) + 1);
  }

  deck.boards.mainboard = Array.from(quantities.entries()).map(
    ([cardName, quantity]) => ({
      name: cardName,
      quantity,
    }),
  );

  return deck;
}

