import type { Card, Deck, DeckBoards, Element } from "@/data/dataModels";
import { isBlockedTokenCardName } from "@/data/tokenCards";

export type DeckStyleAssociationMode = "primary" | "fractional";
export type DeckStyleLookupElement = Lowercase<Element>;

export interface DeckStyleSubStyleDefinition {
  id: string;
  name: string;
  tooltip: string;
  description: string;
}

export interface DeckStyleDefinition {
  id: string;
  name: string;
  tooltip: string;
  description: string;
  subStyles: DeckStyleSubStyleDefinition[];
}

export interface DeckStyleCardScore {
  score: number;
  deckCount: number;
  weightedDecks: number;
  examples: string[];
}

export interface DeckStyleDeckRef {
  deckId: string;
  score: number;
}

export interface DeckStyleSourceDeck {
  id: string;
  name: string;
  author?: string;
  avatar: string | null;
  elements: DeckStyleLookupElement[];
  boards: DeckBoards;
  createdAt: string;
  updatedAt: string;
}

export interface DeckStyleLookupDeck {
  deck: Deck;
  source: DeckStyleSourceDeck;
  score: number | null;
}

export interface DeckStyleAvatarLookupGroup {
  avatar: string;
  decks: DeckStyleLookupDeck[];
}

export interface DeckStyleDeckSubStyleProfile {
  id: string;
  name: string;
  score: number;
  primary: boolean;
}

export interface DeckStyleDeckProfile {
  id: string;
  name: string;
  score: number;
  primary: boolean;
  subStyles: DeckStyleDeckSubStyleProfile[];
}

export interface DeckStyleProfile {
  id: string;
  name: string;
  cards: Record<string, DeckStyleCardScore>;
  decks: DeckStyleDeckRef[];
  subStyles: Record<string, DeckStyleSubStyleProfile>;
}

export interface DeckStyleSubStyleProfile {
  id: string;
  name: string;
  cards: Record<string, DeckStyleCardScore>;
  decks: DeckStyleDeckRef[];
}

export interface DeckStyleModeData {
  styles: Record<string, DeckStyleProfile>;
}

export interface DeckStyleAssociationData {
  version: string;
  generatedAt: string;
  alpha: number;
  styles: DeckStyleDefinition[];
  decks: Record<string, DeckStyleSourceDeck>;
  modes: Record<DeckStyleAssociationMode, DeckStyleModeData>;
}

const DECK_STYLE_ASSET_PATH = "/assets/sorcery_deck_style_associations.json";

let deckStyleCache: DeckStyleAssociationData | null = null;
let deckStylePromise: Promise<DeckStyleAssociationData> | null = null;

