import { supabase } from "@/integrations/supabase/client";
import type { IntakeFieldDef, IntakeFieldType, IntakeSchema } from "@/lib/intakeSchema";

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const b = data as { error?: string; message?: string } | null;
    throw new Error(b?.message || b?.error || error.message || `${name} failed`);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    const typed = data as { error: string; message?: string };
    throw new Error(typed.message || typed.error);
  }
  return data as T;
}

function run<T>(workspaceId: string, action: string, params: Record<string, unknown> = {}) {
  return invoke<T>("intake-actions", { workspace_id: workspaceId, action, ...params });
}

export type IntakeFieldRow = IntakeFieldDef & {
  id: string;
  schema_id: string;
  workspace_id: string;
  help_text: string | null;
  is_active: boolean;
  config: { options?: string[]; min?: number; max?: number };
};

export function listIntakeSchemas(workspaceId: string) {
  return run<{ schemas: IntakeSchema[]; fields: IntakeFieldRow[] }>(workspaceId, "list");
}

export function createIntakeSchema(workspaceId: string, params: { name: string; description?: string }) {
  return run<{ schema_id: string; is_default: boolean }>(workspaceId, "create_schema", params);
}

export function updateIntakeSchema(workspaceId: string, schemaId: string, params: { name?: string; description?: string | null; is_active?: boolean }) {
  return run<{ ok: true }>(workspaceId, "update_schema", { schema_id: schemaId, ...params });
}

export function setDefaultIntakeSchema(workspaceId: string, schemaId: string) {
  return run<{ ok: true }>(workspaceId, "set_default_schema", { schema_id: schemaId });
}

export function deleteIntakeSchema(workspaceId: string, schemaId: string) {
  return run<{ ok: true }>(workspaceId, "delete_schema", { schema_id: schemaId });
}

export function createIntakeField(workspaceId: string, params: {
  schemaId: string; key: string; label: string; questionText: string; fieldType: IntakeFieldType;
  required: boolean; sortOrder?: number; helpText?: string; config?: { options?: string[]; min?: number; max?: number };
}) {
  return run<{ field_id: string }>(workspaceId, "create_field", {
    schema_id: params.schemaId, key: params.key, label: params.label, question_text: params.questionText,
    field_type: params.fieldType, required: params.required, sort_order: params.sortOrder, help_text: params.helpText, config: params.config,
  });
}

export function updateIntakeField(workspaceId: string, fieldId: string, params: {
  label?: string; questionText?: string; fieldType?: IntakeFieldType; required?: boolean; isActive?: boolean;
  sortOrder?: number; helpText?: string | null; config?: { options?: string[]; min?: number; max?: number };
}) {
  return run<{ ok: true }>(workspaceId, "update_field", {
    field_id: fieldId, label: params.label, question_text: params.questionText, field_type: params.fieldType,
    required: params.required, is_active: params.isActive, sort_order: params.sortOrder, help_text: params.helpText, config: params.config,
  });
}

export function deleteIntakeField(workspaceId: string, fieldId: string) {
  return run<{ ok: true }>(workspaceId, "delete_field", { field_id: fieldId });
}

export function reorderIntakeFields(workspaceId: string, schemaId: string, fieldIds: string[]) {
  return run<{ ok: true }>(workspaceId, "reorder_fields", { schema_id: schemaId, field_ids: fieldIds });
}

export function setNumberIntakeSchema(workspaceId: string, whatsappNumberId: string, schemaId: string | null) {
  return run<{ ok: true }>(workspaceId, "set_number_schema", { whatsapp_number_id: whatsappNumberId, schema_id: schemaId });
}

// --- Ask Info / manual answer edit (inbox-actions) -------------------------

async function runInbox<T>(workspaceId: string, conversationId: string, action: string, params: Record<string, unknown> = {}) {
  return invoke<T>("inbox-actions", { workspace_id: workspaceId, conversation_id: conversationId, action, ...params });
}

export type AskInfoPreview = {
  ok: true;
  has_schema: boolean;
  next_question: string | null;
  field_key?: string;
  field_label?: string;
  window_state?: string;
  requires_template?: boolean;
  complete?: boolean;
};

/** Preview only - never sends. Returns the exact question that WOULD be sent. */
export function previewAskInfo(workspaceId: string, conversationId: string) {
  return runInbox<AskInfoPreview>(workspaceId, conversationId, "ask_info", { confirm: false });
}

/** Explicitly confirmed send, through the same safe path as a staff reply. */
export function sendAskInfo(workspaceId: string, conversationId: string) {
  return runInbox<{ ok: true; delivery_status?: string; warning?: string | null; next_question: string | null; field_key?: string }>(
    workspaceId,
    conversationId,
    "ask_info",
    { confirm: true },
  );
}

export function setIntakeAnswer(workspaceId: string, conversationId: string, fieldKey: string, value: unknown) {
  return runInbox<{
    ok: true;
    evaluation: {
      collected: Array<{ key: string; label: string; value: unknown; field_type: string }>;
      missing_required: string[];
      invalid: Array<{ key: string; label: string }>;
      required_total: number;
      required_collected: number;
      complete: boolean;
      next_question: string | null;
    };
  }>(workspaceId, conversationId, "set_intake_answer", { field_key: fieldKey, value });
}
