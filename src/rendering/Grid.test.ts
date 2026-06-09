import { describe, expect, it } from "vitest";
import type { CardType, ThresholdGroup } from "@/data/dataModels";
import {
  calculateCardLayout,
  type GroupHeader,
  type LayoutCardInput,
  type LayoutResult,
} from "./Grid";

function card(
  name: string,
  type: CardType,
  thresholdGroup: ThresholdGroup,
  cost: number | null = 1,
): LayoutCardInput {
  return {
    name,
    type,
    thresholdGroup,
    cost,
    isLandscape: type === "Site",
    rarity: "Ordinary",
    primarySet: "Alpha",
  };
}

function cardByName(result: LayoutResult, name: string) {
  const layout = result.cards.find((entry) => entry.name === name);
  if (!layout) {
    throw new Error(`Expected ${name} to be laid out`);
  }
  return layout;
}

function collectionHeader(
  result: LayoutResult,
  label: string,
): GroupHeader | undefined {
  return result.headers.find(
    (header) => header.kind === "collection" && header.label === label,
  );
}

describe("calculateCardLayout", () => {
  it("keeps wide grouped threshold groups horizontal", () => {
    const result = calculateCardLayout({
      cards: [
        card("Air Adept", "Minion", "air"),
        card("Earth Adept", "Minion", "earth"),
      ],
    });

    const air = cardByName(result, "Air Adept");
    const earth = cardByName(result, "Earth Adept");

    expect(air.position.x).toBeLessThan(earth.position.x);
    expect(air.position.y).toBe(earth.position.y);
  });

  it("stacks portrait element sections with minions left and other types right", () => {
    const result = calculateCardLayout({
      cards: [
        card("Avatar A", "Avatar", "air"),
        card("Avatar B", "Avatar", "earth"),
        card("Air Minion", "Minion", "air"),
        card("Air Magic", "Magic", "air"),
        card("Air Aura", "Aura", "air"),
        card("Air Site", "Site", "air"),
        card("Earth Minion", "Minion", "earth"),
      ],
      layoutVariant: "portrait",
    });

    const airMinion = cardByName(result, "Air Minion");
    const airMagic = cardByName(result, "Air Magic");
    const earthMinion = cardByName(result, "Earth Minion");
    const airHeader = collectionHeader(result, "Air");
    const earthHeader = collectionHeader(result, "Earth");

    expect(airMinion.position.x).toBeLessThan(airMagic.position.x);
    expect(earthMinion.position.y).toBeGreaterThan(airMinion.position.y);
    expect(airHeader).toBeDefined();
    expect(earthHeader?.position.y).toBeGreaterThan(airHeader?.position.y ?? 0);
  });

  it("moves the four named provider-family cards to their explicit elements", () => {
    const result = calculateCardLayout({
      cards: [
        card("Castle Servants", "Minion", "none", 2),
        card("Common Cottagers", "Minion", "none", 2),
        card("Blacksmith Family", "Minion", "none", 2),
        card("Fisherman's Family", "Minion", "none", 2),
      ],
    });

    expect(cardByName(result, "Castle Servants").thresholdGroup).toBe("air");
    expect(cardByName(result, "Common Cottagers").thresholdGroup).toBe(
      "earth",
    );
    expect(cardByName(result, "Blacksmith Family").thresholdGroup).toBe(
      "fire",
    );
    expect(cardByName(result, "Fisherman's Family").thresholdGroup).toBe(
      "water",
    );
  });

  it("hides null-cost None minion tokens only in grouped layouts", () => {
    const token = card("Frog", "Minion", "none", null);

    const grouped = calculateCardLayout({ cards: [token] });
    const filteredFlat = calculateCardLayout({
      cards: [token],
      mode: "filteredFlat",
    });

    expect(grouped.cards.map((entry) => entry.name)).not.toContain("Frog");
    expect(filteredFlat.cards.map((entry) => entry.name)).toContain("Frog");
  });

  it("adds a portrait Artifacts and Multi / None section with None sites", () => {
    const result = calculateCardLayout({
      cards: [
        card("Clockwork", "Artifact", "none", 1),
        card("Triune Minion", "Minion", "multiple", 2),
        card("Triune Magic", "Magic", "multiple", 2),
        card("Triune Site", "Site", "multiple", 2),
        card("Desert", "Site", "none", 0),
      ],
      layoutVariant: "portrait",
    });

    const artifact = cardByName(result, "Clockwork");
    const multiMinion = cardByName(result, "Triune Minion");
    const noneSite = cardByName(result, "Desert");

    expect(collectionHeader(result, "Artifacts")).toBeDefined();
    expect(collectionHeader(result, "Multi / None")).toBeDefined();
    expect(artifact.position.x).toBeLessThan(multiMinion.position.x);
    expect(noneSite.thresholdGroup).toBe("none");
  });
});
