// Every user-callable edge function that writes module data or calls a
// provider enforces the workspace's plan server-side (_shared/modulePlan.ts),
// not only the route FeatureGate:
// - module off (Free): 403 MODULE_NOT_IN_PLAN, nothing written;
// - module on: the request gets past the plan gate (whatever its own
//   validation then says);
// - another workspace: plain Forbidden, never plan details.
// Deliberate exceptions: pausing a campaign and disconnecting an integration
// stay available after a downgrade. LOCAL Supabase, real functions.
import { randomUUID } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, enableModules, SUPABASE_URL, type TestTenant } from "./helpers";

const ALL_MODULES = ["module.leads", "module.customers", "module.campaigns", "module.content", "module.creative_studio", "module.automations", "module.whatsapp", "module.integrations", "module.flow_ai"];
const uniq = () => randomUUID().slice(0, 8);

type Ids = Record<string, string>;
let free: TestTenant;
let paid: TestTenant;
let outsider: TestTenant;
const ids: Record<"free" | "paid", Ids> = { free: {}, paid: {} };

async function seed(table: string, row: Record<string, unknown>) {
  const { data, error } = await admin.from(table).insert(row).select("id").single();
  if (error) throw new Error(`seed ${table}: ${error.message}`);
  return data.id as string;
}

async function seedWorkspace(t: TestTenant, out: Ids) {
  const ws = t.workspaceId;
  out.waIntegration = await seed("workspace_integrations", { workspace_id: ws, provider: "whatsapp" });
  out.metaIntegration = await seed("workspace_integrations", { workspace_id: ws, provider: "meta" });
  out.number = await seed("workspace_whatsapp_numbers", { workspace_id: ws, integration_id: out.waIntegration, phone_number_id: `gate-${uniq()}` });
  out.fbPage = await seed("workspace_facebook_pages", { workspace_id: ws, integration_id: out.metaIntegration, page_id: `gate-${uniq()}`, page_name: "Gate" });
  out.adAccount = await seed("workspace_meta_ad_accounts", { workspace_id: ws, integration_id: out.metaIntegration, ad_account_id: `gate-${uniq()}` });
  out.media = await seed("content_media_assets", { workspace_id: ws, title: "Gate", storage_path: `${ws}/gate.png`, mime_type: "image/png", width_px: 1080, height_px: 1080, aspect_ratio: 1, file_size_bytes: 100, checksum_sha256: "e".repeat(64) });
  out.series = await seed("content_series", { workspace_id: ws, name: "Gate", start_at: new Date().toISOString() });
  out.post = await seed("content_scheduled_posts", { workspace_id: ws, media_asset_id: out.media, target_platform: "facebook", facebook_page_id: out.fbPage, scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), caption: "Gate", idempotency_key: `gate-${uniq()}` });
  out.campaign = await seed("ad_campaigns", { workspace_id: ws, integration_id: out.metaIntegration, ad_account_id: out.adAccount, name: "Gate", objective: "OUTCOME_TRAFFIC", currency: "ZAR", budget_type: "daily", daily_budget_minor_units: 1000 });
  out.batch = await seed("creative_studio_batches", { workspace_id: ws, business_context: "Gate" });
  out.lead = await seed("leads", { workspace_id: ws, source: "manual", contact_name: "Gate" });
  out.conversation = await seed("inbox_conversations", { workspace_id: ws, whatsapp_number_id: out.number, wa_id: `2782${Math.floor(Math.random() * 1e7)}`, phone_number: "+27820000000" });
}

type Call = { fn: string; flag: string; body: (t: TestTenant, i: Ids) => Record<string, unknown> };

