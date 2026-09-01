// Phase 3 - Structured Intake. Frontend MIRROR of the pure engine in
// supabase/functions/_shared/inbox/intakeSchema.ts (the server file is the
// source of truth; this one is UX-only, exactly like
// src/lib/automations.ts mirrors _shared/automations/taxonomy.ts). Used by
// the Conversation "What we've learned" panel and the intake settings UI
// to show collected / missing / needs-clarification without a round trip.

export const INTAKE_FIELD_TYPES = [
  "text", "textarea", "email", "phone", "number", "currency",
  "date", "boolean", "single_select", "multi_select",
] as const;
export type IntakeFieldType = (typeof INTAKE_FIELD_TYPES)[number];

export const INTAKE_FIELD_TYPE_LABELS: Record<IntakeFieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  email: "Email address",
  phone: "Phone number",
  number: "Number",
  currency: "Amount",
  date: "Date",
  boolean: "Yes / No",
  single_select: "Single choice",
  multi_select: "Multiple choice",
};

export type IntakeFieldConfig = { options?: string[]; min?: number; max?: number };

export type IntakeFieldDef = {
  id?: string;
  schema_id?: string;
  key: string;
  label: string;
  question_text: string;
  field_type: IntakeFieldType;
  required: boolean;
  sort_order: number;
  help_text?: string | null;
  is_active?: boolean;
  config?: IntakeFieldConfig | null;
};

export type IntakeSchema = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type IntakePayloadView = { schemaId: string | null; fields: Record<string, unknown> };

/** Backward-compatible reader: { schema_id, fields } OR a flat legacy bag. */
export function readIntakePayload(payload: unknown): IntakePayloadView {
  if (!isPlainObject(payload)) return { schemaId: null, fields: {} };
  if (isPlainObject(payload.fields)) {
    return {
      schemaId: typeof payload.schema_id === "string" && payload.schema_id ? payload.schema_id : null,
      fields: { ...(payload.fields as Record<string, unknown>) },
    };
  }
  const { schema_id: legacy, ...rest } = payload as Record<string, unknown>;
  return { schemaId: typeof legacy === "string" && legacy ? legacy : null, fields: { ...rest } };
}

type CoerceResult = { status: "empty" } | { status: "invalid" } | { status: "ok"; value: unknown };

export function coerceFieldValue(field: IntakeFieldDef, raw: unknown): CoerceResult {
  if (raw === null || raw === undefined) return { status: "empty" };
  if (isPlainObject(raw) && "value" in raw) return coerceFieldValue(field, raw.value);
  const options = Array.isArray(field.config?.options) ? field.config!.options!.filter((o) => typeof o === "string") : [];
  const min = typeof field.config?.min === "number" ? field.config!.min : null;
  const max = typeof field.config?.max === "number" ? field.config!.max : null;

  switch (field.field_type) {
    case "text":
    case "textarea": {
      if (typeof raw !== "string") return { status: "invalid" };
      const t = raw.trim();
      return t ? { status: "ok", value: t } : { status: "empty" };
    }
    case "email": {
      if (typeof raw !== "string") return { status: "invalid" };
      const v = raw.trim().toLowerCase();
      if (!v) return { status: "empty" };
      return EMAIL_SHAPE.test(v) && v.length <= 320 ? { status: "ok", value: v } : { status: "invalid" };
    }
    case "phone": {
      if (typeof raw !== "string" && typeof raw !== "number") return { status: "invalid" };
      const s = String(raw).trim();
      if (!s) return { status: "empty" };
      const digits = (s.match(/\d/g) || []).length;
      return digits >= 7 && digits <= 15 ? { status: "ok", value: s } : { status: "invalid" };
    }
    case "number":
    case "currency": {
      if (typeof raw === "string" && raw.trim() === "") return { status: "empty" };
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[,\s]/g, "")) : NaN;
      if (!Number.isFinite(n)) return { status: "invalid" };
      if (min !== null && n < min) return { status: "invalid" };
      if (max !== null && n > max) return { status: "invalid" };
      return { status: "ok", value: n };
    }
    case "date": {
      if (typeof raw !== "string" || !raw.trim()) return raw === "" ? { status: "empty" } : { status: "invalid" };
      const t = Date.parse(raw.trim());
      return Number.isNaN(t) ? { status: "invalid" } : { status: "ok", value: new Date(t).toISOString().slice(0, 10) };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { status: "ok", value: raw };
      if (typeof raw === "string") {
        const v = raw.trim().toLowerCase();
        if (["true", "yes", "y", "1"].includes(v)) return { status: "ok", value: true };
        if (["false", "no", "n", "0"].includes(v)) return { status: "ok", value: false };
        if (!v) return { status: "empty" };
      }
      return { status: "invalid" };
    }
    case "single_select": {
      if (typeof raw !== "string") return { status: "invalid" };
      const v = raw.trim();
      if (!v) return { status: "empty" };
      return !options.length || options.includes(v) ? { status: "ok", value: v } : { status: "invalid" };
    }
    case "multi_select": {
      const arr = Array.isArray(raw) ? raw : typeof raw === "string" && raw.trim() ? raw.split(",").map((s) => s.trim()) : null;
      if (arr === null) return { status: "invalid" };
      const picked = arr.filter((s): s is string => typeof s === "string" && s.length > 0);
      if (!picked.length) return { status: "empty" };
      return !options.length || picked.every((p) => options.includes(p)) ? { status: "ok", value: Array.from(new Set(picked)) } : { status: "invalid" };
    }
  }
}

export type IntakeRowStatus = "collected" | "missing" | "needs_clarification";
export type IntakeStatusRow = { key: string; label: string; status: IntakeRowStatus; required: boolean; value: unknown };

export type IntakeEvaluation = {
  rows: IntakeStatusRow[];
  missingRequired: string[];
  nextField: IntakeFieldDef | null;
  requiredTotal: number;
  requiredCollected: number;
  complete: boolean;
};

function sortedActive(fields: IntakeFieldDef[]): IntakeFieldDef[] {
  return fields.filter((f) => f.is_active !== false).slice().sort((a, b) => (a.sort_order - b.sort_order) || a.key.localeCompare(b.key));
}

export function evaluateIntake(fields: IntakeFieldDef[], payloadFields: Record<string, unknown>): IntakeEvaluation {
  const active = sortedActive(fields);
  const rows: IntakeStatusRow[] = [];
  const missingRequired: string[] = [];
  let requiredTotal = 0;
  let requiredCollected = 0;
  let nextField: IntakeFieldDef | null = null;

  for (const f of active) {
    const r = coerceFieldValue(f, payloadFields[f.key]);
    if (f.required) requiredTotal += 1;
    let status: IntakeRowStatus;
    if (r.status === "ok") {
      status = "collected";
      if (f.required) requiredCollected += 1;
    } else if (r.status === "invalid") {
      status = "needs_clarification";
    } else {
      status = "missing";
    }
    rows.push({ key: f.key, label: f.label, status, required: f.required, value: r.status === "ok" ? r.value : payloadFields[f.key] ?? null });
    if (f.required && status !== "collected") {
      missingRequired.push(f.key);
      if (!nextField) nextField = f;
    }
  }

  return {
    rows,
    missingRequired,
    nextField,
    requiredTotal,
    requiredCollected,
    complete: missingRequired.length === 0,
  };
}
