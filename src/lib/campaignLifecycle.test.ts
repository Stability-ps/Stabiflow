import { describe, it, expect } from "vitest";
import {
  canDeleteCampaignDraft,
  deriveCampaignPresentation,
  isEditableCampaign,
  isUnpublishedCampaign,
} from "./campaignLifecycle";

const err = { code: "invalid_budget", message: "scheduled start time has passed", severity: "error" as const };
const warn = { code: "creative_media_too_small", message: "media is small", severity: "warning" as const };

describe("deriveCampaignPresentation", () => {
  it("published lifecycle states pass straight through", () => {
    expect(deriveCampaignPresentation({ status: "active" })).toBe("active");
    expect(deriveCampaignPresentation({ status: "paused" })).toBe("paused");
    expect(deriveCampaignPresentation({ status: "publishing" })).toBe("publishing");
    expect(deriveCampaignPresentation({ status: "completed" })).toBe("completed");
    expect(deriveCampaignPresentation({ status: "failed" })).toBe("failed");
  });

  it("an unpublished campaign with no readiness signal is just 'draft'", () => {
    expect(deriveCampaignPresentation({ status: "draft" })).toBe("draft");
    expect(deriveCampaignPresentation({ status: "ready" })).toBe("draft"); // stored 'ready' alone is NOT trusted
  });

  it("REGRESSION: stored status 'ready' but readiness FAILS -> 'needs_attention', never 'ready_to_publish'", () => {
    expect(
      deriveCampaignPresentation({ status: "ready", lastReadinessCheck: { ready: false, issues: [err] } }),
    ).toBe("needs_attention");
    expect(
      deriveCampaignPresentation({ status: "ready", liveReadiness: { ready: false, issues: [err] } }),
    ).toBe("needs_attention");
  });

  it("only shows 'ready_to_publish' when an actual readiness result passes", () => {
    expect(
      deriveCampaignPresentation({ status: "draft", lastReadinessCheck: { ready: true, issues: [] } }),
    ).toBe("ready_to_publish");
    expect(
      deriveCampaignPresentation({ status: "draft", liveReadiness: { ready: true, issues: [warn] } }),
    ).toBe("ready_to_publish"); // warnings don't block
  });

  it("a fresh live result overrides the persisted snapshot", () => {
    expect(
      deriveCampaignPresentation({
        status: "ready",
        lastReadinessCheck: { ready: true, issues: [] },
        liveReadiness: { ready: false, issues: [err] },
      }),
    ).toBe("needs_attention");
  });
});

describe("editability / deletability guards", () => {
  it("an unpublished draft (no Meta id) is editable and deletable", () => {
    const c = { status: "draft", external_campaign_id: null };
    expect(isUnpublishedCampaign(c)).toBe(true);
    expect(isEditableCampaign(c)).toBe(true);
    expect(canDeleteCampaignDraft(c)).toBe(true);
  });

  it("a stale 'ready' with no Meta id is still an unpublished draft", () => {
    const c = { status: "ready", external_campaign_id: null };
    expect(isEditableCampaign(c)).toBe(true);
    expect(canDeleteCampaignDraft(c)).toBe(true);
  });

  it("anything with a Meta id is neither editable nor draft-deletable", () => {
    for (const status of ["ready", "active", "paused", "publishing", "completed", "failed"]) {
      const c = { status, external_campaign_id: "236xxxxx" };
      expect(isEditableCampaign(c)).toBe(false);
      expect(canDeleteCampaignDraft(c)).toBe(false);
    }
  });

  it("a published lifecycle status is not editable even if the Meta id column were momentarily null", () => {
    expect(isEditableCampaign({ status: "active", external_campaign_id: null })).toBe(false);
  });
});
