import { describe, expect, it } from "vitest";
import { isValidLeadReference } from "./leadReference";

describe("isValidLeadReference", () => {
  it("accepts the LEAD-000001-style format", () => {
    expect(isValidLeadReference("LEAD-000001")).toBe(true);
    expect(isValidLeadReference("LEAD-000842")).toBe(true);
    expect(isValidLeadReference("LEAD-999999")).toBe(true);
  });

  it("rejects the wrong prefix, casing, or digit count", () => {
    expect(isValidLeadReference("lead-000001")).toBe(false);
    expect(isValidLeadReference("REQUEST-000001")).toBe(false);
    expect(isValidLeadReference("LEAD-1")).toBe(false);
    expect(isValidLeadReference("LEAD-0000001")).toBe(false);
    expect(isValidLeadReference("LEAD000001")).toBe(false);
    expect(isValidLeadReference("")).toBe(false);
  });
});
