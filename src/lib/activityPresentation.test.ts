import { describe, expect, it } from "vitest";
import { formatActivityAction, isDashboardActivity } from "./activityPresentation";

describe("formatActivityAction", () => {
  it("maps a known internal action string to a polished customer-facing label", () => {
    expect(formatActivityAction("pipeline_created")).toBe("Default pipeline created");
    expect(formatActivityAction("opportunity_won")).toBe("Opportunity won");
    expect(formatActivityAction("inbox_conversation_assigned")).toBe("Conversation assigned");
  });

  it("humanizes media and WhatsApp activity consistently", () => {
    expect(formatActivityAction("content_media_uploaded")).toBe("Media uploaded");
    expect(formatActivityAction("content_platform_variant_generated")).toBe("Media variant generated");
    expect(formatActivityAction("whatsapp_connected")).toBe("WhatsApp connected");
  });

  it("filters repetitive technical activity from the business dashboard without deleting it", () => {
    expect(isDashboardActivity("campaign_connection_health_checked")).toBe(false);
    expect(isDashboardActivity("campaign_metrics_refreshed")).toBe(false);
    expect(isDashboardActivity("lead_created")).toBe(true);
    expect(isDashboardActivity("content_media_uploaded")).toBe(true);
  });

  it("REGRESSION: never leaks a raw snake_case action string for an unmapped action - falls back to a humanized version", () => {
    const result = formatActivityAction("some_future_action_type");
    expect(result).not.toContain("_");
    expect(result).toBe("Some Future Action Type");
  });

  it("does not mutate the underlying taxonomy - this is presentation only, the raw key is looked up verbatim", () => {
    expect(formatActivityAction("lead_created")).toBe("Lead created");
    expect(formatActivityAction("lead_created")).not.toBe("lead_created");
  });
});
