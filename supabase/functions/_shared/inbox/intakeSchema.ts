// Phase 3 - Structured Intake. The ONE authoritative, pure, framework-free
// engine that turns (an active workspace intake schema + a conversation's
// current intake_payload) into: collected answers, missing required
// fields, invalid fields, the next question to ask, and a completion
// state. Kept independently testable (same pattern as leadContext.ts /
// webhookMessageParser.ts). The frontend keeps a structural mirror in
// src/lib/intakeSchema.ts (UX only - this file is the source of truth,
// exactly like taxonomy.ts <-> src/lib/automations.ts).
//
// Hard rules encoded here:
//   * only schema-defined keys are ever read or written
//   * only `required` fields count toward completion; optional fields never block
//   * a present-but-invalid value is NOT an answer - the field stays missing
//   * previously confirmed answers are preserved; extraction never overwrites
//     a still-valid stored value
//   * the model can never introduce a field the schema does not define

export const INTAKE_FIELD_TYPES = [
  "text", "textarea", "email", "phone", "number", "currency",
  "date", "boolean", "single_select", "multi_select",
] as const;
export type IntakeFieldType = (typeof INTAKE_FIELD_TYPES)[number];

export function isIntakeFieldType(value: string): value is IntakeFieldType {
  return (INTAKE_FIELD_TYPES as readonly string[]).includes(value);
}

export type IntakeFieldConfig = {
  options?: string[];
  min?: number;
  max?: number;
};

export type IntakeFieldDef = {
  key: string;
  label: string;
  question_text: string;
  field_type: IntakeFieldType;
  required: boolean;
  sort_order: number;
  is_active?: boolean;
  config?: IntakeFieldConfig | null;
};

export type IntakeSchemaDef = {
  id: string;
  fields: IntakeFieldDef[];
};

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_DIGITS = /\d/g;

