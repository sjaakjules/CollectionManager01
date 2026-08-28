import { describe, expect, it } from "vitest";

import {
  createEmptyCardFilterCriteria,
  normalizeFilterCriteria,
} from "./cardFilters";

describe("card filter normalization", () => {
  it("normalizes text searches for case-insensitive card JSON matching", () => {
    const criteria = normalizeFilterCriteria({
      ...createEmptyCardFilterCriteria(),
      searchText: " Court ",
    });

    expect(criteria.searchText).toBe("court");
  });
});
