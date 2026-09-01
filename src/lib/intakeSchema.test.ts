import { describe, expect, it } from "vitest";
import { coerceFieldValue, evaluateIntake, type IntakeFieldDef, readIntakePayload } from "./intakeSchema";

function field(p: Partial<IntakeFieldDef> & Pick<IntakeFieldDef, "key" | "field_type">): IntakeFieldDef {
  return {
    key: p.key,
    label: p.label ?? p.key,
    question_text: p.question_text ?? `What is ${p.key}?`,
    field_type: p.field_type,
    required: p.required ?? false,
    sort_order: p.sort_order ?? 0,
    is_active: p.is_active ?? true,
    config: p.config ?? null,
  };
}

const FIELDS: IntakeFieldDef[] = [
  field({ key: "full_name", field_type: "text", required: true, sort_order: 10 }),
  field({ key: "email", field_type: "email", required: true, sort_order: 20 }),
  field({ key: "budget", field_type: "currency", required: true, sort_order: 30 }),
  field({ key: "notes", field_type: "textarea", required: false, sort_order: 40 }),
];

describe("readIntakePayload", () => {
  it("reads the wrapped shape", () => {
    expect(readIntakePayload({ schema_id: "s", fields: { a: 1 } })).toEqual({ schemaId: "s", fields: { a: 1 } });
  });
  it("reads a legacy flat bag", () => {
    expect(readIntakePayload({ customer_name: "Ada" })).toEqual({ schemaId: null, fields: { customer_name: "Ada" } });
  });
  it("is safe on junk", () => {
    expect(readIntakePayload(null)).toEqual({ schemaId: null, fields: {} });
  });
});

describe("coerceFieldValue", () => {
  it("validates email", () => {
    expect(coerceFieldValue(field({ key: "e", field_type: "email" }), "ADA@x.com")).toEqual({ status: "ok", value: "ada@x.com" });
    expect(coerceFieldValue(field({ key: "e", field_type: "email" }), "nope").status).toBe("invalid");
  });
  it("single_select must be an allowed option", () => {
    const f = field({ key: "s", field_type: "single_select", config: { options: ["a", "b"] } });
    expect(coerceFieldValue(f, "a").status).toBe("ok");
    expect(coerceFieldValue(f, "z").status).toBe("invalid");
  });
});

describe("evaluateIntake", () => {
  it("orders missing required fields by sort_order and picks the next", () => {
    const e = evaluateIntake(FIELDS, {});
    expect(e.missingRequired).toEqual(["full_name", "email", "budget"]);
    expect(e.nextField?.key).toBe("full_name");
    expect(e.requiredTotal).toBe(3);
    expect(e.complete).toBe(false);
  });

  it("an optional field never blocks completion", () => {
    const e = evaluateIntake(FIELDS, { full_name: "Ada", email: "ada@x.com", budget: 500000 });
    expect(e.complete).toBe(true);
    expect(e.nextField).toBeNull();
  });

  it("an invalid value is flagged as needs_clarification and keeps the field missing", () => {
    const e = evaluateIntake(FIELDS, { full_name: "Ada", email: "bad", budget: 1 });
    expect(e.complete).toBe(false);
    expect(e.rows.find((r) => r.key === "email")?.status).toBe("needs_clarification");
    expect(e.missingRequired).toEqual(["email"]);
  });

  it("ignores inactive fields", () => {
    const e = evaluateIntake(
      [field({ key: "a", field_type: "text", required: true, sort_order: 1 }), field({ key: "b", field_type: "text", required: true, sort_order: 2, is_active: false })],
      { a: "x" },
    );
    expect(e.complete).toBe(true);
    expect(e.requiredTotal).toBe(1);
  });
});
