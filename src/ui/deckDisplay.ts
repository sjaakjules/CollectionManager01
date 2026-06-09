import type { CanvasArea } from "@/canvas/canvasAreas";
import type { Card, Deck } from "@/data/dataModels";

export const AVATAR_SHORT_NAMES = {
  Animist: "Animist",
  Archimago: "Arch",
  "Avatar of Air": "AoAir",
  "Avatar of Earth": "AoEarth",
  "Avatar of Fire": "AoFire",
  "Avatar of Water": "AoWater",
  Battlemage: "Battle",
  Bladedancer: "Blade",
  Corruptor: "Corrupt",
  Deathspeaker: "Death",
  Dragonlord: "Dragon",
  Druid: "Druid",
  Duplicator: "Dupe",
  Elementalist: "Element",
  Enchantress: "Enchant",
  Flamecaller: "Flame",
  Geomancer: "Geo",
  Harbinger: "Harbi",
  Imposter: "Impost",
  Interrogator: "Interro",
  Ironclad: "Iron",
  Magician: "Magic",
  Necromancer: "Necro",
  Pathfinder: "Path",
  Persecutor: "Persec",
  "Realm-Eater": "Realm",
  Savior: "Savior",
  Seer: "Seer",
  Sorcerer: "Sorcer",
  Sparkmage: "Spark",
  Spellslinger: "Sling",
  Templar: "Templar",
  Waveshaper: "Wave",
  Witch: "Witch",
} as const;

export type AvatarName = keyof typeof AVATAR_SHORT_NAMES;
export type DeckElementId = "air" | "earth" | "fire" | "water";

export const DECK_ELEMENT_ICONS: Record<DeckElementId, string> = {
  air: "/assets/buttons/air.png",
  earth: "/assets/buttons/earth.png",
  fire: "/assets/buttons/fire.png",
  water: "/assets/buttons/water.png",
};

export const DECK_ELEMENT_LABELS: Record<DeckElementId, string> = {
  air: "Air",
  earth: "Earth",
  fire: "Fire",
  water: "Water",
};

const ELEMENT_ORDER: DeckElementId[] = ["air", "earth", "fire", "water"];

export function getAvatarShortName(avatarName: string | null | undefined): string {
  const trimmed = avatarName?.trim() ?? "";
  if (!trimmed) return "Deck";
  return AVATAR_SHORT_NAMES[trimmed as AvatarName] ?? trimmed;
}

export function getDeckAvatarName(deck: Deck | null | undefined): string | null {
  return deck?.boards.avatar[0]?.name ?? null;
}

export function getDeckDisplayName(deck: Deck, fallbackArea?: CanvasArea | null): string {
  return getAvatarShortName(getDeckAvatarName(deck) ?? fallbackArea?.avatarCardName ?? deck.name);
}

export function getDeckElementSummary(
  deck: Deck | null | undefined,
  cards: Card[],
  fallbackArea?: CanvasArea | null,
): DeckElementId[] {
  const cardByName = new Map(cards.map((card) => [card.name, card]));
  const present = new Set<DeckElementId>();

  const visitCardName = (cardName: string): void => {
    const card = cardByName.get(cardName);
    if (!card || card.guardian.type === "Avatar") return;
    const thresholds = card.guardian.thresholds;
    for (const element of ELEMENT_ORDER) {
      if (thresholds[element] > 0) {
        present.add(element);
      }
    }
  };

  if (deck) {
    for (const boardKey of ["mainboard", "sideboard", "maybeboard"] as const) {
      for (const entry of deck.boards[boardKey]) {
        visitCardName(entry.name);
      }
    }
  }

  if (present.size === 0 && fallbackArea) {
    for (const entry of fallbackArea.cards) {
      visitCardName(entry.cardName);
    }
  }

  return ELEMENT_ORDER.filter((element) => present.has(element));
}

