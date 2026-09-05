import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import type { NeedsAttentionItem, NeedsAttentionKind } from "@/lib/needsAttention";
import { dedupeNeedsAttention, sortNeedsAttention } from "@/lib/needsAttention";
import { computeSlaState, type SlaSettings } from "@/lib/slaState";

// Composes the Needs Attention list from existing, RLS-protected tables -
// NOT a persisted notifications store. Every query is workspace-filtered
// AND gated by RLS on the exact permission its source module already
// requires. A member without a permission simply gets an empty slice.
//
// Resilience (audit M10): each source is settled independently -
// Promise.allSettled - so one failing query degrades to "unavailable" for
// that category, never blanks the whole panel.
//
// Staleness (audit M11): human-handoff / high-priority alert items are
// filtered against the CURRENT conversation state, so a conversation
// returned to AI (or de-prioritised) drops off immediately without a
// second resolution model.

export type NeedsAttentionResult = {
  items: NeedsAttentionItem[];
  isLoading: boolean;
  /** at least one source query failed; the panel still renders the rest */
  partialFailure: boolean;
};

const ALERT_META: Record<string, { kind: NeedsAttentionKind; title: string }> = {
  human_handoff: { kind: "human_takeover", title: "Human takeover needed" },
  customer_reply: { kind: "customer_reply", title: "Customer replied" },
  high_priority: { kind: "priority_conversation", title: "Priority conversation waiting" },
  message_failed: { kind: "message_failed", title: "A message failed to send" },
  handoff_sla_overdue: { kind: "handoff_sla_overdue", title: "Customer waiting for a human response" },
  ai_usage_limit_reached: { kind: "ai_usage_limit_reached", title: "Inbox AI paused - workspace usage limit reached" },
};

function toSeverity(raw: string | null): NeedsAttentionItem["severity"] {
  return raw === "critical" ? "critical" : raw === "warning" ? "warning" : "info";
}

type Settled<T> = { data: T } | { failed: true };
function value<T>(r: PromiseSettledResult<{ data: T | null; error: unknown }>, fallback: T): Settled<T> {
  if (r.status === "fulfilled" && !r.value.error) return { data: (r.value.data ?? fallback) as T };
  return { failed: true };
}

