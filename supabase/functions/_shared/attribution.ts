// Phase G. Shared attribution-event writing, used first by the WhatsApp
// webhook (conversation-creation touchpoint) and later by leads-actions
// (funnel backfill) and any future entry point (website form, QR code).
//
// The one rule every call site here must honor: a touchpoint is written
// ONCE per real-world event, at the moment StabiFlow first has evidence of
// it, and is only ever appended-to (backfilling a lead_id/opportunity_id/
// customer_id as an entity progresses), never rewritten or duplicated.
//
// deno-lint-ignore-file no-explicit-any
type AnySupabaseClient = any;

export type InboundReferralLike = {
  sourceType: string | null;
  sourceId: string | null;
  headline: string | null;
  ctwaClid: string | null;
};

export type AttributionEventInsert = {
  workspace_id: string;
  event_type: string;
  occurred_at: string;
  platform: string;
  source_type: "paid" | "organic" | "direct" | "referral" | "unknown";
  source: string;
  medium?: string | null;
  attribution_method: "deterministic" | "provider_reported" | "exact_match" | "manual" | "probabilistic_future";
  attribution_confidence: "exact" | "high" | "medium" | "low" | "unknown";
  attribution_source?: string | null; // legacy free-text column, kept aligned with `source` for readability of older rows
  conversation_id?: string | null;
  campaign_id?: string | null;
  ad_set_id?: string | null;
  ad_id?: string | null;
  creative_id?: string | null;
  external_campaign_id?: string | null;
  external_adset_id?: string | null;
  external_ad_id?: string | null;
  external_creative_id?: string | null;
  click_id?: string | null;
  provider_event_id?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Records the ONE touchpoint for a brand-new WhatsApp conversation.
 *
 * Meta's real Click-to-WhatsApp referral payload is
 * {source_type, source_id, headline, ctwa_clid} - it never includes a
 * campaign_id (see the referral_click_id column comment on
 * inbox_conversations for the full investigation). source_id, when
 * source_type is "ad", is the AD's id. The only way to resolve that to a
 * campaign/ad_set/creative is for StabiFlow to look up ITS OWN `ads` table
 * by external_ad_id - the ids Phase F's publish saga already stamped on
 * ads it published. When that lookup finds a match, this is genuinely
 * deterministic/exact evidence (Meta's own referral + StabiFlow's own
 * authoritative campaign record). When it doesn't (an ad run outside
 * StabiFlow, or Meta data StabiFlow can't yet resolve), the event is still
 * recorded as paid/meta - just with lower confidence and no internal FK.
 * When there's no referral at all, StabiFlow can be exactly certain the
 * message is organic/direct - that absence is itself real evidence, not a
 * gap to guess at.
 */
export async function recordConversationTouchpoint(
  sb: AnySupabaseClient,
  workspaceId: string,
  conversationId: string,
  occurredAtIso: string,
  referral: InboundReferralLike | null,
): Promise<void> {
  const provider_event_id = `conversation_created:${conversationId}`;

  let insert: AttributionEventInsert;

  if (referral?.sourceId && (referral.sourceType === "ad" || !referral.sourceType)) {
    const { data: adMatch } = await sb
      .from("ads")
      .select("id, ad_set_id, creative_id, ad_sets(campaign_id)")
      .eq("workspace_id", workspaceId)
      .eq("external_ad_id", referral.sourceId)
      .maybeSingle();

    if (adMatch) {
      insert = {
        workspace_id: workspaceId,
        event_type: "conversation_started",
        occurred_at: occurredAtIso,
        platform: "meta",
        source_type: "paid",
        source: "meta",
        medium: "click_to_whatsapp",
        attribution_method: "deterministic",
        attribution_confidence: "exact",
        attribution_source: "meta_provider",
        conversation_id: conversationId,
        campaign_id: (adMatch.ad_sets as { campaign_id: string } | null)?.campaign_id ?? null,
        ad_set_id: adMatch.ad_set_id,
        ad_id: adMatch.id,
        creative_id: adMatch.creative_id,
        external_ad_id: referral.sourceId,
        click_id: referral.ctwaClid,
        provider_event_id,
        metadata: referral.headline ? { headline: referral.headline } : {},
      };
    } else {
      // Real Meta referral evidence, but it doesn't match any ad StabiFlow
      // published - do NOT fabricate a campaign link. Still genuinely
      // paid/meta, just lower confidence and no internal FK.
      insert = {
        workspace_id: workspaceId,
        event_type: "conversation_started",
        occurred_at: occurredAtIso,
        platform: "meta",
        source_type: "paid",
        source: "meta",
        medium: "click_to_whatsapp",
        attribution_method: "provider_reported",
        attribution_confidence: "low",
        attribution_source: "whatsapp_entry",
        conversation_id: conversationId,
        external_ad_id: referral.sourceId,
        click_id: referral.ctwaClid,
        provider_event_id,
        metadata: referral.headline ? { headline: referral.headline, unmatched_reason: "no ad in this workspace has this external_ad_id" } : { unmatched_reason: "no ad in this workspace has this external_ad_id" },
      };
    }
  } else {
    insert = {
      workspace_id: workspaceId,
      event_type: "conversation_started",
      occurred_at: occurredAtIso,
      platform: "whatsapp",
      source_type: "direct",
      source: "whatsapp_direct",
      medium: "direct",
      attribution_method: "deterministic",
      attribution_confidence: "exact",
      attribution_source: "whatsapp_entry",
      conversation_id: conversationId,
      provider_event_id,
      metadata: {},
    };
  }

  const { error } = await sb.from("attribution_events").insert(insert);
  // 23505 = provider_event_id already recorded (a racing duplicate webhook
  // delivery for the same brand-new conversation) - the touchpoint already
  // exists, which is exactly the outcome we want, not an error to surface.
  if (error && error.code !== "23505") {
    console.error("attribution: failed to record conversation touchpoint", error.message);
  }
}
