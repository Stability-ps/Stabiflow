import { beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignPublishNotReadyError, publishCampaign, updateCampaignDraft } from "@/lib/adCampaigns";

// Minimal chainable stand-in for the supabase-js query builder + a
// functions.invoke stub. Records the last .update() payload per table so
// tests can assert what was written.
const { state, invokeMock, supabaseMock } = vi.hoisted(() => {
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
  const invokeMock = vi.fn();
  return { state, invokeMock, supabaseMock: { from: (t: string) => builder(t), functions: { invoke: invokeMock } } };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

// Shape of a supabase-js FunctionsHttpError: `data` is null, the JSON body
// is reachable via `error.context` (a Response).
function httpError(body: unknown) {
  return {
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code", // raw supabase string - must never surface
      context: { json: () => Promise.resolve(body), clone() { return this; } },
    },
  };
}

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

describe("publishCampaign (publish 422 error UX)", () => {
  beforeEach(() => invokeMock.mockReset());

  it("a 200 result is returned as-is", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, outcome: "success" }, error: null });
    await expect(publishCampaign("c1", "k1")).resolves.toEqual({ ok: true, outcome: "success" });
  });

  it("a 422 with readiness issues throws CampaignPublishNotReadyError carrying those issues", async () => {
    const issues = [{ code: "invalid_budget", message: "scheduled start time is too close or has passed - choose Start now or a later time", severity: "error" }];
    invokeMock.mockResolvedValue(httpError({ error: "Campaign is not ready to publish.", issues }));

    const err = await publishCampaign("c1", "k1").catch((e) => e);
    expect(err).toBeInstanceOf(CampaignPublishNotReadyError);
    expect(err.issues).toEqual(issues);
    // no raw supabase string leaked
    expect(err.message).not.toMatch(/non-2xx/);
  });

  it("a non-readiness failure throws a plain Error with our curated sentence, never the raw supabase message", async () => {
    invokeMock.mockResolvedValue(httpError({ error: "This campaign cannot be published from its current state (publishing)." }));
    const err = await publishCampaign("c1", "k1").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CampaignPublishNotReadyError);
    expect(err.message).toBe("This campaign cannot be published from its current state (publishing).");
    expect(err.message).not.toMatch(/non-2xx|Edge Function/);
  });

  it("an error with no readable body falls back to a safe generic sentence", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: {} } });
    const err = await publishCampaign("c1", "k1").catch((e) => e);
    expect(err.message).toBe("Unable to publish this campaign right now.");
  });
});
