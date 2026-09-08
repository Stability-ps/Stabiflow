import { describe, expect, it } from "vitest";
import { isCompleteHexColor, normalizeHexColor } from "./workspaceProfile";

describe("normalizeHexColor", () => {
  it("empty/whitespace -> null (clears the field)", () => {
    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor("   ")).toBeNull();
  });
  it("adds a missing leading #", () => {
    expect(normalizeHexColor("800080")).toBe("#800080");
  });
  it("lowercases a valid hex", () => {
    expect(normalizeHexColor("#800080")).toBe("#800080");
    expect(normalizeHexColor("#FF00FF")).toBe("#ff00ff");
  });
  it("leaves an invalid value as-is (with #) so the caller's own validation reports it", () => {
    expect(normalizeHexColor("blue")).toBe("#blue");
    expect(normalizeHexColor("#80")).toBe("#80");
  });
});

describe("isCompleteHexColor", () => {
  it("true only for a complete #RRGGBB", () => {
    expect(isCompleteHexColor("#800080")).toBe(true);
    expect(isCompleteHexColor("800080")).toBe(true);
  });
  it("false for empty, partial, or invalid input", () => {
    expect(isCompleteHexColor("")).toBe(false);
    expect(isCompleteHexColor("#80")).toBe(false);
    expect(isCompleteHexColor("blue")).toBe(false);
  });
});
