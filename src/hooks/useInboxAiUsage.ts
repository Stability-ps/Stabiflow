import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { INBOX_AI_CAP_KEY, INBOX_AI_FEATURE, utcMonthStartIso } from "@/lib/inboxAiBudget";

export type InboxAiUsage = {
  /** explicit workspace override, or null when the platform/env default applies */
  overrideCap: number | null;
  /** tokens used by Inbox AI this UTC month, or null when the caller can't
   *  read the usage ledger (manage_billing only) */
  usedThisMonth: number | null;
};

/** Reads the Inbox AI monthly cap override (workspace_billing.limits, any
 * member can read) and this month's Inbox AI token usage (ai_usage_events,
 * manage_billing/owner only - non-owners get usedThisMonth = null). */
export function useInboxAiUsage(workspaceId: string | null) {
  return useQuery({
    queryKey: ["inbox-ai-usage", workspaceId],
    enabled: !!workspaceId,
    queryFn: async (): Promise<InboxAiUsage> => {
      const wid = workspaceId as string;
      const { data: billing } = await supabase
        .from("workspace_billing").select("limits").eq("workspace_id", wid).maybeSingle();
      const rawCap = (billing?.limits as Record<string, unknown> | null)?.[INBOX_AI_CAP_KEY];
      const overrideCap = typeof rawCap === "number" && Number.isFinite(rawCap) ? rawCap
        : typeof rawCap === "string" && rawCap.trim() !== "" && Number.isFinite(Number(rawCap)) ? Number(rawCap)
        : null;

      const { data: rows, error } = await supabase
        .from("ai_usage_events")
        .select("total_tokens")
        .eq("workspace_id", wid)
        .eq("feature", INBOX_AI_FEATURE)
        .gte("created_at", utcMonthStartIso());
      const usedThisMonth = error
        ? null
        : (rows ?? []).reduce((sum: number, r: { total_tokens: number | null }) => sum + (r.total_tokens ?? 0), 0);

      return { overrideCap, usedThisMonth };
    },
  });
}

/** manage_billing-only (enforced by the RPC). Pass null to clear the
 * override and fall back to the platform default (the RPC's p_cap defaults
 * to NULL, so omitting it is the "clear" path). */
export async function updateInboxAiCap(workspaceId: string, cap: number | null) {
  const args = cap == null
    ? { p_workspace_id: workspaceId }
    : { p_workspace_id: workspaceId, p_cap: cap };
  const { error } = await supabase.rpc("set_workspace_inbox_ai_cap", args);
  if (error) throw new Error(error.message);
}
