import { describe, expect, it } from "vitest";
import type { Card, CardType } from "@/data/dataModels";
import type { CardFilterClause } from "@/data/cardFilters";
import { countFilterClauseMatches, shouldDeleteDraggedFilterChip } from "@/ui/filterDetails";

function card(name: string, type: CardType): Card {
  return {
    name,
    guardian: {
      rarity: "Ordinary",
      type,
      rulesText: "",
      cost: 1,
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

describe("filter detail helpers", () => {
  it("counts matches for a single enabled clause", () => {
    const clause: CardFilterClause = {
      enabled: true,
      criteria: {
        searchText: "",
        sets: [],
        types: ["site"],
        rarities: [],
        subType: "",
        artist: "",
        thresholds: [],
        thresholdMode: "inclusive",
        costMin: null,
        costMax: null,
        attackMin: null,
        attackMax: null,
        defenceMin: null,
        defenceMax: null,
      },
    };

    expect(countFilterClauseMatches([card("A", "Site"), card("B", "Minion")], clause)).toBe(1);
  });

  it("uses drag distance to decide chip deletion", () => {
    expect(shouldDeleteDraggedFilterChip({ x: 0, y: 0 }, { x: 12, y: 12 })).toBe(false);
    expect(shouldDeleteDraggedFilterChip({ x: 0, y: 0 }, { x: 45, y: 0 })).toBe(true);
  });
});

