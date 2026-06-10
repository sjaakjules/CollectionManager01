import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isBlockedTokenCardName } from "@/data/tokenCards";

interface CardCatalogEntry {
  name?: unknown;
}

interface TaxonomyStyleEntry {
  subStyles?: Record<string, unknown>;
}

interface TaxonomyAsset {
  cardCategories?: Record<string, unknown>;
  deckStyles?: Record<string, TaxonomyStyleEntry>;
  displayOrder?: {
    cardCategories?: unknown[];
    deckStyles?: unknown[];
  };
}

interface DeckStyleCardScore {
  score: number;
}

interface DeckStyleDeckRef {
  deckId: string;
  score: number;
}

interface DeckStyleDeckCard {
  name: string;
  quantity: number;
}

interface DeckStyleSourceDeck {
  id: string;
  name: string;
  avatar: string | null;
  elements: string[];
  boards: {
    mainboard: DeckStyleDeckCard[];
    sideboard: DeckStyleDeckCard[];
    avatar: DeckStyleDeckCard[];
    maybeboard: DeckStyleDeckCard[];
  };
}

interface DeckStyleSubStyleProfile {
  cards: Record<string, DeckStyleCardScore>;
  decks: DeckStyleDeckRef[];
}

interface DeckStyleProfile {
  cards: Record<string, DeckStyleCardScore>;
  decks: DeckStyleDeckRef[];
  subStyles: Record<string, DeckStyleSubStyleProfile>;
}

interface DeckStyleModeData {
  styles: Record<string, DeckStyleProfile>;
}

interface DeckStyleAssociationAsset {
  styles: Array<{
    id: string;
    name: string;
    subStyles: Array<{ id: string; name: string }>;
  }>;
  decks: Record<string, DeckStyleSourceDeck>;
  modes: Record<"primary" | "fractional", DeckStyleModeData>;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), relativePath), "utf8")) as T;
}

function cardCatalogNames(): Set<string> {
  const cards = readJson<CardCatalogEntry[]>("docs/Sorcery_CardInfo.json");
  return new Set(
    cards
      .map((card) => (typeof card.name === "string" ? card.name : ""))
      .filter(Boolean),
  );
}

