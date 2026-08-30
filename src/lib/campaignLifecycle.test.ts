import { describe, it, expect } from "vitest";
import {
  canDeleteCampaignDraft,
  deriveCampaignPresentation,
  isEditableCampaign,
  isStartDateInPast,
  isUnpublishedCampaign,
} from "./campaignLifecycle";

const err = { code: "invalid_budget", message: "start date must not be in the past", severity: "error" as const };
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

describe("isStartDateInPast (workspace-timezone calendar comparison)", () => {
  const JHB = "Africa/Johannesburg";

  it("a start date of TODAY in the workspace zone is NOT past, even if the stored instant is local-midnight earlier today", () => {
    // 2026-08-29 00:00 JHB == 2026-08-28T22:00:00Z
    expect(isStartDateInPast("2026-08-28T22:00:00.000Z", JHB, new Date("2026-08-29T10:00:00Z"))).toBe(false);
  });

  it("a start date genuinely before today in the workspace zone IS past", () => {
    expect(isStartDateInPast("2026-08-27T22:00:00.000Z", JHB, new Date("2026-08-29T10:00:00Z"))).toBe(true);
  });

  it("a future start date is not past", () => {
    expect(isStartDateInPast("2099-01-01T00:00:00.000Z", JHB, new Date("2026-08-29T10:00:00Z"))).toBe(false);
  });

  it("timezone boundary: 23:59 JHB is still 'today'; one minute later a same start date becomes past", () => {
    const start = "2026-08-28T22:00:00.000Z"; // 2026-08-29 00:00 JHB
    expect(isStartDateInPast(start, JHB, new Date("2026-08-29T21:59:00Z"))).toBe(false); // 23:59 JHB, 29th
    expect(isStartDateInPast(start, JHB, new Date("2026-08-29T22:00:00Z"))).toBe(true); // 00:00 JHB, 30th
  });

  it("an invalid date string is treated as not-past rather than throwing", () => {
    expect(isStartDateInPast("not-a-date", JHB, new Date("2026-08-29T10:00:00Z"))).toBe(false);
  });
});
