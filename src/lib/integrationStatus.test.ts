import { describe, expect, it } from "vitest";
import { presentIntegrationStatus, presentWebhookSubscription } from "./integrationStatus";

describe("presentIntegrationStatus", () => {
  it("maps not-connected, healthy, and reauthorization_required", () => {
    expect(presentIntegrationStatus("healthy", false).label).toBe("Not connected");
    expect(presentIntegrationStatus("healthy", true).tone).toBe("healthy");
    expect(presentIntegrationStatus("reauthorization_required", true).tone).toBe("error");
    expect(presentIntegrationStatus("something-unknown", true).label).toBe("Connected");
  });
});

describe("presentWebhookSubscription", () => {
  it("'subscribed' -> healthy, not actionable", () => {
    const p = presentWebhookSubscription("subscribed", false);
    expect(p).toMatchObject({ label: "Subscribed", tone: "healthy", actionable: false });
  });

  it("'not_subscribed' -> attention, actionable, with an explanatory hint", () => {
    const p = presentWebhookSubscription("not_subscribed", false);
    expect(p.label).toBe("Not subscribed");
    expect(p.tone).toBe("attention");
    expect(p.actionable).toBe(true);
    expect(p.hint).toMatch(/inbound messages will not arrive/i);
  });

  it("'error' -> error tone, actionable", () => {
    const p = presentWebhookSubscription("error", false);
    expect(p.label).toBe("Check failed");
    expect(p.tone).toBe("error");
    expect(p.actionable).toBe(true);
  });

  it("null/'unknown' with NO recent events -> neutral 'Unknown', actionable", () => {
    for (const s of [null, "unknown"]) {
      const p = presentWebhookSubscription(s, false);
      expect(p.label).toBe("Unknown");
      expect(p.actionable).toBe(true);
    }
  });

  it("null/'unknown' but events ARE arriving -> 'Receiving events', healthy, not actionable (real delivery beats a stale flag)", () => {
    const p = presentWebhookSubscription(null, true);
    expect(p.label).toBe("Receiving events");
    expect(p.tone).toBe("healthy");
    expect(p.actionable).toBe(false);
  });

  it("an explicit 'not_subscribed' is NOT overridden by recent events (an explicit negative is authoritative)", () => {
    const p = presentWebhookSubscription("not_subscribed", true);
    expect(p.label).toBe("Not subscribed");
    expect(p.actionable).toBe(true);
  });
});
