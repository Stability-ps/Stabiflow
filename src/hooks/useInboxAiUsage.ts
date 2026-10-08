import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { INBOX_AI_CAP_KEY, INBOX_AI_FEATURE, utcMonthStartIso } from "@/lib/inboxAiBudget";

export type InboxAiUsage = {
  /** the workspace's own (lower) cap, or null when the full plan cap applies */
  overrideCap: number | null;
  /** the most this workspace's plan allows; a workspace cap can only be lower */
  planCap: number | null;
  /** what is enforced: the smaller of planCap and overrideCap */
  effectiveCap: number | null;
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
      let overrideCap: number | null = null;
      let planCap: number | null = null;
      let effectiveCap: number | null = null;
      const { data: capRows, error: capError } = await supabase.rpc("get_workspace_inbox_ai_cap", { p_workspace_id: wid });
      if (!capError && Array.isArray(capRows) && capRows[0]) {
        const row = capRows[0] as { plan_cap: number | null; self_cap: number | null; effective_cap: number | null };
        planCap = row.plan_cap == null ? null : Number(row.plan_cap);
        overrideCap = row.self_cap == null ? null : Number(row.self_cap);
        effectiveCap = row.effective_cap == null ? null : Number(row.effective_cap);
      } else {
        // Before the self-cap migration: the platform limit, read-only here.
        const { data: billing } = await supabase
          .from("workspace_billing").select("limits").eq("workspace_id", wid).maybeSingle();
        const rawCap = (billing?.limits as Record<string, unknown> | null)?.[INBOX_AI_CAP_KEY];
        effectiveCap = typeof rawCap === "number" && Number.isFinite(rawCap) ? rawCap
          : typeof rawCap === "string" && rawCap.trim() !== "" && Number.isFinite(Number(rawCap)) ? Number(rawCap)
          : null;
      }

      const { data: rows, error } = await supabase
        .from("ai_usage_events")
        .select("total_tokens")
        .eq("workspace_id", wid)
        .eq("feature", INBOX_AI_FEATURE)
        .gte("created_at", utcMonthStartIso());
      const usedThisMonth = error
        ? null
        : (rows ?? []).reduce((sum: number, r: { total_tokens: number | null }) => sum + (r.total_tokens ?? 0), 0);

      return { overrideCap, planCap, effectiveCap, usedThisMonth };
    },
  });
}

/** manage_billing-only (enforced by the RPC). The cap can only be at or
 * below the plan cap; pass null to clear it and use the full plan cap (the
 * RPC's p_cap defaults to NULL, so omitting it is the "clear" path). */
export async function updateInboxAiCap(workspaceId: string, cap: number | null) {
  const args = cap == null
    ? { p_workspace_id: workspaceId }
    : { p_workspace_id: workspaceId, p_cap: cap };
  const { error } = await supabase.rpc("set_workspace_inbox_ai_cap", args);
  if (error) throw new Error(error.message);
}
