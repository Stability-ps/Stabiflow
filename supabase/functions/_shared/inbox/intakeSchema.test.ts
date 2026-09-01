import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildExtractionSchema,
  coerceFieldValue,
  evaluateIntake,
  type IntakeFieldDef,
  type IntakeSchemaDef,
  mergeExtractedFields,
  readIntakePayload,
  resolveIntakeCompletion,
  writeIntakePayload,
} from "./intakeSchema.ts";

function field(partial: Partial<IntakeFieldDef> & Pick<IntakeFieldDef, "key" | "field_type">): IntakeFieldDef {
  return {
    key: partial.key,
    label: partial.label ?? partial.key,
    question_text: partial.question_text ?? `What is ${partial.key}?`,
    field_type: partial.field_type,
    required: partial.required ?? false,
    sort_order: partial.sort_order ?? 0,
    is_active: partial.is_active ?? true,
    config: partial.config ?? null,
  };
}

const SCHEMA: IntakeSchemaDef = {
  id: "schema-1",
  fields: [
    field({ key: "full_name", field_type: "text", required: true, sort_order: 10, question_text: "What's your full name?" }),
    field({ key: "email", field_type: "email", required: true, sort_order: 20, question_text: "What's a good email?" }),
    field({ key: "amount", field_type: "currency", required: true, sort_order: 30, question_text: "How much funding do you need?" }),
    field({ key: "notes", field_type: "textarea", required: false, sort_order: 40, question_text: "Anything else?" }),
  ],
};

// --- readIntakePayload (backward compatibility) ----------------------------

Deno.test("readIntakePayload: wrapped shape", () => {
  const v = readIntakePayload({ schema_id: "s1", fields: { a: 1 } });
  assertEquals(v, { schemaId: "s1", fields: { a: 1 } });
});

Deno.test("readIntakePayload: legacy flat bag", () => {
  const v = readIntakePayload({ customer_name: "Ada", email: "ada@x.com" });
  assertEquals(v, { schemaId: null, fields: { customer_name: "Ada", email: "ada@x.com" } });
});

Deno.test("readIntakePayload: junk is safe", () => {
  assertEquals(readIntakePayload(null), { schemaId: null, fields: {} });
  assertEquals(readIntakePayload("x"), { schemaId: null, fields: {} });
  assertEquals(readIntakePayload([1, 2]), { schemaId: null, fields: {} });
});

Deno.test("writeIntakePayload: canonical shape", () => {
  assertEquals(writeIntakePayload("s1", { a: 1 }), { schema_id: "s1", fields: { a: 1 } });
});

// --- coerceFieldValue -----------------------------------------------------

Deno.test("coerceFieldValue: email validation", () => {
  assertEquals(coerceFieldValue(field({ key: "e", field_type: "email" }), "  ADA@Example.com "), { status: "ok", value: "ada@example.com" });
  assertEquals(coerceFieldValue(field({ key: "e", field_type: "email" }), "not-an-email").status, "invalid");
  assertEquals(coerceFieldValue(field({ key: "e", field_type: "email" }), "").status, "empty");
});

Deno.test("coerceFieldValue: currency parses and bounds", () => {
  assertEquals(coerceFieldValue(field({ key: "a", field_type: "currency" }), "500,000"), { status: "ok", value: 500000 });
  assertEquals(coerceFieldValue(field({ key: "a", field_type: "currency", config: { min: 1000 } }), 50).status, "invalid");
});

Deno.test("coerceFieldValue: single_select must be an allowed option", () => {
  const f = field({ key: "s", field_type: "single_select", config: { options: ["a", "b"] } });
  assertEquals(coerceFieldValue(f, "a"), { status: "ok", value: "a" });
  assertEquals(coerceFieldValue(f, "z").status, "invalid");
});

Deno.test("coerceFieldValue: boolean synonyms", () => {
  assertEquals(coerceFieldValue(field({ key: "b", field_type: "boolean" }), "yes"), { status: "ok", value: true });
  assertEquals(coerceFieldValue(field({ key: "b", field_type: "boolean" }), false), { status: "ok", value: false });
});

// --- evaluateIntake -----------------------------------------------------

Deno.test("evaluateIntake: ordered missing-field calculation follows sort_order", () => {
  const e = evaluateIntake(SCHEMA, {});
  assertEquals(e.missing_required, ["full_name", "email", "amount"]);
  assertEquals(e.next_field?.key, "full_name");
  assertEquals(e.next_question, "What's your full name?");
  assertEquals(e.complete, false);
  assertEquals(e.required_total, 3);
  assertEquals(e.required_collected, 0);
});

Deno.test("evaluateIntake: next question advances as fields are answered", () => {
  const e = evaluateIntake(SCHEMA, { full_name: "Ada Lovelace" });
  assertEquals(e.next_field?.key, "email");
  assertEquals(e.required_collected, 1);
});

Deno.test("evaluateIntake: an optional field never blocks completion", () => {
  const e = evaluateIntake(SCHEMA, { full_name: "Ada", email: "ada@x.com", amount: 500000 });
  assertEquals(e.missing_required, []);
  assertEquals(e.complete, true);
  assertEquals(e.next_question, null);
});