export type IntakePayloadView = {
  schemaId: string | null;
  fields: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Backward-compatible reader. New payloads are { schema_id, fields:{...} };
 * every Phase-2 / greeting-path payload is a flat bag of answers with no
 * wrapper. Either shape is accepted; the flat bag is treated as `fields`
 * with an unknown schema. Never throws. */
export function readIntakePayload(payload: unknown): IntakePayloadView {
  if (!isPlainObject(payload)) return { schemaId: null, fields: {} };
  const wrapped = isPlainObject(payload.fields);
  if (wrapped) {
    const schemaId = typeof payload.schema_id === "string" && payload.schema_id ? payload.schema_id : null;
    return { schemaId, fields: { ...(payload.fields as Record<string, unknown>) } };
  }
  // Flat legacy bag. Drop a stray schema_id marker if present so it is not
  // mistaken for an answer.
  const { schema_id: legacySchemaId, ...rest } = payload as Record<string, unknown>;
  return {
    schemaId: typeof legacySchemaId === "string" && legacySchemaId ? legacySchemaId : null,
    fields: { ...rest },
  };
}

/** The canonical structured shape written back once a schema is active. */
export function writeIntakePayload(schemaId: string, fields: Record<string, unknown>): Record<string, unknown> {
  return { schema_id: schemaId, fields: { ...fields } };
}

export type CoerceResult =
  | { status: "empty" }
  | { status: "invalid"; reason: string }
  | { status: "ok"; value: string | number | boolean | string[] };

/** Conservative validate + coerce for a single field. Anything ambiguous is
 * `invalid` (stays missing / needs clarification), never a guessed answer. */
export function coerceFieldValue(field: IntakeFieldDef, raw: unknown): CoerceResult {
  if (raw === null || raw === undefined) return { status: "empty" };
  // A nested { value } shape (some historical payloads) - unwrap once.
  if (isPlainObject(raw) && "value" in raw) return coerceFieldValue(field, (raw as Record<string, unknown>).value);

  const options = Array.isArray(field.config?.options)
    ? (field.config!.options as unknown[]).filter((o): o is string => typeof o === "string")
    : [];
  const min = typeof field.config?.min === "number" ? field.config!.min : null;
  const max = typeof field.config?.max === "number" ? field.config!.max : null;

  switch (field.field_type) {
    case "text":
    case "textarea": {
      if (typeof raw !== "string") return { status: "invalid", reason: "not a string" };
      const trimmed = raw.trim();
      if (!trimmed) return { status: "empty" };
      return { status: "ok", value: trimmed.slice(0, 4000) };
    }
    case "email": {
      if (typeof raw !== "string") return { status: "invalid", reason: "not a string" };
      const v = raw.trim().toLowerCase();
      if (!v) return { status: "empty" };
      if (v.length > 320 || !EMAIL_SHAPE.test(v)) return { status: "invalid", reason: "not an email" };
      return { status: "ok", value: v };
    }
    case "phone": {
      if (typeof raw !== "string" && typeof raw !== "number") return { status: "invalid", reason: "not a phone" };
      const s = String(raw).trim();
      if (!s) return { status: "empty" };
      const digits = (s.match(PHONE_DIGITS) || []).length;
      if (digits < 7 || digits > 15) return { status: "invalid", reason: "implausible phone" };
      return { status: "ok", value: s.slice(0, 40) };
    }
    case "number":
    case "currency": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.replace(/[,\s]/g, "")) : NaN;
      if (typeof raw === "string" && raw.trim() === "") return { status: "empty" };
      if (!Number.isFinite(n)) return { status: "invalid", reason: "not a number" };
      if (min !== null && n < min) return { status: "invalid", reason: "below minimum" };
      if (max !== null && n > max) return { status: "invalid", reason: "above maximum" };
      return { status: "ok", value: n };
    }
    case "date": {
      if (typeof raw !== "string" || !raw.trim()) return raw === "" ? { status: "empty" } : { status: "invalid", reason: "not a date" };
      const t = Date.parse(raw.trim());
      if (Number.isNaN(t)) return { status: "invalid", reason: "unparseable date" };
      return { status: "ok", value: new Date(t).toISOString().slice(0, 10) };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { status: "ok", value: raw };
      if (typeof raw === "string") {
        const v = raw.trim().toLowerCase();
        if (["true", "yes", "y", "1"].includes(v)) return { status: "ok", value: true };
        if (["false", "no", "n", "0"].includes(v)) return { status: "ok", value: false };
        if (!v) return { status: "empty" };
      }
      return { status: "invalid", reason: "not a boolean" };
    }
    case "single_select": {
      if (typeof raw !== "string") return { status: "invalid", reason: "not a choice" };
      const v = raw.trim();
      if (!v) return { status: "empty" };
      if (options.length && !options.includes(v)) return { status: "invalid", reason: "not an allowed option" };
      return { status: "ok", value: v };
    }
    case "multi_select": {
      const arr = Array.isArray(raw) ? raw : typeof raw === "string" && raw.trim() ? raw.split(",").map((s) => s.trim()) : null;
      if (arr === null) return { status: "invalid", reason: "not a list" };
      const picked = arr.filter((s): s is string => typeof s === "string" && s.length > 0);
      if (!picked.length) return { status: "empty" };
      if (options.length && picked.some((p) => !options.includes(p))) return { status: "invalid", reason: "contains a disallowed option" };
      return { status: "ok", value: Array.from(new Set(picked)) };
    }
  }
}

export type CollectedAnswer = { key: string; label: string; value: unknown; field_type: IntakeFieldType };
export type FlaggedField = { key: string; label: string; reason?: string };

export type IntakeEvaluation = {
  schema_id: string;
  collected: CollectedAnswer[];
  /** Required, active, not yet validly answered - in schema order. */
  missing_required: string[];
  /** Present but failed coercion (required or not) - "needs clarification". */
  invalid: FlaggedField[];
  next_field: IntakeFieldDef | null;
  next_question: string | null;
  required_total: number;
  required_collected: number;
  complete: boolean;
};

function sortedActiveFields(schema: IntakeSchemaDef): IntakeFieldDef[] {
  return schema.fields
    .filter((f) => f.is_active !== false)
    .slice()
    .sort((a, b) => (a.sort_order - b.sort_order) || a.key.localeCompare(b.key));
}

/** The authoritative evaluation. `payloadFields` is the flat answer bag
 * (use readIntakePayload().fields). */
