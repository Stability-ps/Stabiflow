import { useQuery } from "@tanstack/react-query";
import { listIntakeSchemas, type IntakeFieldRow } from "@/lib/intake";
import type { IntakeSchema } from "@/lib/intakeSchema";

export type IntakeSchemasResult = { schemas: IntakeSchema[]; fields: IntakeFieldRow[] };

/** All of a workspace's intake schemas plus every field, in one call
 * (intake-actions `list`). RLS still re-checks intake.view server-side. */
export function useIntakeSchemas(workspaceId: string | null) {
  return useQuery({
    queryKey: ["intake-schemas", workspaceId],
    queryFn: (): Promise<IntakeSchemasResult> => listIntakeSchemas(workspaceId as string),
    enabled: !!workspaceId,
  });
}

/** The fields (schema + ordered active field defs) that govern a given
 * conversation - resolved client-side from the schemas list: an explicit
 * conversation pin wins, otherwise the workspace default. Mirrors
 * _shared/inbox/intakeResolve.ts (minus the per-number selection, which the
 * conversation row does not carry). */
export function resolveConversationSchema(
  data: IntakeSchemasResult | undefined,
  conversationSchemaId: string | null,
): { schema: IntakeSchema | null; fields: IntakeFieldRow[] } {
  if (!data) return { schema: null, fields: [] };
  const pinned = conversationSchemaId ? data.schemas.find((s) => s.id === conversationSchemaId) ?? null : null;
  const schema = pinned ?? data.schemas.find((s) => s.is_default && s.is_active) ?? null;
  if (!schema) return { schema: null, fields: [] };
  const fields = data.fields
    .filter((f) => f.schema_id === schema.id && f.is_active !== false)
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
  return { schema, fields };
}
