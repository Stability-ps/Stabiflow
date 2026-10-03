// Workspace intake-schema configuration actions (Phase 3). Same dispatcher
// shape as pipelines-actions / leads-actions / inbox-actions: ONE POST
// endpoint, one `action` field, every mutation gated by intake.manage and
// executed with the service role after the caller's own permission is
// verified against their session. Reads (list) need only intake.view.
//
// A schema field `key` is immutable once created - historical answers in
// every intake_payload are keyed by it, and silently renaming it would
// orphan them (PDF safe-schema-editing rule). Retiring a field/schema is a
// deactivation, or a delete that (via ON DELETE SET NULL / jsonb storage)
// never erases a stored answer.
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json, type AnySupabaseClient } from "../_shared/contentAuth.ts";
import { isIntakeFieldType } from "../_shared/inbox/intakeSchema.ts";

const VALID_ACTIONS = new Set([
  "list",
  "create_schema", "update_schema", "set_default_schema", "delete_schema",
  "create_field", "update_field", "delete_field", "reorder_fields",
  "set_number_schema",
]);

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

async function logActivity(sb: AnySupabaseClient, workspaceId: string, actorId: string, action: string, targetId: string | null, metadata: Record<string, unknown> = {}) {
  await sb.from("workspace_activity_log").insert({ workspace_id: workspaceId, actor_user_id: actorId, action, target_type: "intake_schema", target_id: targetId, metadata });
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Keep only the config keys the engine understands: options[] (selects),
 * min/max (numeric). Anything else is dropped - never a free-form blob. */
function sanitizeConfig(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (Array.isArray(src.options)) {
    const options = src.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => o.trim()).slice(0, 50);
    if (options.length) out.options = Array.from(new Set(options));
  }
  if (typeof src.min === "number" && Number.isFinite(src.min)) out.min = src.min;
  if (typeof src.max === "number" && Number.isFinite(src.max)) out.max = src.max;
  return out;
}