export function useNeedsAttention(workspaceId: string | null): NeedsAttentionResult {
  const { currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canInbox = roleHasPermission(role, "inbox.view");
  const canCampaign = roleHasPermission(role, "campaign.view");
  const canIntegration = roleHasPermission(role, "integration.view");
  const canAutomationRuns = roleHasPermission(role, "automation.view_runs");
  const canLead = roleHasPermission(role, "lead.view");
  // action permissions (audit M12)
  const canManageIntegration = roleHasPermission(role, "integration.manage");
  const canEditAutomation = roleHasPermission(role, "automation.edit");
  const canAssignLead = roleHasPermission(role, "lead.assign");

  const q = useQuery({
    queryKey: ["needs-attention", workspaceId, role],
    enabled: !!workspaceId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ items: NeedsAttentionItem[]; partialFailure: boolean }> => {
      const wid = workspaceId as string;
      const items: NeedsAttentionItem[] = [];
      let partialFailure = false;

      const settled = await Promise.allSettled([
        canInbox
          ? supabase
              .from("inbox_alerts")
              .select("id, alert_type, severity, title, conversation_id, message_id, created_at")
              .eq("workspace_id", wid).eq("is_resolved", false)
              .order("created_at", { ascending: false }).limit(25)
          : Promise.resolve({ data: [], error: null }),
        canCampaign
          ? supabase
              .from("ad_campaigns")
              .select("id, name, updated_at, last_publish_error")
              .eq("workspace_id", wid).eq("status", "failed")
              .order("updated_at", { ascending: false }).limit(10)
          : Promise.resolve({ data: [], error: null }),
        canIntegration
          ? supabase
              .from("workspace_integrations")
              .select("id, provider, status, last_health_check_status, last_health_check_message, last_health_check_at, connected_at")
              .eq("workspace_id", wid)
          : Promise.resolve({ data: [], error: null }),
        canAutomationRuns
          ? supabase
              .from("automation_runs")
              .select("id, automation_id, status, finished_at, automations!automation_id(name)")
              .eq("workspace_id", wid).eq("status", "failed")
              .gte("finished_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
              .order("finished_at", { ascending: false }).limit(50)
          : Promise.resolve({ data: [], error: null }),
        canLead
          ? supabase
              .from("leads")
              .select("id, contact_name, company_name, human_reference, created_at")
              .eq("workspace_id", wid).eq("status", "active").is("assigned_to", null)
              .eq("qualification_status", "unqualified")
              .lt("created_at", new Date(Date.now() - 86_400_000).toISOString())
              .order("created_at", { ascending: true }).limit(15)
          : Promise.resolve({ data: [], error: null }),
        canInbox
          ? supabase.from("workspace_settings").select("handoff_sla_minutes, handoff_sla_enabled").eq("workspace_id", wid).limit(1)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const alerts = value(settled[0] as PromiseSettledResult<{ data: unknown[] | null; error: unknown }>, []);
      const failedCampaigns = value(settled[1] as PromiseSettledResult<{ data: unknown[] | null; error: unknown }>, []);
      const integrations = value(settled[2] as PromiseSettledResult<{ data: unknown[] | null; error: unknown }>, []);
      const failedRuns = value(settled[3] as PromiseSettledResult<{ data: unknown[] | null; error: unknown }>, []);
      const unownedLeads = value(settled[4] as PromiseSettledResult<{ data: unknown[] | null; error: unknown }>, []);
      const slaRows = value(settled[5] as PromiseSettledResult<{ data: unknown[] | null; error: unknown }>, []);
      const slaRow = ("data" in slaRows && slaRows.data.length > 0)
        ? (slaRows.data[0] as { handoff_sla_minutes?: number; handoff_sla_enabled?: boolean })
        : null;
      const slaSettings: SlaSettings = {
        handoff_sla_minutes: slaRow?.handoff_sla_minutes ?? 10,
        handoff_sla_enabled: slaRow?.handoff_sla_enabled ?? true,
      };
      for (const s of [alerts, failedCampaigns, integrations, failedRuns, unownedLeads]) {
        if ("failed" in s) partialFailure = true;
      }

      // --- inbox alerts, filtered against current conversation state ------
      if ("data" in alerts && alerts.data.length > 0) {
        const rows = alerts.data as Array<{ id: string; alert_type: string; severity: string | null; title: string | null; conversation_id: string; message_id: string | null; created_at: string }>;
        const convIds = [...new Set(rows.map((r) => r.conversation_id))];

        // Phase 9: a message_failed alert only warrants staff attention once
        // StabiFlow has actually stopped trying - i.e. the message is
        // dead-lettered. A transient failure with a retry still scheduled is
        // self-healing and must not surface here. Re-check live message state.
        const failedMsgIds = [...new Set(rows.filter((r) => r.alert_type === "message_failed" && r.message_id).map((r) => r.message_id as string))];
        type MsgS = { dead_lettered_at: string | null; dead_letter_reason: string | null; retry_count: number | null };
        let msgState = new Map<string, MsgS>();
        if (failedMsgIds.length > 0) {
          try {
            const { data: msgs, error } = await supabase
              .from("inbox_messages")
              .select("id, dead_lettered_at, dead_letter_reason, retry_count")
              .eq("workspace_id", wid).in("id", failedMsgIds);
            if (error) throw error;
            msgState = new Map(((msgs || []) as Array<MsgS & { id: string }>).map((m) => [m.id, m]));
          } catch {
            partialFailure = true;
          }
        }
        type ConvS = { status: string; priority_level: string; ai_enabled: boolean; inbox_status: string; human_handoff_requested_at: string | null; last_staff_reply_at: string | null; assigned_staff_name: string | null };
        let convState = new Map<string, ConvS>();
        try {
          const { data: convs, error } = await supabase
            .from("inbox_conversations")
            .select("id, status, priority_level, ai_enabled, inbox_status, human_handoff_requested_at, last_staff_reply_at, assigned_staff_name")
            .eq("workspace_id", wid).in("id", convIds);
          if (error) throw error;
          convState = new Map(((convs || []) as Array<ConvS & { id: string }>).map((c) => [c.id, c]));
        } catch {
          partialFailure = true;
        }

        for (const a of rows) {
          const meta = ALERT_META[a.alert_type];
          if (!meta) continue;
          const cs = convState.get(a.conversation_id);
          // Stale-state filter: a conversation that is no longer in human
          // handoff (returned to AI) needs no takeover; one no longer
          // high/urgent needs no priority attention.
          if (meta.kind === "human_takeover" && cs && (cs.status !== "human_handoff" || cs.ai_enabled)) continue;
          if (meta.kind === "priority_conversation" && cs && cs.priority_level !== "high" && cs.priority_level !== "urgent") continue;
          let failedMessageDescription: string | null = null;
          if (meta.kind === "message_failed" && a.message_id) {
            const ms = msgState.get(a.message_id);
            // Known message, still retrying (or already recovered) - not an
            // operator problem yet. Unknown message: keep the alert rather
            // than hide a real failure behind a missing lookup.
            if (ms && !ms.dead_lettered_at) continue;
            if (ms) {
              const attempts = (ms.retry_count ?? 0) + 1;
              failedMessageDescription =
                `WhatsApp message could not be delivered after ${attempts} attempt${attempts === 1 ? "" : "s"}` +
                (ms.dead_letter_reason ? ` (${ms.dead_letter_reason.replace(/_/g, " ")})` : "") + ".";
            }
          }
          let slaDescription: string | null = null;
          if (meta.kind === "handoff_sla_overdue") {
            if (!cs) continue;
            const st = computeSlaState(cs, slaSettings);
            if (st.phase !== "overdue") continue; // recovered - stale item drops off
            slaDescription = `${st.minutesOverdue} min overdue` + (cs.assigned_staff_name ? ` · waiting for ${cs.assigned_staff_name}` : "");
          }
          items.push({
            id: `alert:${a.id}`,
            kind: meta.kind,
            severity: toSeverity(a.severity),
            title: meta.title,
            description: slaDescription || failedMessageDescription || a.title || "A conversation needs your attention.",
            occurredAt: a.created_at,
            targetType: "conversation",
            targetId: a.conversation_id,
            actionPath: "/app/whatsapp/inbox",
            actionLabel: "Open conversation",
            canAct: true, // navigation only
          });
        }
      }

      if ("data" in failedCampaigns) {
        for (const c of failedCampaigns.data as Array<{ id: string; name: string; updated_at: string; last_publish_error: { message?: string } | null }>) {
          items.push({
            id: `campaign:${c.id}`,
            kind: "campaign_failed",
            severity: "critical",
            title: "Campaign publish failed",
            description: c.last_publish_error?.message ? `${c.name} — ${c.last_publish_error.message}` : `${c.name} could not be published to Meta.`,
            occurredAt: c.updated_at,
            targetType: "campaign",
            targetId: c.id,
            actionPath: `/app/campaigns/${c.id}`,
            actionLabel: "Open campaign",
            canAct: true, // navigation only
          });
        }
      }

      const UNHEALTHY = new Set(["error", "reauthorization_required", "token_expired", "missing_permission", "needs_attention"]);
      if ("data" in integrations) {
        for (const i of integrations.data as Array<{ id: string; provider: string; status: string; last_health_check_status: string | null; last_health_check_message: string | null; last_health_check_at: string | null; connected_at: string | null }>) {
          if (i.status !== "error" && !(i.last_health_check_status && UNHEALTHY.has(i.last_health_check_status))) continue;
          const providerName = i.provider === "whatsapp" ? "WhatsApp" : i.provider === "meta" ? "Meta" : i.provider;
          items.push({
            id: `integration:${i.id}`,
            kind: "integration_unhealthy",
            severity: "warning",
            title: `${providerName} connection needs attention`,
            description: i.last_health_check_message || "The last health check reported a problem with this connection.",
            // never a synthesised "now" (audit M14)
            occurredAt: i.last_health_check_at || i.connected_at || null,
            targetType: "integration",
            targetId: i.id,
            actionPath: i.provider === "whatsapp" ? "/app/whatsapp/settings" : "/app/integrations",
            actionLabel: canManageIntegration ? "Manage connection" : "View",
            canAct: canManageIntegration,
          });
        }
      }

      if ("data" in failedRuns) {
        const runsByAutomation = new Map<string, { name: string; count: number; last: string | null }>();
        for (const r of failedRuns.data as Array<{ automation_id: string; finished_at: string | null; automations: { name: string } | { name: string }[] | null }>) {
          const name = Array.isArray(r.automations) ? r.automations[0]?.name : r.automations?.name;
          const prev = runsByAutomation.get(r.automation_id);
          if (!prev) runsByAutomation.set(r.automation_id, { name: name || "An automation", count: 1, last: r.finished_at });
          else {
            prev.count += 1;
            if (r.finished_at && (!prev.last || new Date(r.finished_at).getTime() > new Date(prev.last).getTime())) prev.last = r.finished_at;
          }
        }
        for (const [automationId, agg] of runsByAutomation) {
          items.push({
            id: `automation:${automationId}`,
            kind: "automation_failed",
            severity: "warning",
            title: "Automation failed",
            description: `${agg.name} failed to run ${agg.count} time${agg.count === 1 ? "" : "s"} in the last 7 days.`,
            occurredAt: agg.last,
            targetType: "automation",
            targetId: automationId,
            actionPath: "/app/automations",
            actionLabel: canEditAutomation ? "Review automation" : "View runs",
            canAct: canEditAutomation,
          });
        }
      }

      if ("data" in unownedLeads) {
        for (const l of unownedLeads.data as Array<{ id: string; contact_name: string | null; company_name: string | null; human_reference: string; created_at: string }>) {
          const who = l.contact_name || l.company_name || l.human_reference;
          items.push({
            id: `lead:${l.id}`,
            kind: "lead_unowned",
            severity: "warning",
            title: "Lead is waiting to be picked up",
            description: `${who} came in over a day ago and still has no owner.`,
            occurredAt: l.created_at,
            targetType: "lead",
            targetId: l.id,
            actionPath: "/app/leads",
            actionLabel: canAssignLead ? "Assign lead" : "View lead",
            canAct: canAssignLead,
          });
        }
      }

      return { items: sortNeedsAttention(dedupeNeedsAttention(items)), partialFailure };
    },
  });

  return {
    items: q.data?.items ?? [],
    isLoading: q.isLoading,
    partialFailure: q.data?.partialFailure ?? false,
  };
}