export async function loadDeckStyleAssociations(): Promise<DeckStyleAssociationData> {
  if (deckStyleCache) return deckStyleCache;
  if (deckStylePromise) return deckStylePromise;

  deckStylePromise = fetch(DECK_STYLE_ASSET_PATH, { cache: "no-store" }).then(
    async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load deck style associations: ${response.status}`);
      }
      deckStyleCache = (await response.json()) as DeckStyleAssociationData;
      return deckStyleCache;
    },
  );
  return deckStylePromise;
}

export function getDeckStyleCardScore(
  data: DeckStyleAssociationData | null,
  mode: DeckStyleAssociationMode,
  styleId: string | null,
  subStyleId: string | null,
  cardName: string,
): number {
  if (!data || !styleId) return 0;
  const style = data.modes[mode]?.styles[styleId];
  const score = subStyleId
    ? style?.subStyles[subStyleId]?.cards[cardName]?.score
    : style?.cards[cardName]?.score;
  return typeof score === "number" && Number.isFinite(score) ? score : 0;
}

export function getDeckStyleShelfCards(
  data: DeckStyleAssociationData | null,
  mode: DeckStyleAssociationMode,
  styleId: string | null,
  subStyleId: string | null,
  cards: Card[],
): Array<{ card: Card; score: number }> {
  if (!data || !styleId) return [];
  const scoreByCard = subStyleId
    ? data.modes[mode]?.styles[styleId]?.subStyles[subStyleId]?.cards ?? {}
    : data.modes[mode]?.styles[styleId]?.cards ?? {};
  const cardByName = new Map(
    cards
      .filter((card) => !isBlockedTokenCardName(card.name))
      .map((card) => [card.name, card]),
  );

  return Object.entries(scoreByCard)
    .map(([cardName, score]) => {
      if (isBlockedTokenCardName(cardName)) return null;
      const card = cardByName.get(cardName);
      if (!card) return null;
      return { card, score: score.score };
    })
    .filter((entry): entry is { card: Card; score: number } => !!entry && entry.score > 0)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.card.name.localeCompare(right.card.name);
    });
}

export function deckStyleSourceDeckToDeck(source: DeckStyleSourceDeck): Deck {
  return {
    id: source.id,
    name: source.name,
    author: source.author,
    boards: source.boards,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function compareLookupDecks(left: DeckStyleLookupDeck, right: DeckStyleLookupDeck): number {
  const avatarDelta = (left.source.avatar ?? "").localeCompare(right.source.avatar ?? "");
  if (avatarDelta !== 0) return avatarDelta;
  return left.source.name.localeCompare(right.source.name);
}

export function getAllDeckStyleLookupDecks(
  data: DeckStyleAssociationData | null,
): DeckStyleLookupDeck[] {
  if (!data) return [];
  return Object.values(data.decks)
    .map<DeckStyleLookupDeck>((source) => ({
      deck: deckStyleSourceDeckToDeck(source),
      source,
      score: null,
    }))
    .sort(compareLookupDecks);
}

export function getFavouriteDeckStyleLookupDecks(
  data: DeckStyleAssociationData | null,
  deckIds: readonly string[],
): DeckStyleLookupDeck[] {
  if (!data) return [];
  return deckIds
    .map<DeckStyleLookupDeck | null>((deckId) => {
      const source = data.decks[deckId];
      if (!source) return null;
      return {
        deck: deckStyleSourceDeckToDeck(source),
        source,
        score: null,
      };
    })
    .filter((entry): entry is DeckStyleLookupDeck => entry !== null);
}

export function getDeckStyleAvatarLookupGroups(
  data: DeckStyleAssociationData | null,
): DeckStyleAvatarLookupGroup[] {
  const groups = new Map<string, DeckStyleLookupDeck[]>();
  for (const entry of getAllDeckStyleLookupDecks(data)) {
    const avatar = entry.source.avatar?.trim() || "No Avatar";
    const existing = groups.get(avatar) ?? [];
    existing.push(entry);
    groups.set(avatar, existing);
  }

  return Array.from(groups.entries())
    .map(([avatar, decks]) => ({
      avatar,
      decks: decks.sort(compareLookupDecks),
    }))
    .sort((left, right) => left.avatar.localeCompare(right.avatar));
}

function findDeckRefScore(refs: DeckStyleDeckRef[] | undefined, deckId: string): number {
  const score = refs?.find((ref) => ref.deckId === deckId)?.score;
  return typeof score === "number" && Number.isFinite(score) ? score : 0;
}

export function getDeckStyleProfilesForDeck(
  data: DeckStyleAssociationData | null,
  deckId: string | null,
): DeckStyleDeckProfile[] {
  if (!data || !deckId) return [];

  return data.styles
    .map((style) => {
      const fractionalStyle = data.modes.fractional?.styles[style.id];
      const primaryStyle = data.modes.primary?.styles[style.id];
      const score = findDeckRefScore(fractionalStyle?.decks, deckId);
      const primary = findDeckRefScore(primaryStyle?.decks, deckId) > 0;

      const subStyles = style.subStyles
        .map((subStyle) => {
          const subScore = findDeckRefScore(
            fractionalStyle?.subStyles[subStyle.id]?.decks,
            deckId,
          );
          const subPrimary =
            findDeckRefScore(primaryStyle?.subStyles[subStyle.id]?.decks, deckId) > 0;
          if (subScore <= 0 && !subPrimary) return null;
          return {
            id: subStyle.id,
            name: subStyle.name,
            score: subScore,
            primary: subPrimary,
          };
        })
        .filter((entry): entry is DeckStyleDeckSubStyleProfile => entry !== null)
        .sort((left, right) => {
          if (left.primary !== right.primary) return left.primary ? -1 : 1;
          const scoreDelta = right.score - left.score;
          if (scoreDelta !== 0) return scoreDelta;
          return left.name.localeCompare(right.name);
        });

      if (score <= 0 && !primary && subStyles.length === 0) return null;
      return {
        id: style.id,
        name: style.name,
        score,
        primary,
        subStyles,
      };
    })
    .filter((entry): entry is DeckStyleDeckProfile => entry !== null)
    .sort((left, right) => {
      if (left.primary !== right.primary) return left.primary ? -1 : 1;
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.name.localeCompare(right.name);
    });
}

export function getDeckStyleLookupDecks(
  data: DeckStyleAssociationData | null,
  mode: DeckStyleAssociationMode,
  styleId: string | null,
  subStyleId: string | null,
): Array<DeckStyleLookupDeck & { score: number }> {
  if (!data || !styleId) return [];
  const profile = data.modes[mode]?.styles[styleId];
  const refs = subStyleId
    ? profile?.subStyles[subStyleId]?.decks ?? []
    : profile?.decks ?? [];

  return refs
    .map((ref) => {
      const source = data.decks[ref.deckId];
      if (!source) return null;
      return {
        deck: deckStyleSourceDeckToDeck(source),
        source,
        score: ref.score,
      };
    })
    .filter(
      (entry): entry is DeckStyleLookupDeck & { score: number } => entry !== null,
    );
}
