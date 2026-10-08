import { supabase } from "@/integrations/supabase/client";
import type { AttributionConfidence, AttributionTargetType, TouchSummaryRow } from "@/hooks/useAttribution";

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const message = (data as { error?: string } | null)?.error || error.message || `${name} failed`;
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export function overrideAttribution(workspaceId: string, params: { targetType: Extract<AttributionTargetType, "lead" | "opportunity" | "customer">; targetId: string; source: string; reason: string }) {
  return invoke<{ ok: true }>("leads-actions", {
    workspace_id: workspaceId,
    action: "override_attribution",
    target_type: params.targetType,
    target_id: params.targetId,
    source: params.source,
    reason: params.reason,
  });
}

export function recordRevenue(workspaceId: string, params: {
  amountMinor: number; currency: string; eventType: "sale" | "payment" | "contract_value" | "adjustment" | "refund";
  customerId?: string | null; opportunityId?: string | null; leadId?: string | null; reference?: string; occurredAt?: string;
}) {
  return invoke<{ revenue_event: unknown }>("revenue-actions", {
    workspace_id: workspaceId,
    action: "record",
    amount_minor: params.amountMinor,
    currency: params.currency,
    event_type: params.eventType,
    customer_id: params.customerId,
    opportunity_id: params.opportunityId,
    lead_id: params.leadId,
    reference: params.reference,
    occurred_at: params.occurredAt,
  });
}

export function editRevenueReference(workspaceId: string, revenueEventId: string, reference: string) {
  return invoke<{ ok: true }>("revenue-actions", { workspace_id: workspaceId, action: "edit_reference", revenue_event_id: revenueEventId, reference });
}

export function confidenceLabel(confidence: AttributionConfidence | null): string {
  switch (confidence) {
    case "exact": return "Exact";
    case "high": return "High confidence";
    case "medium": return "Medium confidence";
    case "low": return "Low confidence";
    default: return "Unknown confidence";
  }
}

const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta (Facebook/Instagram) ad",
  whatsapp_direct: "Direct WhatsApp message",
  manual: "Manually assigned",
};

export function sourceLabel(source: string | null): string {
  if (!source) return "Unknown";
  return SOURCE_LABELS[source] || source;
}

/**
 * A one-sentence, honest explanation of why a touchpoint has the source it
 * has - never claims more certainty than the underlying evidence supports.
 * Mirrors the exact 3 shapes the Phase G brief calls out: a resolved paid
 * touch, a manual override, and organic/unknown.
 */
export function explainTouch(row: TouchSummaryRow | null): string {
  if (!row) return "No attribution evidence exists for this record - it is organic, direct, or was created manually with no known source.";
  if (row.platform === "manual") {
    return "This source was manually assigned by a staff member.";
  }
  if (row.source_type === "paid" && row.campaign_id) {
    return `This entered through a Meta ad tied to a campaign StabiFlow published - confidence: ${confidenceLabel(row.attribution_confidence).toLowerCase()}.`;
  }
  if (row.source_type === "paid") {
    return `A Meta ad referral was present, but it did not match a campaign StabiFlow published (the ad may have been created outside this platform) - confidence: ${confidenceLabel(row.attribution_confidence).toLowerCase()}.`;
  }
  if (row.source_type === "direct") {
    return "This started as a direct WhatsApp message with no ad referral - confirmed organic, not just unknown.";
  }
  return `Source: ${sourceLabel(row.source)} - confidence: ${confidenceLabel(row.attribution_confidence).toLowerCase()}.`;
}