export function evaluateIntake(schema: IntakeSchemaDef, payloadFields: Record<string, unknown>): IntakeEvaluation {
  const fields = sortedActiveFields(schema);
  const collected: CollectedAnswer[] = [];
  const missingRequired: string[] = [];
  const invalid: FlaggedField[] = [];
  let requiredTotal = 0;
  let requiredCollected = 0;
  let nextField: IntakeFieldDef | null = null;

  for (const f of fields) {
    const result = coerceFieldValue(f, payloadFields[f.key]);
    if (f.required) requiredTotal += 1;
    if (result.status === "ok") {
      collected.push({ key: f.key, label: f.label, value: result.value, field_type: f.field_type });
      if (f.required) requiredCollected += 1;
      continue;
    }
    if (result.status === "invalid") invalid.push({ key: f.key, label: f.label, reason: result.reason });
    if (f.required) {
      missingRequired.push(f.key);
      if (!nextField) nextField = f;
    }
  }

  return {
    schema_id: schema.id,
    collected,
    missing_required: missingRequired,
    invalid,
    next_field: nextField,
    next_question: nextField ? nextField.question_text : null,
    required_total: requiredTotal,
    required_collected: requiredCollected,
    complete: missingRequired.length === 0,
  };
}

// --- AI extraction contract -------------------------------------------------

type JsonSchema = Record<string, unknown>;

function fieldJsonType(field: IntakeFieldDef): JsonSchema {
  switch (field.field_type) {
    case "number":
    case "currency":
      return { anyOf: [{ type: "number" }, { type: "null" }] };
    case "boolean":
      return { anyOf: [{ type: "boolean" }, { type: "null" }] };
    case "multi_select":
      return { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] };
    default:
      return { anyOf: [{ type: "string" }, { type: "null" }] };
  }
}

/** Build the strict JSON-schema `format` payload the reply engine hands to
 * the OpenAI Responses API. Only schema-defined keys appear; every value is
 * nullable so the model reports "not stated" rather than being forced to
 * invent one. `additionalProperties:false` structurally forbids an
 * off-schema field. */
export function buildExtractionSchema(schema: IntakeSchemaDef): JsonSchema {
  const activeFields = sortedActiveFields(schema);
  const fieldProps: Record<string, JsonSchema> = {};
  for (const f of activeFields) fieldProps[f.key] = fieldJsonType(f);
  return {
    type: "object",
    additionalProperties: false,
    required: ["reply", "human_handoff_requested", "fields"],
    properties: {
      reply: { type: "string" },
      human_handoff_requested: { type: "boolean" },
      fields: {
        type: "object",
        additionalProperties: false,
        required: activeFields.map((f) => f.key),
        properties: fieldProps,
      },
    },
  };
}

export function extractionKeyList(schema: IntakeSchemaDef): string[] {
  return sortedActiveFields(schema).map((f) => f.key);
}

// --- merge extracted answers ---------------------------------------------------

export type MergeResult = {
  fields: Record<string, unknown>;
  updated_keys: string[];
};

/** Merge model-extracted values into the stored answer bag under the rules
 * above: only schema keys, only values that coerce to `ok`, and never
 * clobber a stored value that is STILL valid (a customer correcting an
 * earlier answer flows through the manual set_intake_answer path, not
 * silent AI overwrite). A stored value that no longer coerces (schema
 * changed under it) may be replaced by a fresh valid extraction. */
export function mergeExtractedFields(
  schema: IntakeSchemaDef,
  existingFields: Record<string, unknown>,
  extracted: Record<string, unknown> | null | undefined,
): MergeResult {
  const out: Record<string, unknown> = { ...existingFields };
  const updated: string[] = [];
  if (!isPlainObject(extracted)) return { fields: out, updated_keys: updated };

  for (const f of sortedActiveFields(schema)) {
    if (!(f.key in extracted)) continue;
    const candidate = coerceFieldValue(f, extracted[f.key]);
    if (candidate.status !== "ok") continue;
    const current = coerceFieldValue(f, out[f.key]);
    if (current.status === "ok") continue; // keep a still-valid confirmed answer
    out[f.key] = candidate.value;
    updated.push(f.key);
  }
  return { fields: out, updated_keys: updated };
}

// --- completion transition ---------------------------------------------------

/** Pure decision for "did intake just go incomplete -> complete?". The
 * webhook and the manual set_intake_answer action both call this so the
 * dedupe key (and therefore exactly-once emission) is identical across
 * entry points. */
export function resolveIntakeCompletion(
  conversationId: string,
  previouslyCompletedAt: string | null | undefined,
  evaluation: IntakeEvaluation,
): { should_emit: boolean; dedupe_key: string } {
  const alreadyCompleted = !!previouslyCompletedAt;
  return {
    should_emit: evaluation.complete && !alreadyCompleted,
    dedupe_key: `conversation.intake_completed:${conversationId}`,
  };
}
