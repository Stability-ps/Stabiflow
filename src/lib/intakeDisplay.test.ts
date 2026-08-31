import { describe, expect, it } from "vitest";
import { formatBytes, hasDisplayableIntake, intakeRows } from "./intakeDisplay";

describe("intakeRows", () => {
  it("returns [] for an empty / non-object payload (caller renders nothing, not an empty shell)", () => {
    expect(intakeRows({})).toEqual([]);
    expect(intakeRows(null)).toEqual([]);
    expect(intakeRows([1, 2])).toEqual([]);
    expect(intakeRows("x")).toEqual([]);
    expect(hasDisplayableIntake({})).toBe(false);
  });

  it("turns snake_case keys into sentence case and formats scalars", () => {
    expect(
      intakeRows({ customer_name: "Ada", email: "ada@x.io", urgency: "high", wants_callback: true }),
    ).toEqual([
      { key: "customer_name", label: "Customer name", value: "Ada" },
      { key: "email", label: "Email", value: "ada@x.io" },
      { key: "urgency", label: "Urgency", value: "high" },
      { key: "wants_callback", label: "Wants callback", value: "Yes" },
    ]);
  });

  it("drops empty strings, nulls and plumbing keys; joins arrays", () => {
    expect(
      intakeRows({ interest_summary: "  ", note: null, source: "whatsapp_admin_ai", phone: "+27...", tags: ["a", "", "b"] }),
    ).toEqual([{ key: "tags", label: "Tags", value: "a, b" }]);
  });

  it("forward-compat: reads from a { fields: { key: { value } } } shape (Phase 3)", () => {
    expect(
      intakeRows({ schema_id: "s1", fields: { budget: { value: 5000, state: "collected" }, empty_one: { value: null } } }),
    ).toEqual([{ key: "budget", label: "Budget", value: "5000" }]);
  });
});

describe("formatBytes", () => {
  it("formats or returns null", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3_500_000)).toBe("3.3 MB");
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(-1)).toBeNull();
  });
});
