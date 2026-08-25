// Discovery-time upsert for a provider resource row (Phase C instructions
// #5/#18/#22).
//
// Two rules this enforces on every call:
//   1. A newly-discovered resource is inserted INACTIVE (is_active=false).
//      Discovery never auto-activates anything - a workspace admin must
//      explicitly select a Page/Instagram account/Ad account/WhatsApp
//      number before StabiFlow uses it (instruction #5). An UPDATE of an
//      already-known resource never touches is_active, so a previously
//      selected resource stays selected across repeated discovery runs
//      (instruction #18).
//   2. A provider resource id (Facebook Page id, IG business account id,
//      ad account id, WhatsApp phone_number_id) is unique across the WHOLE
//      product, not per-workspace (see the *_key unique indexes in
//      20260824060400_workspace_integrations.sql). If a discovery run for
//      Workspace A finds a resource id that's already connected to
//      Workspace B, this is a COLLISION, not a re-discovery - the row is
//      never silently reassigned. It's skipped and reported back to the
//      caller so an operator can investigate (instruction #22: "define and
//      test the intended uniqueness rules... defer controlled sharing
//      rather than weakening V1 isolation").
// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

export type UpsertResult = { id: string | null; wasNew: boolean; collision: boolean };

export async function upsertDiscoveredResource(
  sb: AnySupabaseClient,
  table: string,
  uniqueColumn: string,
  uniqueValue: string,
  workspaceId: string,
  insertRow: Record<string, unknown>,
  updateRow: Record<string, unknown>,
): Promise<UpsertResult> {
  const { data: existing } = await sb.from(table).select("id, workspace_id").eq(uniqueColumn, uniqueValue).maybeSingle();

  if (existing) {
    if (existing.workspace_id !== workspaceId) {
      return { id: null, wasNew: false, collision: true };
    }
    await sb.from(table).update(updateRow).eq("id", existing.id);
    return { id: existing.id, wasNew: false, collision: false };
  }

  const { data: created, error } = await sb
    .from(table)
    .insert({ ...insertRow, is_active: false })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation: a concurrent discovery run (or a genuine
    // collision) beat us to it between the select above and this insert.
    // Re-resolve rather than assume either outcome.
    if (error.code === "23505") {
      const { data: raced } = await sb.from(table).select("id, workspace_id").eq(uniqueColumn, uniqueValue).maybeSingle();
      if (raced && raced.workspace_id === workspaceId) {
        await sb.from(table).update(updateRow).eq("id", raced.id);
        return { id: raced.id, wasNew: false, collision: false };
      }
      return { id: null, wasNew: false, collision: true };
    }
    throw new Error(error.message);
  }

  return { id: created.id, wasNew: true, collision: false };
}
