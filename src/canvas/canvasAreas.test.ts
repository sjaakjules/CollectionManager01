import { describe, expect, it } from "vitest";
import {
  QUADRANT_BOUNDS,
  ZONE_DEFAULT_SIZE,
  cardNameToOrientationMap,
  createEmptyZone,
  createDeckZone,
  ZONE_DECK_HEADER_HEIGHT,
  createLookupDeckZone,
  getQuadrantByZoneId,
} from "@/canvas/canvasAreas";
import type { Card, Deck } from "@/data/dataModels";
import { DECK_COLLECTION_WIDTH, DECK_BOARD_ORDER, getDeckBoardRects } from './deckBoardLayout';
import { CARD_SIZE } from '@/rendering/Grid';

function card(name: string, type: Card["guardian"]["type"]): Card {
  return {
    name,
    guardian: {
      rarity: "Ordinary",
      type,
      rulesText: "",
      cost: 0,
      attack: null,
      defence: null,
      life: null,
      thresholds: { air: 0, earth: 0, fire: 0, water: 0 },
    },
    elements: "",
    subTypes: "",
    sets: [],
  };
}

const deck: Deck = {
  id: "lookup-source",
  name: "Lookup Source",
  boards: {
    avatar: [{ name: "Druid", quantity: 1 }],
    mainboard: [{ name: "Spark", quantity: 1 }],
    collection: [],
    maybeboard: [],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("canvas area placement", () => {
  it('places Maybeboard after Collection and wraps Collection after ten portrait stacks', () => {
    const collection = Array.from({ length: 12 }, (_, index) => ({ name: `Spell ${String(index).padStart(2, '0')}`, quantity: 2 }));
    const info = cardNameToOrientationMap([
      card('Spark', 'Magic'), card('Maybe Site', 'Site'),
      ...collection.map((entry) => card(entry.name, 'Magic')),
    ]);
    const area = createDeckZone({ ...deck, boards: { ...deck.boards, collection: collection, maybeboard: [{ name: 'Maybe Site', quantity: 1 }] } }, info, 0);
    const rects = getDeckBoardRects(area.bounds, area.cards, ZONE_DECK_HEADER_HEIGHT, (name) => info.get(name)?.isLandscape ?? false);
    expect(rects.collection.width).toBeLessThanOrEqual(DECK_COLLECTION_WIDTH);
    expect(rects.maybeboard.y).toBeGreaterThan(rects.collection.y + rects.collection.height);
    const positions = new Map(area.cards.filter((entry) => entry.board === 'collection').map((entry) => [entry.cardName, entry]));
    const firstRowY = positions.get('Spell 00')?.y;
    expect([...positions.values()].filter((entry) => entry.y === firstRowY)).toHaveLength(10);
    expect(positions.get('Spell 10')?.y).toBeGreaterThan(firstRowY ?? 0);
    for (const board of DECK_BOARD_ORDER) {
      const rect = rects[board];
      for (const instance of area.cards.filter((entry) => entry.board === board)) {
        const size = info.get(instance.cardName)?.isLandscape ? CARD_SIZE.LANDSCAPE : CARD_SIZE.PORTRAIT;
        expect(instance.x).toBeGreaterThanOrEqual(rect.x);
        expect(instance.x + size.width).toBeLessThanOrEqual(rect.x + rect.width);
        expect(instance.y).toBeGreaterThanOrEqual(rect.y);
        expect(instance.y + size.height).toBeLessThanOrEqual(rect.y + rect.height);
      }
    }
    const mainIds = area.cards.filter((entry) => entry.board === 'mainboard').map((entry) => entry.id);
    expect(area.deckVariants?.[0]?.activeCardIds).toEqual(mainIds);
  });

  it('reserves separate Collection and Maybeboard sections even when both are empty', () => {
    const info = cardNameToOrientationMap([card('Spark', 'Magic')]);
    const area = createDeckZone(deck, info, 0);
    const rects = getDeckBoardRects(area.bounds, area.cards, ZONE_DECK_HEADER_HEIGHT, () => false);
    expect(rects.collection.width).toBe(DECK_COLLECTION_WIDTH);
    expect(rects.maybeboard.y).toBeGreaterThan(rects.collection.y + rects.collection.height);
    expect(area.bounds.y + area.bounds.height).toBeGreaterThanOrEqual(rects.maybeboard.y + rects.maybeboard.height);
  });

  it("places saved deck and stack areas in the saved top-left quadrant", () => {
    expect(getQuadrantByZoneId(createEmptyZone("deck", "Deck", 0))).toBe("decks");
    expect(getQuadrantByZoneId(createEmptyZone("stack", "Stack", 0))).toBe("decks");
  });

  it("places temporary lookup decks in the lower-left quadrant", () => {
    const lookup = createLookupDeckZone(
      deck,
      cardNameToOrientationMap([card("Druid", "Avatar"), card("Spark", "Magic")]),
    );

    expect(getQuadrantByZoneId(lookup)).toBe("stacks");
    expect(lookup.lookupDeckId).toBe("lookup-source");
    expect(lookup.deckId).toBeUndefined();
    expect(lookup.bounds.x).toBeGreaterThanOrEqual(QUADRANT_BOUNDS.stacks.x);
    expect(lookup.bounds.y).toBeGreaterThanOrEqual(QUADRANT_BOUNDS.stacks.y);
  });

  it("avoids existing pinned zones when placing temporary lookup decks", () => {
    const existingLowerLeftZone = {
      ...createEmptyZone("stack", "Old Stack", 0),
      bounds: {
        x: QUADRANT_BOUNDS.stacks.x + 220,
        y: QUADRANT_BOUNDS.stacks.y + 220,
        width: ZONE_DEFAULT_SIZE.deck.width,
        height: ZONE_DEFAULT_SIZE.deck.height,
      },
    };
    const lookup = createLookupDeckZone(
      deck,
      cardNameToOrientationMap([card("Druid", "Avatar"), card("Spark", "Magic")]),
      [existingLowerLeftZone],
    );

    expect(lookup.bounds).not.toEqual(existingLowerLeftZone.bounds);
  });
});
