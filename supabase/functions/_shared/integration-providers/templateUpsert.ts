// Discovery-time upsert for a whatsapp_message_templates row (Phase L-1).
// Deliberately separate from resourceUpsert.ts's upsertDiscoveredResource:
// that helper inserts every new row as is_active=false (a human must
// explicitly select a Page/number before StabiFlow uses it) - templates
// have no such activation step. A template becomes eligible to send the
// moment Meta approves it; StabiFlow just mirrors whatever provider_status
// Meta reports on every sync, so an update always refreshes
// provider_status/components/last_synced_at, never leaves them stale.
//
// Same collision discipline as every other provider-resource table
// though: provider_template_id is unique across the whole product (Meta's
// own id), and a collision (found under a different workspace) is skipped,
// never silently reassigned.
// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

export type TemplateUpsertResult = { id: string | null; wasNew: boolean; collision: boolean };

export async function upsertDiscoveredTemplate(
  sb: AnySupabaseClient,
  workspaceId: string,
  integrationId: string,
  wabaId: string,
  template: { providerTemplateId: string; name: string; language: string; category: string | null; status: string; components: unknown[] },
): Promise<TemplateUpsertResult> {
  const { data: existing } = await sb
    .from("whatsapp_message_templates")
    .select("id, workspace_id")
    .eq("provider_template_id", template.providerTemplateId)
    .maybeSingle();

  const updateRow = {
    name: template.name,
    language: template.language,
    category: template.category,
    provider_status: template.status,
    components: template.components,
    last_synced_at: new Date().toISOString(),
  };

  if (existing) {
    if (existing.workspace_id !== workspaceId) {
      return { id: null, wasNew: false, collision: true };
    }
    await sb.from("whatsapp_message_templates").update(updateRow).eq("id", existing.id);
    return { id: existing.id, wasNew: false, collision: false };
  }

  const { data: created, error } = await sb
    .from("whatsapp_message_templates")
    .insert({ workspace_id: workspaceId, integration_id: integrationId, waba_id: wabaId, provider_template_id: template.providerTemplateId, ...updateRow })
    .select("id")
    .single();

  if (error) {
    // 23505 = a concurrent sync (or a genuine collision) beat us to it
    // between the select above and this insert - re-resolve rather than
    // assume either outcome, matching upsertDiscoveredResource's own
    // race handling.
    if (error.code === "23505") {
      const { data: raced } = await sb.from("whatsapp_message_templates").select("id, workspace_id").eq("provider_template_id", template.providerTemplateId).maybeSingle();
      if (raced && raced.workspace_id === workspaceId) {
        await sb.from("whatsapp_message_templates").update(updateRow).eq("id", raced.id);
        return { id: raced.id, wasNew: false, collision: false };
      }
      return { id: null, wasNew: false, collision: true };
    }
    throw new Error(error.message);
  }

  return { id: created.id, wasNew: true, collision: false };
}
