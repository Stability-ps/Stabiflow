// Phase 3 - the single DB-bound resolver for "which intake schema governs
// this conversation?", shared by whatsapp-webhook (inbound AI turn) and
// inbox-actions (Ask Info / manual answer edit) so both entry points agree
// on the active schema and its ordered active fields.
//
// Precedence:
//   1. a schema already pinned to the conversation - honoured even if it
//      was later deactivated, so an in-flight conversation is never
//      disrupted by a settings change (PDF safe-schema-editing rule)
//   2. the conversation's WhatsApp number's explicit selection
//   3. the workspace default schema
// Returns null (every caller then no-ops) when nothing is configured or the
// resolved schema has no active fields.
import type { AnySupabaseClient } from "../contentAuth.ts";
import type { IntakeFieldDef, IntakeSchemaDef } from "./intakeSchema.ts";

export async function resolveActiveIntakeSchema(
  sb: AnySupabaseClient,
  workspaceId: string,
  opts: { conversationSchemaId: string | null; numberSchemaId: string | null },
): Promise<IntakeSchemaDef | null> {
  const pinned = !!opts.conversationSchemaId;
  let candidateId: string | null = opts.conversationSchemaId ?? opts.numberSchemaId ?? null;

  let resolvedId: string | null = null;
  if (candidateId) {
    const { data } = await sb
      .from("workspace_intake_schemas")
      .select("id,is_active")
      .eq("id", candidateId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (data && (pinned || data.is_active)) resolvedId = data.id;
  }
  if (!resolvedId) {
    const { data } = await sb
      .from("workspace_intake_schemas")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("is_default", true)
      .eq("is_active", true)
      .maybeSingle();
    if (data) resolvedId = data.id;
  }
  if (!resolvedId) return null;

  const { data: fields } = await sb
    .from("workspace_intake_fields")
    .select("key,label,question_text,field_type,required,sort_order,is_active,config")
    .eq("schema_id", resolvedId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (!fields || fields.length === 0) return null;
  return { id: resolvedId, fields: fields as IntakeFieldDef[] };
}
