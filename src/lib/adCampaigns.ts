import { supabase } from "@/integrations/supabase/client";

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  // Some structured error bodies (workspaceSuspendedBody, shared by every
  // suspension-gated function) put a machine code in `error` and the
  // human text in `message` - prefer `message` when present so a
  // suspended-workspace action never surfaces a raw code like
  // "workspace_suspended" instead of a real sentence.
  if (error) {
    const body = data as { error?: string; message?: string } | null;
    const message = body?.message || body?.error || error.message || `${name} failed`;
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    const typed = data as { error: string; message?: string };
    throw new Error(typed.message || typed.error);
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
  start_at: string | null; // null = "Start now" (publish immediately)
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

// Reconciles the stored review status of an UNPUBLISHED campaign with an
// actual readiness result. Promotes draft -> 'ready' when readiness
// passes, and demotes a stale 'ready' -> 'draft' when it does not. Never
// touches a campaign that has been published to Meta. Replaces the old
// markCampaignReadyForReview(), which promoted unconditionally the moment
// the builder's Publish step opened - the source of the production
// contradiction where the badge said "ready" but the campaign could not
// be published.
export async function syncCampaignReviewStatus(campaignId: string, ready: boolean) {
  const { error } = await supabase
    .from("ad_campaigns")
    .update({ status: ready ? "ready" : "draft" })
    .eq("id", campaignId)
    .is("external_campaign_id", null)
    .in("status", ["draft", "ready"]);
  if (error) throw new Error(error.message);
}

export async function deleteCampaignDraft(campaignId: string) {
  // The RLS delete policy only permits status = 'draft'. A campaign that
  // the old builder optimistically flipped to 'ready' (but never
  // published) is still a local-only draft - demote it first so the user
  // isn't stuck with an undeletable row. Never demotes/deletes anything
  // with a Meta id.
  await supabase
    .from("ad_campaigns")
    .update({ status: "draft" })
    .eq("id", campaignId)
    .eq("status", "ready")
    .is("external_campaign_id", null);

  const { error, count } = await supabase
    .from("ad_campaigns")
    .delete({ count: "exact" })
    .eq("id", campaignId)
    .eq("status", "draft")
    .is("external_campaign_id", null);
  if (error) throw new Error(error.message);
  if (!count) throw new Error("This campaign can no longer be deleted as a draft. Refresh and try again.");
}

// Creates a NEW local draft from an existing campaign's configuration
// (spec 8). The copy gets a fresh id, never reuses any Meta
// campaign/ad-set/ad id, is never published, and creates no spend. The
// user-editable builder fields carry over; provenance
// (source_content_*) is preserved; all publish/readiness bookkeeping is
// reset. Workspace isolation is the caller's own RLS scope, same as
// createCampaignDraft.
export async function duplicateCampaignDraft(campaignId: string): Promise<{ campaignId: string }> {
  const { data: source, error: loadError } = await supabase
    .from("ad_campaigns")
    .select(
      "workspace_id, integration_id, ad_account_id, facebook_page_id, instagram_account_id, name, objective, buying_type, destination_type, budget_type, daily_budget_minor_units, lifetime_budget_minor_units, currency, start_at, end_at, audience, placements, draft_creative_id, source_content_media_asset_id, source_content_series_id",
    )
    .eq("id", campaignId)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!source) throw new Error("The campaign to duplicate could not be found.");

  let newCreativeId: string | null = null;
  if (source.draft_creative_id) {
    const { data: creative, error: creativeLoadError } = await supabase
      .from("ad_creatives")
      .select("workspace_id, media_asset_id, platform_variant_id, headline, primary_text, description, cta, destination_url, whatsapp_number_id")
      .eq("id", source.draft_creative_id)
      .maybeSingle();
    if (creativeLoadError) throw new Error(creativeLoadError.message);
    if (creative) {
      const { data: creativeRow, error: creativeInsertError } = await supabase
        .from("ad_creatives")
        .insert({ ...creative, status: "draft" })
        .select("id")
        .single();
      if (creativeInsertError || !creativeRow) throw new Error(creativeInsertError?.message || "Unable to copy the creative");
      newCreativeId = creativeRow.id as string;
    }
  }

  const { data: campaignRow, error: insertError } = await supabase
    .from("ad_campaigns")
    .insert({
      workspace_id: source.workspace_id,
      integration_id: source.integration_id,
      ad_account_id: source.ad_account_id,
      facebook_page_id: source.facebook_page_id,
      instagram_account_id: source.instagram_account_id,
      name: `${source.name} - Copy`,
      objective: source.objective,
      buying_type: source.buying_type,
      destination_type: source.destination_type,
      budget_type: source.budget_type,
      daily_budget_minor_units: source.daily_budget_minor_units,
      lifetime_budget_minor_units: source.lifetime_budget_minor_units,
      currency: source.currency,
      start_at: source.start_at,
      end_at: source.end_at,
      audience: source.audience,
      placements: source.placements,
      source_content_media_asset_id: source.source_content_media_asset_id,
      source_content_series_id: source.source_content_series_id,
      draft_creative_id: newCreativeId,
      status: "draft",
    })
    .select("id")
    .single();
  if (insertError || !campaignRow) throw new Error(insertError?.message || "Unable to duplicate the campaign");

  await supabase.from("workspace_activity_log").insert({
    workspace_id: source.workspace_id,
    action: "campaign_duplicated",
    target_type: "ad_campaign",
    target_id: campaignRow.id,
    metadata: { duplicated_from: campaignId },
  });

  return { campaignId: campaignRow.id as string };
}