const GATED: Call[] = [
  { fn: "pipelines-actions", flag: "module.leads", body: (t) => ({ workspace_id: t.workspaceId, action: "create_pipeline", name: `Gate ${uniq()}` }) },
  { fn: "revenue-actions", flag: "module.customers", body: (t, i) => ({ workspace_id: t.workspaceId, action: "record", event_type: "sale", amount_minor: 100, currency: "ZAR", lead_id: i.lead }) },
  { fn: "intake-actions", flag: "module.whatsapp", body: (t) => ({ workspace_id: t.workspaceId, action: "create_schema", name: `Gate ${uniq()}` }) },
  { fn: "content-schedule-post", flag: "module.content", body: (t, i) => ({ workspace_id: t.workspaceId, target_platform: "facebook", media_asset_id: i.media, facebook_page_id: i.fbPage, scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), caption: "Gate" }) },
  { fn: "content-publish-now", flag: "module.content", body: (_t, i) => ({ scheduled_post_id: i.post }) },
  { fn: "content-scheduler-settings", flag: "module.content", body: (t) => ({ workspace_id: t.workspaceId, action: "get" }) },
  { fn: "content-series-activate", flag: "module.content", body: (t, i) => ({ workspace_id: t.workspaceId, action: "preview", series_id: i.series }) },
  { fn: "content-generate-variants", flag: "module.content", body: (t, i) => ({ workspace_id: t.workspaceId, media_asset_id: i.media }) },
  { fn: "ad-campaigns-publish", flag: "module.campaigns", body: (_t, i) => ({ campaign_id: i.campaign, idempotency_key: randomUUID() }) },
  { fn: "ad-campaigns-pause-resume", flag: "module.campaigns", body: (_t, i) => ({ campaign_id: i.campaign, action: "resume" }) },
  { fn: "ad-campaigns-readiness", flag: "module.campaigns", body: (_t, i) => ({ campaign_id: i.campaign }) },
  { fn: "ad-campaigns-metrics-sync", flag: "module.campaigns", body: (_t, i) => ({ campaign_id: i.campaign }) },
  { fn: "ad-connection-health", flag: "module.campaigns", body: (t) => ({ workspace_id: t.workspaceId }) },
  { fn: "creative-studio-render", flag: "module.creative_studio", body: (t, i) => ({ workspace_id: t.workspaceId, action: "plan", batch_id: i.batch }) },
  { fn: "integrations-discover-resources", flag: "module.integrations", body: (t) => ({ workspace_id: t.workspaceId, provider: "meta" }) },
  { fn: "integrations-connection-health", flag: "module.integrations", body: (t) => ({ workspace_id: t.workspaceId, provider: "meta" }) },
  { fn: "inbox-actions", flag: "module.whatsapp", body: (t, i) => ({ workspace_id: t.workspaceId, conversation_id: i.conversation, action: "mark_read" }) },
];

async function call(t: TestTenant, fn: string, body: Record<string, unknown>) {
  const { data } = await t.client.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session!.access_token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

beforeAll(async () => {
  free = await createTestTenant("edge-gates-free");
  paid = await createTestTenant("edge-gates-paid");
  outsider = await createTestTenant("edge-gates-outsider");
  await enableModules(paid.workspaceId, ...ALL_MODULES);
  await seedWorkspace(free, ids.free);
  await seedWorkspace(paid, ids.paid);
});

afterAll(async () => {
  await cleanupTenant(free);
  await cleanupTenant(paid);
  await cleanupTenant(outsider);
});

describe("edge functions enforce module plans", () => {
  for (const c of GATED) {
    it(`${c.fn} (${c.flag})`, async () => {
      const refused = await call(free, c.fn, c.body(free, ids.free));
      expect(refused.status, `${c.fn} on Free`).toBe(403);
      expect(refused.body.code).toBe("MODULE_NOT_IN_PLAN");

      const allowed = await call(paid, c.fn, c.body(paid, ids.paid));
      expect(allowed.body.code, `${c.fn} with ${c.flag} on`).not.toBe("MODULE_NOT_IN_PLAN");

      const foreign = await call(outsider, c.fn, c.body(free, ids.free));
      expect(foreign.status, `${c.fn} from another workspace`).toBeGreaterThanOrEqual(400);
      expect(foreign.body.code).not.toBe("MODULE_NOT_IN_PLAN");
      expect(JSON.stringify(foreign.body)).not.toMatch(/plan/i);
    });
  }

  it("refused requests write nothing", async () => {
    const { count: pipelines } = await admin.from("pipelines").select("id", { count: "exact", head: true }).eq("workspace_id", free.workspaceId).like("name", "Gate %");
    expect(pipelines).toBe(0);
    const { count: schemas } = await admin.from("workspace_intake_schemas").select("id", { count: "exact", head: true }).eq("workspace_id", free.workspaceId);
    expect(schemas).toBe(0);
    const { count: revenue } = await admin.from("revenue_events").select("id", { count: "exact", head: true }).eq("workspace_id", free.workspaceId);
    expect(revenue).toBe(0);
    const { count: posts } = await admin.from("content_scheduled_posts").select("id", { count: "exact", head: true }).eq("workspace_id", free.workspaceId);
    expect(posts).toBe(1); // only the seeded one
  });

  it("a downgraded workspace can still pause a campaign", async () => {
    const r = await call(free, "ad-campaigns-pause-resume", { campaign_id: ids.free.campaign, action: "pause" });
    expect(r.body.code).not.toBe("MODULE_NOT_IN_PLAN");
  });

  it("a downgraded workspace can still export its existing module data", async () => {
    const { data } = await free.client.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/workspace-export`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session!.access_token}` },
      body: JSON.stringify({ workspace_id: free.workspaceId }),
    });
    expect(res.status).toBe(200);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const exported = Object.values(files).map((f) => strFromU8(f)).join("\n");
    expect(exported).toContain(ids.free.lead);
    expect(exported).toContain(ids.free.campaign);
  });

  it("a downgraded workspace can still disconnect an integration", async () => {
    const r = await call(free, "integrations-disconnect", { workspace_id: free.workspaceId, provider: "meta" });
    expect(r.body.code).not.toBe("MODULE_NOT_IN_PLAN");
    expect(r.status).toBe(200);
  });
});
