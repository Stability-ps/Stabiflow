import { describe, expect, it } from "vitest";
import { normalizePhoneNumber } from "./phone";

describe("normalizePhoneNumber", () => {
  it("strips formatting and prefixes a leading +", () => {
    expect(normalizePhoneNumber("+27 83 123 4567")).toBe("+27831234567");
    expect(normalizePhoneNumber("(083) 123-4567")).toBe("+0831234567");
  });

  it("is idempotent on an already-normalized value", () => {
    expect(normalizePhoneNumber("+27831234567")).toBe("+27831234567");
  });

  it("returns null for empty/whitespace-only input", () => {
    expect(normalizePhoneNumber("")).toBeNull();
    expect(normalizePhoneNumber("   ")).toBeNull();
    expect(normalizePhoneNumber(null)).toBeNull();
    expect(normalizePhoneNumber(undefined)).toBeNull();
  });

  it("does not fabricate a number out of an incomplete/too-short input", () => {
    expect(normalizePhoneNumber("123")).toBeNull();
    expect(normalizePhoneNumber("+27")).toBeNull();
  });

  it("collapses an interior + (e.g. a pasted double country code) without dropping digits", () => {
    expect(normalizePhoneNumber("+27+831234567")).toBe("+27831234567");
  });
});
