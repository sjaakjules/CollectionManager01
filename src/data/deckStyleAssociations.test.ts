import { describe, expect, it } from "vitest";
import {
  deckStyleSourceDeckToDeck,
  getDeckStyleAvatarLookupGroups,
  getFavouriteDeckStyleLookupDecks,
  getDeckStyleProfilesForDeck,
  getDeckStyleLookupDecks,
  type DeckStyleAssociationData,
} from "@/data/deckStyleAssociations";

const sourceDeck = {
  id: "deck-1",
  name: "Lookup Deck",
  author: "Decksmith",
  avatar: "Druid",
  elements: ["fire", "water"],
  boards: {
    avatar: [{ name: "Druid", quantity: 1 }],
    mainboard: [{ name: "Spark", quantity: 2 }],
    sideboard: [],
    maybeboard: [],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
} satisfies DeckStyleAssociationData["decks"][string];

const airSourceDeck = {
  ...sourceDeck,
  id: "deck-2",
  name: "Air Lookup Deck",
  avatar: "Air Avatar",
  elements: ["air"],
} satisfies DeckStyleAssociationData["decks"][string];

const data: DeckStyleAssociationData = {
  version: "test",
  generatedAt: "2026-01-03T00:00:00.000Z",
  alpha: 1,
  styles: [
    {
      id: "pressure",
      name: "Pressure",
      tooltip: "",
      description: "",
      subStyles: [
        {
          id: "burn",
          name: "Burn",
          tooltip: "",
          description: "",
        },
      ],
    },
    {
      id: "control",
      name: "Control",
      tooltip: "",
      description: "",
      subStyles: [],
    },
  ],
  decks: {
    "deck-1": sourceDeck,
    "deck-2": airSourceDeck,
  },
  modes: {
    primary: {
      styles: {
        pressure: {
          id: "pressure",
          name: "Pressure",
          cards: {},
          decks: [{ deckId: "missing", score: 0.9 }, { deckId: "deck-1", score: 0.7 }],
          subStyles: {
            burn: {
              id: "burn",
              name: "Burn",
              cards: {},
              decks: [{ deckId: "deck-1", score: 0.5 }],
            },
          },
        },
      },
    },
    fractional: {
      styles: {
        pressure: {
          id: "pressure",
          name: "Pressure",
          cards: {},
          decks: [
            { deckId: "deck-1", score: 0.7 },
            { deckId: "deck-2", score: 0.4 },
          ],
          subStyles: {
            burn: {
              id: "burn",
              name: "Burn",
              cards: {},
              decks: [{ deckId: "deck-1", score: 0.5 }],
            },
          },
        },
        control: {
          id: "control",
          name: "Control",
          cards: {},
          decks: [{ deckId: "deck-1", score: 0.2 }],
          subStyles: {},
        },
      },
    },
  },
};

describe("deck style lookup helpers", () => {
  it("converts source decks to loadable deck objects", () => {
    expect(deckStyleSourceDeckToDeck(sourceDeck)).toEqual({
      id: "deck-1",
      name: "Lookup Deck",
      author: "Decksmith",
      boards: sourceDeck.boards,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("returns selected style and sub-style decks while skipping missing deck ids", () => {
    expect(getDeckStyleLookupDecks(data, "primary", "pressure", null)).toEqual([
      {
        deck: deckStyleSourceDeckToDeck(sourceDeck),
        source: sourceDeck,
        score: 0.7,
      },
    ]);

    expect(getDeckStyleLookupDecks(data, "primary", "pressure", "burn")).toEqual([
      {
        deck: deckStyleSourceDeckToDeck(sourceDeck),
        source: sourceDeck,
        score: 0.5,
      },
    ]);
  });

  it("groups lookup decks by avatar", () => {
    expect(getDeckStyleAvatarLookupGroups(data)).toEqual([
      {
        avatar: "Air Avatar",
        decks: [
          {
            deck: deckStyleSourceDeckToDeck(airSourceDeck),
            source: airSourceDeck,
            score: null,
          },
        ],
      },
      {
        avatar: "Druid",
        decks: [
          {
            deck: deckStyleSourceDeckToDeck(sourceDeck),
            source: sourceDeck,
            score: null,
          },
        ],
      },
    ]);
  });

  it("returns favourite lookup decks in saved order while skipping missing ids", () => {
    expect(getFavouriteDeckStyleLookupDecks(data, ["deck-2", "missing", "deck-1"])).toEqual([
      {
        deck: deckStyleSourceDeckToDeck(airSourceDeck),
        source: airSourceDeck,
        score: null,
      },
      {
        deck: deckStyleSourceDeckToDeck(sourceDeck),
        source: sourceDeck,
        score: null,
      },
    ]);
  });

  it("returns deck style profiles for a selected lookup deck", () => {
    expect(getDeckStyleProfilesForDeck(data, "deck-1")).toEqual([
      {
        id: "pressure",
        name: "Pressure",
        score: 0.7,
        primary: true,
        subStyles: [
          {
            id: "burn",
            name: "Burn",
            score: 0.5,
            primary: true,
          },
        ],
      },
      {
        id: "control",
        name: "Control",
        score: 0.2,
        primary: false,
        subStyles: [],
      },
    ]);
  });
});
