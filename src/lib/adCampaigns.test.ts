import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateCampaignDraft } from "@/lib/adCampaigns";

// Minimal chainable stand-in for the supabase-js query builder. Records
// the last .update() payload per table so tests can assert what was written.
const { state, supabaseMock } = vi.hoisted(() => {
  const state = {
    updates: {} as Record<string, unknown>,
    inserts: {} as Record<string, unknown>,
  };
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.update = (payload: unknown) => { state.updates[table] = payload; return chain; };
    chain.insert = (payload: unknown) => { state.inserts[table] = payload; return Promise.resolve({ error: null }); };
    chain.eq = () => Promise.resolve({ error: null });
    return chain;
  };
  return { state, supabaseMock: { from: (t: string) => builder(t) } };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

describe("updateCampaignDraft (HIGH-1: stale readiness after edit)", () => {
  beforeEach(() => {
    state.updates = {};
    state.inserts = {};
  });

  it("clears last_readiness_check and keeps status='draft' on every edit", async () => {
    await updateCampaignDraft(
      "campaign-1",
      { workspace_id: "ws-1", name: "Renamed", budget_type: "daily", daily_budget_minor_units: 5000 },
      null,
      {},
    );

    const payload = state.updates["ad_campaigns"] as Record<string, unknown>;
    expect(payload).toBeDefined();
    expect(payload.status).toBe("draft");
    expect(payload.last_readiness_check).toBeNull();
    // the edited fields are still written
    expect(payload.name).toBe("Renamed");
  });

  it("writes a campaign_edited activity-log entry", async () => {
    await updateCampaignDraft("campaign-1", { workspace_id: "ws-1", name: "X" }, null, {});
    const log = state.inserts["workspace_activity_log"] as Record<string, unknown>;
    expect(log.action).toBe("campaign_edited");
    expect(log.target_id).toBe("campaign-1");
  });
});
