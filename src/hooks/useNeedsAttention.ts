import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import type { NeedsAttentionItem } from "@/lib/needsAttention";
import { sortNeedsAttention } from "@/lib/needsAttention";

// Composes the Needs Attention list from existing, RLS-protected tables -
// NOT a persisted notifications store. Every query below is workspace-
// filtered AND gated by RLS on the exact permission the source module
// already requires (inbox_alerts -> inbox.view, ad_campaigns ->
// campaign.view, workspace_integrations -> integration.view,
// automation_runs -> automation.view_runs, leads -> lead.view). A member
// without a given permission simply gets an empty slice - never an error,
// never a leak.

const ALERT_TYPE_META: Record<string, { type: NeedsAttentionItem["type"]; title: string; action: string }> = {
  human_handoff: { type: "human_takeover", title: "Human takeover needed", action: "Open conversation" },
  customer_reply: { type: "customer_reply", title: "Customer replied", action: "Open conversation" },
  high_priority: { type: "priority_conversation", title: "Priority conversation waiting", action: "Open conversation" },
  message_failed: { type: "message_failed", title: "A message failed to send", action: "Open conversation" },
};

function toSeverity(raw: string | null): NeedsAttentionItem["severity"] {
  return raw === "critical" ? "critical" : raw === "warning" ? "warning" : "info";
}

export function useNeedsAttention(workspaceId: string | null) {
  const { currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canInbox = roleHasPermission(role, "inbox.view");
  const canCampaign = roleHasPermission(role, "campaign.view");
  const canIntegration = roleHasPermission(role, "integration.view");
  const canAutomationRuns = roleHasPermission(role, "automation.view_runs");
  const canLead = roleHasPermission(role, "lead.view");

  return useQuery({
    queryKey: ["needs-attention", workspaceId, role],
    enabled: !!workspaceId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<NeedsAttentionItem[]> => {
      const wid = workspaceId as string;
      const items: NeedsAttentionItem[] = [];

      const [alerts, failedCampaigns, integrations, failedRuns, unownedLeads] = await Promise.all([
        canInbox
          ? supabase
              .from("inbox_alerts")
              .select("id, alert_type, severity, title, conversation_id, created_at")
              .eq("workspace_id", wid)
              .eq("is_resolved", false)
              .order("created_at", { ascending: false })
              .limit(25)
          : Promise.resolve({ data: [], error: null }),
        canCampaign
          ? supabase
              .from("ad_campaigns")
              .select("id, name, updated_at, last_publish_error")
              .eq("workspace_id", wid)
              .eq("status", "failed")
              .order("updated_at", { ascending: false })
              .limit(10)
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
              .select("automation_id, status, finished_at, automations!automation_id(name)")
              .eq("workspace_id", wid)
              .eq("status", "failed")
              .gte("finished_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
              .order("finished_at", { ascending: false })
              .limit(50)
          : Promise.resolve({ data: [], error: null }),
        canLead
          ? supabase
              .from("leads")
              .select("id, contact_name, company_name, human_reference, created_at")
              .eq("workspace_id", wid)
              .eq("status", "active")
              .is("assigned_to", null)
              .eq("qualification_status", "unqualified")
              .lt("created_at", new Date(Date.now() - 86_400_000).toISOString())
              .order("created_at", { ascending: true })
              .limit(15)
          : Promise.resolve({ data: [], error: null }),
      ]);

      for (const a of (alerts.data || []) as Array<{ id: string; alert_type: string; severity: string | null; title: string | null; conversation_id: string; created_at: string }>) {
        const meta = ALERT_TYPE_META[a.alert_type];
        if (!meta) continue;
        items.push({
          id: `${meta.type}:${a.conversation_id}`,
          type: meta.type,
          severity: toSeverity(a.severity),
          title: meta.title,
          description: a.title || "A conversation needs your attention.",
          occurredAt: a.created_at,
          targetType: "conversation",
          targetId: a.conversation_id,
          actionPath: "/app/whatsapp/inbox",
          actionLabel: meta.action,
        });
      }

      for (const c of (failedCampaigns.data || []) as Array<{ id: string; name: string; updated_at: string; last_publish_error: { message?: string } | null }>) {
        items.push({
          id: `campaign_failed:${c.id}`,
          type: "campaign_failed",
          severity: "critical",
          title: "Campaign publish failed",
          description: c.last_publish_error?.message ? `${c.name} — ${c.last_publish_error.message}` : `${c.name} could not be published to Meta.`,
          occurredAt: c.updated_at,
          targetType: "campaign",
          targetId: c.id,
          actionPath: `/app/campaigns/${c.id}`,
          actionLabel: "Open campaign",
        });
      }

      const UNHEALTHY = new Set(["error", "reauthorization_required", "token_expired", "missing_permission", "needs_attention"]);
      for (const i of (integrations.data || []) as Array<{ id: string; provider: string; status: string; last_health_check_status: string | null; last_health_check_message: string | null; last_health_check_at: string | null; connected_at: string | null }>) {
        if (i.status !== "error" && !(i.last_health_check_status && UNHEALTHY.has(i.last_health_check_status))) continue;
        const providerName = i.provider === "whatsapp" ? "WhatsApp" : i.provider === "meta" ? "Meta" : i.provider;
        items.push({
          id: `integration_unhealthy:${i.id}`,
          type: "integration_unhealthy",
          severity: "warning",
          title: `${providerName} connection needs attention`,
          description: i.last_health_check_message || "The last health check reported a problem with this connection.",
          occurredAt: i.last_health_check_at || i.connected_at || new Date().toISOString(),
          targetType: "integration",
          targetId: i.id,
          actionPath: i.provider === "whatsapp" ? "/app/whatsapp/settings" : "/app/integrations",
          actionLabel: "Check connection",
        });
      }

      const runsByAutomation = new Map<string, { name: string; count: number; last: string }>();
      for (const r of (failedRuns.data || []) as Array<{ automation_id: string; finished_at: string | null; automations: { name: string } | { name: string }[] | null }>) {
        const name = Array.isArray(r.automations) ? r.automations[0]?.name : r.automations?.name;
        const prev = runsByAutomation.get(r.automation_id);
        const finished = r.finished_at || new Date().toISOString();
        if (!prev) runsByAutomation.set(r.automation_id, { name: name || "An automation", count: 1, last: finished });
        else {
          prev.count += 1;
          if (new Date(finished).getTime() > new Date(prev.last).getTime()) prev.last = finished;
        }
      }
      for (const [automationId, agg] of runsByAutomation) {
        items.push({
          id: `automation_failed:${automationId}`,
          type: "automation_failed",
          severity: "warning",
          title: "Automation failed",
          description: `${agg.name} failed to run ${agg.count} time${agg.count === 1 ? "" : "s"} in the last 7 days.`,
          occurredAt: agg.last,
          targetType: "automation",
          targetId: automationId,
          actionPath: "/app/automations",
          actionLabel: "Review automation",
        });
      }

      for (const l of (unownedLeads.data || []) as Array<{ id: string; contact_name: string | null; company_name: string | null; human_reference: string; created_at: string }>) {
        const who = l.contact_name || l.company_name || l.human_reference;
        items.push({
          id: `lead_unowned:${l.id}`,
          type: "lead_unowned",
          severity: "warning",
          title: "Lead is waiting to be picked up",
          description: `${who} came in over a day ago and still has no owner.`,
          occurredAt: l.created_at,
          targetType: "lead",
          targetId: l.id,
          actionPath: "/app/leads",
          actionLabel: "Assign lead",
        });
      }

      return sortNeedsAttention(items);
    },
  });
}
