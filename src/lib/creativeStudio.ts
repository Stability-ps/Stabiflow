import { supabase } from "@/integrations/supabase/client";

export type CreativeVariant = {
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
};

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  // Mirrors the same message/error-code preference used across
  // adCampaigns.ts/contentFunctions.ts/inbox.ts - workspaceSuspendedBody
  // and similar structured error bodies put the human text in `message`.
  if (error) {
    const parsed = data as { error?: string; message?: string } | null;
    const message = parsed?.message || parsed?.error || error.message || `${name} failed`;
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    const typed = data as { error: string; message?: string };
    throw new Error(typed.message || typed.error);
  }
  return data as T;
}

export function generateCreativeCopy(input: {
  workspaceId: string;
  businessContext: string;
  audience?: string;
  tone?: string;
  variantCount: number;
}) {
  return invoke<{ ok: true; variants: CreativeVariant[] }>("creative-studio-generate", {
    workspace_id: input.workspaceId,
    business_context: input.businessContext,
    audience: input.audience || undefined,
    tone: input.tone || undefined,
    variant_count: input.variantCount,
  });
}