Deno.test("evaluateIntake: an invalid value keeps the field missing and flags it", () => {
  const e = evaluateIntake(SCHEMA, { full_name: "Ada", email: "bogus", amount: 500000 });
  assertEquals(e.complete, false);
  assertEquals(e.missing_required, ["email"]);
  assertEquals(e.invalid.map((f) => f.key), ["email"]);
  assertEquals(e.next_field?.key, "email");
});

Deno.test("evaluateIntake: inactive fields are ignored entirely", () => {
  const schema: IntakeSchemaDef = {
    id: "s",
    fields: [
      field({ key: "a", field_type: "text", required: true, sort_order: 1 }),
      field({ key: "b", field_type: "text", required: true, sort_order: 2, is_active: false }),
    ],
  };
  const e = evaluateIntake(schema, { a: "x" });
  assertEquals(e.complete, true);
  assertEquals(e.required_total, 1);
});

Deno.test("evaluateIntake: a schema with zero required active fields never reports complete", () => {
  const schema: IntakeSchemaDef = {
    id: "s",
    fields: [
      field({ key: "a", field_type: "text", required: false, sort_order: 1 }),
      field({ key: "b", field_type: "text", required: false, sort_order: 2 }),
    ],
  };
  // nothing answered
  const empty = evaluateIntake(schema, {});
  assertEquals(empty.required_total, 0);
  assertEquals(empty.complete, false);
  assertEquals(empty.next_question, null);
  // every optional field answered - still not "complete" (nothing was required)
  const filled = evaluateIntake(schema, { a: "x", b: "y" });
  assertEquals(filled.complete, false);
  // and the completion transition therefore never fires
  assertEquals(resolveIntakeCompletion("c", null, filled).should_emit, false);
});

Deno.test("evaluateIntake: one required field among optionals still completes normally", () => {
  const schema: IntakeSchemaDef = {
    id: "s",
    fields: [
      field({ key: "opt", field_type: "text", required: false, sort_order: 1 }),
      field({ key: "req", field_type: "text", required: true, sort_order: 2 }),
    ],
  };
  assertEquals(evaluateIntake(schema, {}).complete, false);
  assertEquals(evaluateIntake(schema, { req: "here" }).complete, true);
});

Deno.test("evaluateIntake: malformed payload values are safe", () => {
  const e = evaluateIntake(SCHEMA, { full_name: { nested: true }, email: ["a"], amount: "abc" });
  assertEquals(e.complete, false);
  assertEquals(e.missing_required.sort(), ["amount", "email", "full_name"]);
});

// --- buildExtractionSchema ------------------------------------------------

Deno.test("buildExtractionSchema: only schema keys, closed object", () => {
  const s = buildExtractionSchema(SCHEMA) as Record<string, unknown>;
  const fields = (s.properties as Record<string, Record<string, unknown>>).fields;
  assertEquals(fields.additionalProperties, false);
  assertEquals(Object.keys(fields.properties as Record<string, unknown>).sort(), ["amount", "email", "full_name", "notes"]);
  assertEquals((fields.required as string[]).sort(), ["amount", "email", "full_name", "notes"]);
});

// --- mergeExtractedFields ------------------------------------------------

Deno.test("mergeExtractedFields: only accepts schema-defined keys", () => {
  const { fields, updated_keys } = mergeExtractedFields(SCHEMA, {}, { full_name: "Ada", NOT_A_FIELD: "x", amount: 500000 });
  assertEquals(fields, { full_name: "Ada", amount: 500000 });
  assertEquals(updated_keys.sort(), ["amount", "full_name"]);
});

Deno.test("mergeExtractedFields: preserves an existing still-valid answer", () => {
  const { fields, updated_keys } = mergeExtractedFields(SCHEMA, { full_name: "Ada Lovelace" }, { full_name: "Someone Else", email: "ada@x.com" });
  assertEquals(fields.full_name, "Ada Lovelace");
  assertEquals(fields.email, "ada@x.com");
  assertEquals(updated_keys, ["email"]);
});

Deno.test("mergeExtractedFields: an invalid extracted value is not written", () => {
  const { fields, updated_keys } = mergeExtractedFields(SCHEMA, {}, { email: "not-an-email" });
  assertEquals(fields, {});
  assertEquals(updated_keys, []);
});

// --- resolveIntakeCompletion -------------------------------------------

Deno.test("resolveIntakeCompletion: emits once on the incomplete->complete edge", () => {
  const complete = evaluateIntake(SCHEMA, { full_name: "Ada", email: "ada@x.com", amount: 1 });
  assertEquals(resolveIntakeCompletion("conv-1", null, complete), {
    should_emit: true,
    dedupe_key: "conversation.intake_completed:conv-1",
  });
  // replay: already stamped -> no second emission, same key
  assertEquals(resolveIntakeCompletion("conv-1", "2026-09-01T00:00:00Z", complete).should_emit, false);
  // still incomplete -> never emits
  assertEquals(resolveIntakeCompletion("conv-1", null, evaluateIntake(SCHEMA, {})).should_emit, false);
});