function validateFieldShape(fieldType: string, required: boolean, config: Record<string, unknown>): string | null {
  if (!isIntakeFieldType(fieldType)) return "Unsupported field type";
  if ((fieldType === "single_select" || fieldType === "multi_select") && required && !Array.isArray(config.options)) {
    return "A required select field needs at least one option";
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const workspaceId = body.workspace_id;
  const action = body.action;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) return json(req, { error: "Unknown action" }, 400);

  const needed = action === "list" ? "intake.view" : "intake.manage";
  if (!(await hasWorkspacePermission(callerSb, workspaceId, needed))) return json(req, { error: "Forbidden" }, 403);

  const serviceSb = createServiceClient();

  // Cross-tenant guard: resolve a supplied schema_id / field_id to a row
  // that actually belongs to workspace_id before any service-role write.
  async function ownedSchema(schemaId: unknown): Promise<{ id: string } | null> {
    if (typeof schemaId !== "string" || !schemaId) return null;
    const { data } = await serviceSb.from("workspace_intake_schemas").select("id").eq("id", schemaId).eq("workspace_id", workspaceId).maybeSingle();
    return data ?? null;
  }
  async function ownedField(fieldId: unknown): Promise<{ id: string; schema_id: string } | null> {
    if (typeof fieldId !== "string" || !fieldId) return null;
    const { data } = await serviceSb.from("workspace_intake_fields").select("id,schema_id").eq("id", fieldId).eq("workspace_id", workspaceId).maybeSingle();
    return data ?? null;
  }

  if (action === "list") {
    const { data: schemas } = await serviceSb.from("workspace_intake_schemas").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: true });
    const { data: fields } = await serviceSb.from("workspace_intake_fields").select("*").eq("workspace_id", workspaceId).order("sort_order", { ascending: true });
    return json(req, { schemas: schemas ?? [], fields: fields ?? [] });
  }

  if (action === "create_schema") {
    const name = str(body.name);
    if (!name || name.length > 200) return json(req, { error: "A schema name (1-200 characters) is required" }, 400);
    const description = str(body.description);
    if (description && description.length > 2000) return json(req, { error: "Description is too long" }, 400);

    const { count } = await serviceSb.from("workspace_intake_schemas").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    const isFirst = (count ?? 0) === 0;

    const { data, error } = await serviceSb.from("workspace_intake_schemas").insert({
      workspace_id: workspaceId, name, description, created_by: actorId,
      is_default: isFirst, is_active: true,
    }).select("id").single();
    if (error || !data) return json(req, { error: "Unable to create this schema" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "intake_schema_created", data.id, { name, is_default: isFirst });
    return json(req, { schema_id: data.id, is_default: isFirst });
  }

  if (action === "update_schema") {
    if (!(await ownedSchema(body.schema_id))) return json(req, { error: "Schema not found" }, 404);
    const updates: Record<string, unknown> = {};
    const name = str(body.name);
    if (name !== null) { if (name.length > 200) return json(req, { error: "Name is too long" }, 400); updates.name = name; }
    if ("description" in body) {
      const description = str(body.description);
      if (description && description.length > 2000) return json(req, { error: "Description is too long" }, 400);
      updates.description = description;
    }
    if (typeof body.is_active === "boolean") updates.is_active = body.is_active;
    if (Object.keys(updates).length === 0) return json(req, { error: "Nothing to update" }, 400);
    const { error } = await serviceSb.from("workspace_intake_schemas").update(updates).eq("id", body.schema_id as string);
    if (error) return json(req, { error: "Unable to update this schema" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "intake_schema_updated", body.schema_id as string, updates);
    return json(req, { ok: true });
  }

  if (action === "set_default_schema") {
    if (!(await ownedSchema(body.schema_id))) return json(req, { error: "Schema not found" }, 404);
    // Clear the current default first (the partial unique index allows only
    // one), then promote this one and force it active.
    await serviceSb.from("workspace_intake_schemas").update({ is_default: false }).eq("workspace_id", workspaceId).eq("is_default", true);
    const { error } = await serviceSb.from("workspace_intake_schemas").update({ is_default: true, is_active: true }).eq("id", body.schema_id as string);
    if (error) return json(req, { error: "Unable to set the default schema" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "intake_schema_set_default", body.schema_id as string);
    return json(req, { ok: true });
  }

  if (action === "delete_schema") {
    if (!(await ownedSchema(body.schema_id))) return json(req, { error: "Schema not found" }, 404);
    // ON DELETE SET NULL on inbox_conversations.intake_schema_id /
    // workspace_whatsapp_numbers.intake_schema_id means no conversation or
    // stored answer is lost - the conversation simply falls back to the
    // workspace default (or unstructured) next turn.
    const { error } = await serviceSb.from("workspace_intake_schemas").delete().eq("id", body.schema_id as string);
    if (error) return json(req, { error: "Unable to delete this schema" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "intake_schema_deleted", body.schema_id as string);
    return json(req, { ok: true });
  }

  if (action === "create_field") {
    if (!(await ownedSchema(body.schema_id))) return json(req, { error: "Schema not found" }, 404);
    const key = str(body.key)?.toLowerCase() ?? "";
    if (!KEY_RE.test(key)) return json(req, { error: "Field key must be lowercase letters, digits and underscores, starting with a letter" }, 400);
    const label = str(body.label);
    if (!label || label.length > 200) return json(req, { error: "A field label (1-200 characters) is required" }, 400);
    const questionText = str(body.question_text);
    if (!questionText || questionText.length > 500) return json(req, { error: "A question (1-500 characters) is required" }, 400);
    const fieldType = typeof body.field_type === "string" ? body.field_type : "";
    const required = body.required === true;
    const config = sanitizeConfig(body.config);
    const shapeError = validateFieldShape(fieldType, required, config);
    if (shapeError) return json(req, { error: shapeError }, 400);
    const helpText = str(body.help_text);
    if (helpText && helpText.length > 1000) return json(req, { error: "Help text is too long" }, 400);
    const sortOrder = typeof body.sort_order === "number" && Number.isFinite(body.sort_order) ? Math.trunc(body.sort_order) : 0;

    const { data, error } = await serviceSb.from("workspace_intake_fields").insert({
      schema_id: body.schema_id as string, workspace_id: workspaceId,
      key, label, question_text: questionText, field_type: fieldType,
      required, sort_order: sortOrder, help_text: helpText, config, is_active: true,
    }).select("id").single();
    if (error) {
      if (`${error.message}`.toLowerCase().includes("duplicate key")) return json(req, { error: "A field with that key already exists in this schema" }, 409);
      return json(req, { error: "Unable to create this field" }, 500);
    }
    await logActivity(serviceSb, workspaceId, actorId, "intake_field_created", data!.id, { schema_id: body.schema_id, key, field_type: fieldType });
    return json(req, { field_id: data!.id });
  }

  if (action === "update_field") {
    const owned = await ownedField(body.field_id);
    if (!owned) return json(req, { error: "Field not found" }, 404);
    if ("key" in body) return json(req, { error: "A field key cannot be changed once created" }, 400);
    const updates: Record<string, unknown> = {};
    const label = str(body.label);
    if (label !== null) { if (label.length > 200) return json(req, { error: "Label is too long" }, 400); updates.label = label; }
    const questionText = str(body.question_text);
    if (questionText !== null) { if (questionText.length > 500) return json(req, { error: "Question is too long" }, 400); updates.question_text = questionText; }
    if (typeof body.field_type === "string") {
      if (!isIntakeFieldType(body.field_type)) return json(req, { error: "Unsupported field type" }, 400);
      updates.field_type = body.field_type;
    }
    if (typeof body.required === "boolean") updates.required = body.required;
    if (typeof body.is_active === "boolean") updates.is_active = body.is_active;
    if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) updates.sort_order = Math.trunc(body.sort_order);
    if ("help_text" in body) {
      const helpText = str(body.help_text);
      if (helpText && helpText.length > 1000) return json(req, { error: "Help text is too long" }, 400);
      updates.help_text = helpText;
    }
    if ("config" in body) updates.config = sanitizeConfig(body.config);
    if (Object.keys(updates).length === 0) return json(req, { error: "Nothing to update" }, 400);
    const { error } = await serviceSb.from("workspace_intake_fields").update(updates).eq("id", owned.id);
    if (error) return json(req, { error: "Unable to update this field" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "intake_field_updated", owned.id, updates);
    return json(req, { ok: true });
  }

  if (action === "delete_field") {
    const owned = await ownedField(body.field_id);
    if (!owned) return json(req, { error: "Field not found" }, 404);
    // Historical answers keyed by this field remain untouched in every
    // intake_payload (jsonb, no FK). Deactivation is the softer option and
    // is available via update_field { is_active:false }.
    const { error } = await serviceSb.from("workspace_intake_fields").delete().eq("id", owned.id);
    if (error) return json(req, { error: "Unable to delete this field" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "intake_field_deleted", owned.id);
    return json(req, { ok: true });
  }

  if (action === "reorder_fields") {
    if (!(await ownedSchema(body.schema_id))) return json(req, { error: "Schema not found" }, 404);
    const ids = Array.isArray(body.field_ids) ? body.field_ids.filter((v): v is string => typeof v === "string") : [];
    if (!ids.length) return json(req, { error: "field_ids is required" }, 400);
    const { data: existing } = await serviceSb.from("workspace_intake_fields").select("id").eq("schema_id", body.schema_id as string);
    const existingIds = new Set((existing ?? []).map((r: { id: string }) => r.id));
    if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
      return json(req, { error: "field_ids must list every field in this schema exactly once" }, 400);
    }
    for (let i = 0; i < ids.length; i++) {
      await serviceSb.from("workspace_intake_fields").update({ sort_order: (i + 1) * 10 }).eq("id", ids[i]);
    }
    await logActivity(serviceSb, workspaceId, actorId, "intake_fields_reordered", body.schema_id as string, { count: ids.length });
    return json(req, { ok: true });
  }

  // action === "set_number_schema" - per-WhatsApp-number schema selection.
  const numberId = body.whatsapp_number_id;
  if (typeof numberId !== "string" || !numberId) return json(req, { error: "whatsapp_number_id is required" }, 400);
  const { data: numberRow } = await serviceSb.from("workspace_whatsapp_numbers").select("id").eq("id", numberId).eq("workspace_id", workspaceId).maybeSingle();
  if (!numberRow) return json(req, { error: "WhatsApp number not found" }, 404);
  let schemaId: string | null = null;
  if (body.schema_id !== null && body.schema_id !== undefined && body.schema_id !== "") {
    if (!(await ownedSchema(body.schema_id))) return json(req, { error: "Schema not found" }, 404);
    schemaId = body.schema_id as string;
  }
  const { error: numErr } = await serviceSb.from("workspace_whatsapp_numbers").update({ intake_schema_id: schemaId }).eq("id", numberId);
  if (numErr) return json(req, { error: "Unable to update the number's intake schema" }, 500);
  await logActivity(serviceSb, workspaceId, actorId, "intake_number_schema_set", numberId, { schema_id: schemaId });
  return json(req, { ok: true });
});
