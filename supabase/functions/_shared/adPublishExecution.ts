// Campaign publishing orchestration (Phase 6 instruction #13 - server-side
// publishing pipeline; #14 - idempotency; #16 - budget safety).
//
// Design for partial failure (instruction #13's worked example - "Campaign
// created successfully at Meta, but Ad creation failed"): every provider
// object created is written to ad_campaigns.provider_state IMMEDIATELY
// after that single Graph API call succeeds, before the next step runs -
// not batched at the end. A crash or error on any later step leaves
// provider_state accurately reflecting what really exists at Meta, and
// resolveNextStep() (a pure function, unit tested) reads it back to resume
// from exactly the right step on retry - so retrying a partially-failed
// publish never re-creates (and double-spends against) an object that
// already exists.
//
// Design for idempotency (instruction #14): the caller (ad-campaigns-publish
// edge function) is responsible for the idempotency-key lookup/creation in
// ad_publish_operations AND the atomic claim (claimCampaignForPublish
// below) before calling executeCampaignPublish - this module assumes both
// already happened and performs no locking of its own.
import { PermanentAdError, TemporaryAdError } from "./ad-providers/types.ts";
import type { CreatedObject, CreateAdCreativeInput, CreateAdInput, CreateAdSetInput, CreateCampaignInput, MetaCredential } from "./ad-providers/types.ts";
import * as realMetaProvider from "./ad-providers/metaMarketingApi.ts";
import { sanitizeAdErrorForStorage } from "./ad-providers/metaAdsErrorClassifier.ts";
import { getObjectiveRule } from "./adObjectiveRules.ts";
import { buildMetaTargetingSpec } from "./adAudience.ts";
import { normalizePhoneNumber } from "./phone.ts";

// Dependency-injected so a mock provider (metaMarketingApiMock.ts) can
// stand in during tests/mock-mode publishing without this module - or the
// edge function calling it - ever branching on "is this mock mode" itself
// beyond picking WHICH provider object to pass in. See metaMarketingApiMock.ts
// for why this exists: proving the actual 4-step saga (not just the
// idempotency claim around it) under success/partial-failure/retry without
// a real Meta API call.
export type MetaAdsProvider = {
  createCampaign(cred: MetaCredential, input: CreateCampaignInput): Promise<CreatedObject>;
  createAdSet(cred: MetaCredential, input: CreateAdSetInput): Promise<CreatedObject>;
  createAdCreative(cred: MetaCredential, input: CreateAdCreativeInput): Promise<CreatedObject>;
  createAd(cred: MetaCredential, input: CreateAdInput): Promise<CreatedObject>;
  updateObjectStatus(cred: MetaCredential, externalId: string, status: "ACTIVE" | "PAUSED"): Promise<{ success: boolean }>;
};

export const REAL_META_PROVIDER: MetaAdsProvider = realMetaProvider;

// deno-lint-ignore no-explicit-any
export type AnySupabaseClient = any;

export const CONTENT_MEDIA_BUCKET = "content-media";
const SIGNED_URL_SECONDS = 600;

export type ProviderState = {
  campaign?: { external_id: string; created_at: string };
  ad_set?: { external_id: string; created_at: string };
  creative?: { external_id: string; created_at: string };
  ad?: { external_id: string; created_at: string };
};

export type PublishStep = "campaign" | "ad_set" | "creative" | "ad" | "done";

// Pure - unit tested. The fixed step order (campaign -> ad_set -> creative
// -> ad) is a deliberate simplification: ad_set and creative have no
// dependency on each other at Meta, but serializing them keeps the
// resume logic a single linear scan instead of a dependency graph, which
// is easier to reason about correctly for a first version of this pipeline.
export function resolveNextStep(state: ProviderState): PublishStep {
  if (!state.campaign) return "campaign";
  if (!state.ad_set) return "ad_set";
  if (!state.creative) return "creative";
  if (!state.ad) return "ad";
  return "done";
}

// Atomic claim, same primitive as content-publish's claimScheduledPost:
// only succeeds if the campaign is currently 'ready' or 'failed' (a retry
// after a partial failure is allowed to resume) - a campaign already
// 'publishing' or 'active' cannot be claimed again, so two concurrent
// publish requests (a double click, or a client retry racing the original
// request) can never both proceed past this point.
export async function claimCampaignForPublish(sb: AnySupabaseClient, campaignId: string, nowIso: string) {
  const { data } = await sb
    .from("ad_campaigns")
    .update({ status: "publishing", updated_at: nowIso })
    .eq("id", campaignId)
    .in("status", ["ready", "failed"])
    .select("*")
    .maybeSingle();
  return data;
}

