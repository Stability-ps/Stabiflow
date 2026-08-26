import { describe, expect, it } from "vitest";
import { validateQualificationChange, qualificationStatusLabel } from "./qualification";

describe("validateQualificationChange", () => {
  it("requires a reason when marking not_qualified", () => {
    expect(validateQualificationChange("not_qualified", null)).toMatch(/reason is required/i);
    expect(validateQualificationChange("not_qualified", "   ")).toMatch(/reason is required/i);
  });

  it("allows not_qualified with a real reason", () => {
    expect(validateQualificationChange("not_qualified", "Budget too small")).toBeNull();
  });

  it("allows free transitions between the other three states with no reason", () => {
    expect(validateQualificationChange("unqualified", null)).toBeNull();
    expect(validateQualificationChange("qualifying", null)).toBeNull();
    expect(validateQualificationChange("qualified", null)).toBeNull();
  });
});

describe("qualificationStatusLabel", () => {
  it("labels every status", () => {
    expect(qualificationStatusLabel("unqualified")).toBe("Unqualified");
    expect(qualificationStatusLabel("qualifying")).toBe("Qualifying");
    expect(qualificationStatusLabel("qualified")).toBe("Qualified");
    expect(qualificationStatusLabel("not_qualified")).toBe("Not qualified");
  });
});
