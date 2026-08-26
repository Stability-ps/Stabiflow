import { supabase } from "@/integrations/supabase/client";

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

export type ReadinessIssue = { code: string; message: string; severity: "error" | "warning" };

export function checkCampaignReadiness(campaignId: string) {
  return invoke<{ ok: true; ready: boolean; issues: ReadinessIssue[] }>("ad-campaigns-readiness", { campaign_id: campaignId });
}

// A fresh idempotency key per Publish attempt (Phase 6 instruction #14) -
// minted once when the confirmation step is first shown, not per network
// call, so a frontend retry of the SAME attempt reuses it and a genuinely
// NEW click (after a real failure) gets a new one.
export function newPublishIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function publishCampaign(campaignId: string, idempotencyKey: string) {
  return invoke<{
    ok: boolean;
    outcome?: "success" | "partial" | "failed";
    replay?: boolean;
    operation?: { id: string; status: string; steps: Array<{ step: string; status: string; error?: unknown }> };
    campaign?: { id: string; status: string; external_campaign_id: string | null; last_publish_error?: unknown };
    error?: string;
    issues?: ReadinessIssue[];
  }>("ad-campaigns-publish", { campaign_id: campaignId, idempotency_key: idempotencyKey });
}

export function pauseCampaign(campaignId: string) {
  return invoke<{ ok: true; status: string }>("ad-campaigns-pause-resume", { campaign_id: campaignId, action: "pause" });
}

export function resumeCampaign(campaignId: string) {
  return invoke<{ ok: true; status: string }>("ad-campaigns-pause-resume", { campaign_id: campaignId, action: "resume" });
}

export type ResourceHealth = { type: string; id: string; label: string; healthy: boolean; category?: string; message?: string };

export function checkConnectionHealth(workspaceId: string) {
  return invoke<{ ok: true; integration: { connected: boolean; healthy?: boolean; category?: string }; resources: ResourceHealth[] }>(
    "ad-connection-health",
    { workspace_id: workspaceId },
  );
}

export function refreshCampaignMetrics(campaignId: string) {
  return invoke<{ ok: true; rows: number }>("ad-campaigns-metrics-sync", { campaign_id: campaignId });
}

// --- Draft CRUD (direct table access - RLS is the authorization boundary,
// same as content_series drafts in Phase 5). Only publish/pause/metrics-
// sync go through edge functions - see each module's header comment for
// why (resolving the Meta token requires the service role).

export type AudienceBasics = {
  age_min?: number;
  age_max?: number;
  genders?: "all" | "male" | "female";
  geo_countries?: string[];
  interests?: Array<{ id: string; name: string }>;
};

export type CampaignDraftInput = {
  workspace_id: string;
  integration_id: string;
  ad_account_id: string;
  facebook_page_id: string | null;
  instagram_account_id: string | null;
  name: string;
  objective: "OUTCOME_AWARENESS" | "OUTCOME_TRAFFIC" | "OUTCOME_ENGAGEMENT" | "OUTCOME_SALES";
  destination_type: "website" | "whatsapp" | "page_profile";
  budget_type: "daily" | "lifetime";
  daily_budget_minor_units: number | null;
  lifetime_budget_minor_units: number | null;
  currency: string;
  start_at: string;
  end_at: string | null;
  audience: AudienceBasics;
  source_content_media_asset_id?: string | null;
};

export type CreativeDraftInput = {
  workspace_id: string;
  media_asset_id: string;
  platform_variant_id?: string | null;
  headline: string | null;
  primary_text: string;
  description: string | null;
  cta: string;
  destination_url: string | null;
  whatsapp_number_id?: string | null;
};

export async function createCampaignDraft(campaign: CampaignDraftInput, creative: CreativeDraftInput) {
  const { data: creativeRow, error: creativeError } = await supabase
    .from("ad_creatives")
    .insert({ ...creative, status: "draft" })
    .select("id")
    .single();
  if (creativeError || !creativeRow) throw new Error(creativeError?.message || "Unable to create the creative");

  const { data: campaignRow, error: campaignError } = await supabase
    .from("ad_campaigns")
    .insert({ ...campaign, draft_creative_id: creativeRow.id, status: "draft" })
    .select("id")
    .single();
  if (campaignError || !campaignRow) throw new Error(campaignError?.message || "Unable to create the campaign draft");

  await supabase.from("workspace_activity_log").insert({
    workspace_id: campaign.workspace_id,
    action: "campaign_draft_created",
    target_type: "ad_campaign",
    target_id: campaignRow.id,
    metadata: { objective: campaign.objective },
  });

  return { campaignId: campaignRow.id as string, creativeId: creativeRow.id as string };
}

export async function updateCampaignDraft(campaignId: string, campaign: Partial<CampaignDraftInput>, creativeId: string | null, creative: Partial<CreativeDraftInput>) {
  if (creativeId && Object.keys(creative).length) {
    const { error } = await supabase.from("ad_creatives").update(creative).eq("id", creativeId);
    if (error) throw new Error(error.message);
  }
  const { error } = await supabase.from("ad_campaigns").update({ ...campaign, status: "draft" }).eq("id", campaignId);
  if (error) throw new Error(error.message);

  await supabase.from("workspace_activity_log").insert({
    workspace_id: campaign.workspace_id as string,
    action: "campaign_edited",
    target_type: "ad_campaign",
    target_id: campaignId,
    metadata: {},
  });
}

export async function markCampaignReadyForReview(campaignId: string) {
  const { error } = await supabase.from("ad_campaigns").update({ status: "ready" }).eq("id", campaignId).eq("status", "draft");
  if (error) throw new Error(error.message);
}

export async function deleteCampaignDraft(campaignId: string) {
  const { error } = await supabase.from("ad_campaigns").delete().eq("id", campaignId).eq("status", "draft");
  if (error) throw new Error(error.message);
}