type Step = { step: string; status: "success" | "failed"; external_id?: string; error?: unknown };

export type ExecutePublishOptions = {
  actorUserId: string | null;
  apiVersion: string;
  operationId: string;
  provider: MetaAdsProvider;
  // Test-only forced-failure hook (see metaMarketingApiMock.ts's header) -
  // the calling edge function only ever sets this when mock mode is
  // active, so it can never affect a real campaign even if a stray value
  // somehow ended up in a campaign's audience jsonb.
  mockFailStep?: PublishStep | null;
};

export type ExecutePublishResult = {
  outcome: "success" | "partial" | "failed";
  campaignStatus: "active" | "publishing" | "failed";
  steps: Step[];
};

export async function executeCampaignPublish(sb: AnySupabaseClient, campaign: Record<string, unknown>, options: ExecutePublishOptions): Promise<ExecutePublishResult> {
  const steps: Step[] = [];
  let providerState: ProviderState = (campaign.provider_state as ProviderState) || {};

  const persistState = async (next: ProviderState) => {
    providerState = next;
    await sb.from("ad_campaigns").update({ provider_state: next, updated_at: new Date().toISOString() }).eq("id", campaign.id);
  };
  const persistOperation = async (status: "in_progress" | "succeeded" | "partial" | "failed", error?: unknown) => {
    await sb
      .from("ad_publish_operations")
      .update({
        status,
        steps,
        error: error ? sanitizeAdErrorForStorage(error) : null,
        finished_at: status === "in_progress" ? null : new Date().toISOString(),
      })
      .eq("id", options.operationId);
  };

  try {
    // Resolve every referenced resource fresh (never trust provider_state
    // for anything but "what's already been created at Meta") - defense in
    // depth matching the workspace-validate triggers: even though the row's
    // FKs are already guaranteed same-workspace by the DB trigger, this
    // resolves the ACTUAL external ids needed for the Graph API calls.
    const [{ data: adAccount }, { data: integration }] = await Promise.all([
      sb.from("workspace_meta_ad_accounts").select("ad_account_id, workspace_id").eq("id", campaign.ad_account_id).single(),
      sb.from("workspace_integrations").select("id, workspace_id, status").eq("id", campaign.integration_id).single(),
    ]);
    if (!adAccount || adAccount.workspace_id !== campaign.workspace_id) throw new PermanentAdError("missing_ad_account", "The connected ad account no longer exists for this workspace", "invalid_resource");
    if (!integration || integration.workspace_id !== campaign.workspace_id || integration.status !== "connected") {
      throw new PermanentAdError("integration_not_connected", "This workspace's Meta integration is not connected", "authorization_failure");
    }

    const { data: token, error: tokenError } = await sb.rpc("get_workspace_integration_secret", { p_integration_id: campaign.integration_id });
    if (tokenError || !token) throw new TemporaryAdError("token_unavailable", "Unable to resolve this workspace's Meta access token", "temporary_unavailable");
    const cred = { token, apiVersion: options.apiVersion };
    const externalAdAccountId = adAccount.ad_account_id.startsWith("act_") ? adAccount.ad_account_id : `act_${adAccount.ad_account_id}`;

    let step = resolveNextStep(providerState);

    const maybeForceFail = (atStep: PublishStep) => {
      if (options.mockFailStep === atStep) {
        throw new PermanentAdError("mock_forced_failure", `Mock-mode forced failure at step "${atStep}" (test-only)`, "invalid_request");
      }
    };

    if (step === "campaign") {
      maybeForceFail("campaign");
      const created = await options.provider.createCampaign(cred, {
        adAccountId: externalAdAccountId,
        name: campaign.name as string,
        objective: campaign.objective as string,
        buyingType: campaign.buying_type as string,
        status: "PAUSED",
        budgetType: campaign.budget_type as "daily" | "lifetime",
        dailyBudgetMinorUnits: (campaign.daily_budget_minor_units as number) ?? null,
        lifetimeBudgetMinorUnits: (campaign.lifetime_budget_minor_units as number) ?? null,
      });
      steps.push({ step: "campaign", status: "success", external_id: created.id });
      await persistState({ ...providerState, campaign: { external_id: created.id, created_at: new Date().toISOString() } });
      await sb.from("ad_campaigns").update({ external_campaign_id: created.id }).eq("id", campaign.id);
      step = "ad_set";
    }

    const rule = getObjectiveRule(campaign.objective as string)!;

    let adSetRow: Record<string, unknown> | null = null;
    if (step === "ad_set") {
      maybeForceFail("ad_set");
      const created = await options.provider.createAdSet(cred, {
        adAccountId: externalAdAccountId,
        campaignExternalId: providerState.campaign!.external_id,
        name: `${campaign.name} - Ad Set`,
        status: "PAUSED",
        optimizationGoal: rule.optimizationGoal,
        billingEvent: rule.billingEvent,
        // null start_at = "Start now" -> pass null so Meta omits start_time
        // and begins delivery when the ad set is activated below.
        startTime: (campaign.start_at as string | null) ?? null,
        endTime: (campaign.end_at as string) || null,
        targeting: buildMetaTargetingSpec((campaign.audience as Record<string, unknown>) || {}),
        pagePlacements: (campaign.placements as Record<string, unknown>) || {},
        dailyBudgetMinorUnits: null, // CBO: budget lives on the campaign object, not the ad set - see schema migration note
        lifetimeBudgetMinorUnits: null,
      });
      steps.push({ step: "ad_set", status: "success", external_id: created.id });
      await persistState({ ...providerState, ad_set: { external_id: created.id, created_at: new Date().toISOString() } });
      const { data: inserted } = await sb
        .from("ad_sets")
        .insert({
          workspace_id: campaign.workspace_id,
          campaign_id: campaign.id,
          name: `${campaign.name} - Ad Set`,
          external_adset_id: created.id,
          status: "active",
          optimization_goal: rule.optimizationGoal,
          billing_event: rule.billingEvent,
          targeting: campaign.audience || {},
          placements: campaign.placements || {},
          // ad_sets.start_at is NOT NULL - for a "Start now" campaign the
          // concrete start instant IS the publish moment.
          start_at: (campaign.start_at as string | null) ?? new Date().toISOString(),
          end_at: campaign.end_at,
        })
        .select("*")
        .single();
      adSetRow = inserted;
      step = "creative";
    } else {
      const { data } = await sb.from("ad_sets").select("*").eq("campaign_id", campaign.id).maybeSingle();
      adSetRow = data;
    }

    const { data: creative } = await sb.from("ad_creatives").select("*").eq("id", campaign.draft_creative_id).single();
    const { data: mediaAsset } = creative.platform_variant_id
      ? await sb.from("content_platform_variants").select("storage_path").eq("id", creative.platform_variant_id).single()
      : await sb.from("content_media_assets").select("storage_path").eq("id", creative.media_asset_id).single();
    if (!mediaAsset) throw new PermanentAdError("missing_creative_media", "Creative media no longer exists", "invalid_creative");

    let pageExternalId: string | null = null;
    let igActorExternalId: string | null = null;
    if (campaign.facebook_page_id) {
      const { data: page } = await sb.from("workspace_facebook_pages").select("page_id").eq("id", campaign.facebook_page_id).single();
      pageExternalId = page?.page_id || null;
    }
    if (campaign.instagram_account_id) {
      const { data: ig } = await sb.from("workspace_instagram_accounts").select("ig_business_account_id").eq("id", campaign.instagram_account_id).single();
      igActorExternalId = ig?.ig_business_account_id || null;
    }
    if (!pageExternalId) throw new PermanentAdError("missing_page", "A Facebook Page is required to create the ad creative", "invalid_resource");

    let whatsappNumberDigits: string | null = null;
    if (campaign.destination_type === "whatsapp") {
      if (!creative.whatsapp_number_id) throw new PermanentAdError("missing_whatsapp_number", "A WhatsApp number is required for a WhatsApp destination", "invalid_creative");
      const { data: waNumber } = await sb.from("workspace_whatsapp_numbers").select("workspace_id, display_phone_number, is_active").eq("id", creative.whatsapp_number_id).single();
      if (!waNumber || waNumber.workspace_id !== campaign.workspace_id || !waNumber.is_active) {
        throw new PermanentAdError("whatsapp_number_unavailable", "The selected WhatsApp number is no longer connected or active for this workspace", "invalid_creative");
      }
      const normalized = normalizePhoneNumber(waNumber.display_phone_number);
      if (!normalized) throw new PermanentAdError("invalid_whatsapp_number", "The selected WhatsApp number could not be normalized", "invalid_creative");
      whatsappNumberDigits = normalized.slice(1); // wa.me links use digits only, no leading '+'
    }

    if (step === "creative") {
      maybeForceFail("creative");
      const { data: signed, error: signError } = await sb.storage.from(CONTENT_MEDIA_BUCKET).createSignedUrl(mediaAsset.storage_path, SIGNED_URL_SECONDS);
      if (signError || !signed?.signedUrl) throw new TemporaryAdError("signed_url_failed", "Unable to create a signed URL for the creative's media", "temporary_unavailable");

      const created = await options.provider.createAdCreative(cred, {
        adAccountId: externalAdAccountId,
        name: `${campaign.name} - Creative`,
        pageId: pageExternalId,
        instagramActorId: igActorExternalId,
        imageUrl: signed.signedUrl,
        primaryText: creative.primary_text,
        headline: creative.headline,
        description: creative.description,
        cta: creative.cta,
        destinationUrl: creative.destination_url,
        linkOrigin: campaign.destination_type as "website" | "page_profile" | "whatsapp",
        whatsappNumber: whatsappNumberDigits,
      });
      steps.push({ step: "creative", status: "success", external_id: created.id });
      await persistState({ ...providerState, creative: { external_id: created.id, created_at: new Date().toISOString() } });
      await sb.from("ad_creatives").update({ external_creative_id: created.id, status: "active" }).eq("id", creative.id);
      step = "ad";
    }

    if (step === "ad") {
      maybeForceFail("ad");
      const created = await options.provider.createAd(cred, {
        adAccountId: externalAdAccountId,
        adSetExternalId: providerState.ad_set!.external_id,
        creativeExternalId: providerState.creative!.external_id,
        name: `${campaign.name} - Ad`,
        status: "PAUSED",
      });
      steps.push({ step: "ad", status: "success", external_id: created.id });
      await persistState({ ...providerState, ad: { external_id: created.id, created_at: new Date().toISOString() } });
      await sb.from("ads").insert({
        workspace_id: campaign.workspace_id,
        ad_set_id: adSetRow!.id,
        creative_id: creative.id,
        name: `${campaign.name} - Ad`,
        external_ad_id: created.id,
        status: "active",
      });

      // Every object exists - now, and only now, flip campaign + ad set + ad
      // to ACTIVE at Meta. This ordering is what makes a partial failure
      // safe: nothing StabiFlow created can spend budget until every piece
      // of it exists.
      await options.provider.updateObjectStatus(cred, providerState.campaign!.external_id, "ACTIVE");
      await options.provider.updateObjectStatus(cred, providerState.ad_set!.external_id, "ACTIVE");
      await options.provider.updateObjectStatus(cred, created.id, "ACTIVE").catch(() => {
        // The ad's own activation is the one that matters for delivery;
        // if this specific call fails after everything else succeeded,
        // the campaign is still correctly marked active below and a
        // subsequent pause/resume action can retry it.
      });

      await sb.from("ad_sets").update({ status: "active", provider_configured_status: "ACTIVE" }).eq("id", adSetRow!.id);
      await sb.from("ads").update({ status: "active", provider_configured_status: "ACTIVE" }).eq("external_ad_id", created.id);
    }

    await sb
      .from("ad_campaigns")
      .update({ status: "active", provider_configured_status: "ACTIVE", last_publish_error: null, updated_at: new Date().toISOString() })
      .eq("id", campaign.id);
    await persistOperation("succeeded");
    return { outcome: "success", campaignStatus: "active", steps };
  } catch (error) {
    const sanitized = sanitizeAdErrorForStorage(error);
    steps.push({ step: resolveNextStep(providerState), status: "failed", error: sanitized });
    const hasAnyProgress = Object.keys(providerState).length > 0;
    await sb
      .from("ad_campaigns")
      .update({ status: "failed", last_publish_error: sanitized, updated_at: new Date().toISOString() })
      .eq("id", campaign.id);
    await persistOperation(hasAnyProgress ? "partial" : "failed", error);
    return { outcome: hasAnyProgress ? "partial" : "failed", campaignStatus: "failed", steps };
  }
}
