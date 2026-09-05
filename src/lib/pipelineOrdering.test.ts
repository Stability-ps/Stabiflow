import { describe, expect, it } from "vitest";
import { computeReorderedStages } from "./pipelineOrdering";

describe("computeReorderedStages", () => {
  it("assigns sequential sort_order matching the requested order", () => {
    expect(computeReorderedStages(["a", "b", "c"], ["c", "a", "b"])).toEqual([
      { id: "c", sortOrder: 0 },
      { id: "a", sortOrder: 1 },
      { id: "b", sortOrder: 2 },
    ]);
  });

  it("rejects a reorder list missing a stage", () => {
    expect(() => computeReorderedStages(["a", "b", "c"], ["a", "b"])).toThrow();
  });

  it("rejects a reorder list with a foreign/unknown stage id", () => {
    expect(() => computeReorderedStages(["a", "b"], ["a", "z"])).toThrow(/does not belong/);
  });

  it("rejects a duplicate id in the reorder list", () => {
    expect(() => computeReorderedStages(["a", "b"], ["a", "a"])).toThrow();
  });
});
