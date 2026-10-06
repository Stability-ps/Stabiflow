// I/O half of the Inbox AI budget (the pure rules live in inboxAiBudget.ts).
// Moved out of whatsapp-webhook so every Inbox AI caller - automatic replies,
// voice transcription, localization and staff agent-assist - enforces the
// ONE per-workspace monthly allowance through the same code path.
import type { AnySupabaseClient } from "../contentAuth.ts";
import { getPlatformTokenUsageSince, getWorkspaceFeaturesTokenUsageSince } from "../flowAi/usage.ts";
import { decideInboxAiBudget, INBOX_AI_CAP_KEY, resolveInboxAiCap, utcDayStartIso, utcMonthStartIso, type InboxAiBudgetDecision } from "./inboxAiBudget.ts";

// Phase 7 + 10: the one per-workspace monthly Inbox AI budget decision.
// `features` is the set of ai_usage_events.feature values that count toward
// the SAME allowance - Inbox AI replies AND (Phase 10) voice-note
// transcription, so transcription never gets a second uncapped budget.
export async function resolveInboxAiBudget(
  sb: AnySupabaseClient,
  workspaceId: string,
  features: string[],
): Promise<InboxAiBudgetDecision> {
  // Canonical plan-aware cap; keep the legacy resolver only as a
  // deployment fallback if the database migration is not available yet.
  const { data: planCap, error: planCapError } = await sb.rpc("workspace_ai_token_cap", {
    p_workspace_id: workspaceId,
    p_feature: "whatsapp_inbox_ai",
  });
  let inboxCap: number;
  if (!planCapError && Number(planCap) > 0) {
    inboxCap = Number(planCap);
  } else {
    const { data: billingRow } = await sb.from("workspace_billing").select("limits").eq("workspace_id", workspaceId).maybeSingle();
    inboxCap = resolveInboxAiCap(
      (billingRow?.limits as Record<string, unknown> | null)?.[INBOX_AI_CAP_KEY],
      Deno.env.get("FLOW_AI_DEFAULT_WORKSPACE_MONTHLY_TOKEN_LIMIT"),
    );
  }
  const inboxUsed = await getWorkspaceFeaturesTokenUsageSince(sb, workspaceId, features, utcMonthStartIso(new Date()));
  const platformCeilingRaw = Number(Deno.env.get("FLOW_AI_PLATFORM_DAILY_TOKEN_CEILING")?.trim());
  const platformCeiling = Number.isFinite(platformCeilingRaw) && platformCeilingRaw > 0 ? platformCeilingRaw : null;
  const platformUsed = platformCeiling !== null ? await getPlatformTokenUsageSince(sb, utcDayStartIso(new Date())) : null;
  return decideInboxAiBudget({ workspaceUsed: inboxUsed, workspaceCap: inboxCap, platformUsed, platformCeiling });
}