describe("runtime card category assets", () => {
  it("keeps category scores aligned with taxonomy names and card catalog names", () => {
    const taxonomy = readJson<TaxonomyAsset>(
      "public/assets/sorcery_taxonomy_tooltips.json",
    );
    const scores = readJson<Record<string, Record<string, number>>>(
      "public/assets/sorcery_card_category_scores.json",
    );
    const sourceScores = readJson<Record<string, Record<string, number>>>(
      "tmp/sorcery_card_category_scores.json",
    );
    const categoryNames = new Set(Object.keys(taxonomy.cardCategories ?? {}));
    const cards = cardCatalogNames();

    const expectedLiveScoreCount = Object.keys(sourceScores).filter(
      (cardName) => !isBlockedTokenCardName(cardName),
    ).length;
    expect(Object.keys(scores)).toHaveLength(expectedLiveScoreCount);

    for (const [cardName, cardScores] of Object.entries(scores)) {
      expect(cards.has(cardName), `${cardName} is not in Sorcery_CardInfo`).toBe(true);
      expect(isBlockedTokenCardName(cardName), `${cardName} is a blocked token`).toBe(false);
      for (const [categoryName, score] of Object.entries(cardScores)) {
        expect(
          categoryNames.has(categoryName),
          `${categoryName} is not in taxonomy.cardCategories`,
        ).toBe(true);
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("runtime deck-style association asset", () => {
  it("keeps generated styles, sub-styles, and card names consistent", () => {
    const taxonomy = readJson<TaxonomyAsset>(
      "public/assets/sorcery_taxonomy_tooltips.json",
    );
    const associations = readJson<DeckStyleAssociationAsset>(
      "public/assets/sorcery_deck_style_associations.json",
    );
    const cards = cardCatalogNames();
    const taxonomyStyles = taxonomy.deckStyles ?? {};

    for (const style of associations.styles) {
      const taxonomyStyle = taxonomyStyles[style.name];
      expect(taxonomyStyle, `${style.name} is not in taxonomy.deckStyles`).toBeDefined();
      const taxonomySubStyles = new Set(Object.keys(taxonomyStyle?.subStyles ?? {}));
      for (const subStyle of style.subStyles) {
        expect(
          taxonomySubStyles.has(subStyle.name),
          `${style.name} / ${subStyle.name} is not in taxonomy.deckStyles`,
        ).toBe(true);
      }
    }

    for (const mode of ["primary", "fractional"] as const) {
      for (const style of associations.styles) {
        const profile = associations.modes[mode].styles[style.id];
        expect(profile, `${mode} missing style ${style.id}`).toBeDefined();
        if (!profile) throw new Error(`${mode} missing style ${style.id}`);

        for (const [cardName, cardScore] of Object.entries(profile.cards)) {
          expect(cards.has(cardName), `${mode} ${style.name} has unknown card`).toBe(
            true,
          );
          expect(isBlockedTokenCardName(cardName), `${cardName} is a blocked token`).toBe(
            false,
          );
          expect(cardScore.score).toBeGreaterThan(0);
          expect(cardScore.score).toBeLessThanOrEqual(1);
        }
        for (const deckRef of profile.decks) {
          expect(
            associations.decks[deckRef.deckId],
            `${mode} ${style.name} has unknown deck ${deckRef.deckId}`,
          ).toBeDefined();
          expect(deckRef.score).toBeGreaterThan(0);
          expect(deckRef.score).toBeLessThanOrEqual(1);
        }

        for (const subStyle of style.subStyles) {
          const subProfile = profile.subStyles[subStyle.id];
          expect(subProfile, `${mode} missing sub-style ${subStyle.id}`).toBeDefined();
          if (!subProfile) {
            throw new Error(`${mode} missing sub-style ${subStyle.id}`);
          }
          for (const [cardName, cardScore] of Object.entries(subProfile.cards)) {
            expect(
              cards.has(cardName),
              `${mode} ${style.name} / ${subStyle.name} has unknown card`,
            ).toBe(true);
            expect(
              isBlockedTokenCardName(cardName),
              `${cardName} is a blocked token`,
            ).toBe(false);
            expect(cardScore.score).toBeGreaterThan(0);
            expect(cardScore.score).toBeLessThanOrEqual(1);
          }
          for (const deckRef of subProfile.decks) {
            expect(
              associations.decks[deckRef.deckId],
              `${mode} ${style.name} / ${subStyle.name} has unknown deck ${deckRef.deckId}`,
            ).toBeDefined();
            expect(deckRef.score).toBeGreaterThan(0);
            expect(deckRef.score).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("keeps generated lookup decks aligned with the archive and card catalog", () => {
    const associations = readJson<DeckStyleAssociationAsset>(
      "public/assets/sorcery_deck_style_associations.json",
    );
    const styleScores = readJson<Record<string, unknown>>(
      "tmp/sorcery_deck_style_scores_with_substyles.json",
    );
    const archive = readJson<Record<string, unknown>>("offlineData/deckArchive.json");
    const cards = cardCatalogNames();
    const validElements = new Set(["air", "earth", "fire", "water"]);

    expect(Object.keys(associations.decks)).toHaveLength(Object.keys(styleScores).length);

    for (const [deckId, deck] of Object.entries(associations.decks)) {
      expect(styleScores[deckId], `${deckId} is not in style scores`).toBeDefined();
      expect(archive[deckId], `${deckId} is not in deckArchive`).toBeDefined();
      expect(deck.id).toBe(deckId);
      expect(deck.name.trim()).not.toBe("");
      expect(Array.isArray(deck.elements)).toBe(true);
      for (const element of deck.elements) {
        expect(validElements.has(element), `${deckId} has unknown element ${element}`).toBe(
          true,
        );
      }

      for (const board of Object.values(deck.boards)) {
        for (const entry of board) {
          expect(cards.has(entry.name), `${deckId} has unknown card ${entry.name}`).toBe(
            true,
          );
          expect(
            isBlockedTokenCardName(entry.name),
            `${deckId} includes blocked token ${entry.name}`,
          ).toBe(false);
          expect(entry.quantity).toBeGreaterThan(0);
        }
      }
    }
  });
});
