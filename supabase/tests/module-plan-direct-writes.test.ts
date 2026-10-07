// 20261025060000_enforce_module_plan_on_direct_writes. Direct Data API
// writes to module-owned tables follow the workspace's plan, exactly like
// the UI and the module edge functions:
// - module off: the workspace's own user cannot INSERT or UPDATE (42501),
//   but can still read and DELETE;
// - module on: the same writes succeed;
// - service-role writes (edge functions) and SECURITY DEFINER functions
//   (create_workspace's default pipeline) are not affected;
// - shared tables written by Free screens stay writable on Free.
// Runs against LOCAL Supabase with real RLS.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, enableModules, type TestTenant } from "./helpers";

type Row = Record<string, unknown>;
type Spec = {
  table: string;
  flag: string;
  message: RegExp;
  // Builds a valid new row from the fixture ids (fresh unique values each call).
  build: (f: Fixture) => Row;
  // Primary key used to address one row.
  key?: (row: Row) => Row;
  canInsert: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  // Column + value for a no-op update when the table has no workspace_id.
  noopUpdate?: (row: Row) => Row;
  // Rows only the server may create (20261025070000): with the module on, a
  // client insert is still refused, by this message.
  serverOnlyInsert?: RegExp;
  // Same for updates (workspace_integrations is never edited by clients).
  serverOnlyUpdate?: RegExp;
};

type Fixture = { ws: string; userId: string; ids: Record<string, string> };

const LEADS = /Leads are part of the Business and Growth plans/;
const CUSTOMERS = /Customers are part of the Business and Growth plans/;
const CAMPAIGNS = /Campaigns are part of the Growth plan/;
const CONTENT = /Content is part of the Business and Growth plans/;
const CREATIVE = /Creative Studio is part of the Growth plan/;
const AUTOMATIONS = /Automations are part of the Growth plan/;
const WHATSAPP = /WhatsApp is part of the Growth plan/;
const INTEGRATIONS = /Integrations are part of the Growth plan/;
const FLOW_AI = /Flow AI is part of the Growth plan/;
const SERVER_ONLY = /Accounts are connected from the Integrations page/;
const TOGGLE_ONLY = /Only the on\/off setting of a connected account can be changed here/;

const uniq = () => randomUUID().slice(0, 8);
const PLATFORMS = ["facebook", "instagram", "linkedin"];
let platformCursor = 0;
let dayCursor = 0;

const SPECS: Spec[] = [
  { table: "leads", flag: "module.leads", message: LEADS, canInsert: true, canUpdate: true, canDelete: false,
    build: (f) => ({ workspace_id: f.ws, source: "manual", contact_name: `Gate ${uniq()}` }) },
  { table: "opportunities", flag: "module.leads", message: LEADS, canInsert: true, canUpdate: true, canDelete: false,
    build: (f) => ({ workspace_id: f.ws, lead_id: f.ids.lead, title: `Gate ${uniq()}` }) },
  { table: "crm_notes", flag: "module.leads", message: LEADS, canInsert: true, canUpdate: false, canDelete: false,
    build: (f) => ({ workspace_id: f.ws, target_type: "lead", target_id: f.ids.lead, author_id: f.userId, author_name: "Gate", body: "note" }) },
  { table: "pipelines", flag: "module.leads", message: LEADS, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, name: `Gate ${uniq()}` }) },
  { table: "pipeline_stages", flag: "module.leads", message: LEADS, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, pipeline_id: f.ids.pipeline, name: `Gate ${uniq()}` }) },
  { table: "revenue_events", flag: "module.customers", message: CUSTOMERS, canInsert: true, canUpdate: true, canDelete: false,
    build: (f) => ({ workspace_id: f.ws, lead_id: f.ids.lead, amount_minor: 100, currency: "ZAR", event_type: "sale" }) },
  { table: "attribution_events", flag: "module.campaigns", message: CAMPAIGNS, canInsert: true, canUpdate: false, canDelete: false,
    build: (f) => ({ workspace_id: f.ws, event_type: "lead_created", lead_id: f.ids.lead }) },
  { table: "campaign_entry_tokens", flag: "module.campaigns", message: CAMPAIGNS, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, token: `gate-${uniq()}` }) },
  { table: "ad_campaigns", flag: "module.campaigns", message: CAMPAIGNS, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, integration_id: f.ids.metaIntegration, ad_account_id: f.ids.adAccount, name: `Gate ${uniq()}`, objective: "OUTCOME_TRAFFIC", currency: "ZAR", budget_type: "daily", daily_budget_minor_units: 1000 }) },
  { table: "ad_creatives", flag: "module.campaigns", message: CAMPAIGNS, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, media_asset_id: f.ids.media, primary_text: "Gate", cta: "LEARN_MORE" }) },
  { table: "content_scheduled_posts", flag: "module.content", message: CONTENT, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, media_asset_id: f.ids.media, target_platform: "facebook", facebook_page_id: f.ids.fbPage, scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), caption: "Gate", idempotency_key: `gate-${uniq()}` }) },
  { table: "content_series", flag: "module.content", message: CONTENT, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, name: `Gate ${uniq()}`, start_at: new Date().toISOString() }) },
  { table: "content_series_items", flag: "module.content", message: CONTENT, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, series_id: f.ids.series, media_asset_id: f.ids.media, position: Math.floor(Math.random() * 100000) + 1 }) },
  { table: "content_series_excluded_dates", flag: "module.content", message: CONTENT, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, series_id: f.ids.series, excluded_date: new Date(Date.UTC(2030, 0, 1 + Math.floor(Math.random() * 3000))).toISOString().slice(0, 10) }) },
  { table: "content_platform_variants", flag: "module.content", message: CONTENT, canInsert: true, canUpdate: true, canDelete: true,
    // One variant per (media asset, platform): each build takes the next platform.
    build: (f) => ({ workspace_id: f.ws, media_asset_id: f.ids.media, platform: PLATFORMS[platformCursor++ % PLATFORMS.length], storage_path: `${f.ws}/gate-${uniq()}.png`, width_px: 1080, height_px: 1080, aspect_ratio: 1, mime_type: "image/png", file_size_bytes: 100 }) },
  { table: "content_publish_attempts", flag: "module.content", message: CONTENT, canInsert: true, canUpdate: false, canDelete: false,
    build: (f) => ({ workspace_id: f.ws, scheduled_post_id: f.ids.post, attempt_number: Math.floor(Math.random() * 100000) + 1, status: "success", started_at: new Date().toISOString(), finished_at: new Date().toISOString() }) },
  { table: "creative_studio_batches", flag: "module.creative_studio", message: CREATIVE, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, business_context: `Gate ${uniq()}` }) },
  { table: "creative_studio_concepts", flag: "module.creative_studio", message: CREATIVE, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, batch_id: f.ids.batch, concept_name: "Gate", headline: "Gate", supporting_text: "Gate", cta: "Go", visual_prompt: "Gate" }) },
  { table: "creative_studio_creatives", flag: "module.creative_studio", message: CREATIVE, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, batch_id: f.ids.batch, concept_id: f.ids.concept, layout: "split", size: `s-${uniq()}`, width_px: 1080, height_px: 1080, headline: "Gate", body_text: "Gate", cta: "Go" }) },
  { table: "automations", flag: "module.automations", message: AUTOMATIONS, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, name: `Gate ${uniq()}`, trigger_event_type: "message.received", created_by: f.userId }) },
  { table: "automation_actions", flag: "module.automations", message: AUTOMATIONS, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, automation_id: f.ids.automation, action_type: "create_internal_note" }) },
  { table: "automation_conditions", flag: "module.automations", message: AUTOMATIONS, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, automation_id: f.ids.automation, field: "text", operator: "contains" }) },
  { table: "inbox_conversations", flag: "module.whatsapp", message: WHATSAPP, canInsert: false, canUpdate: true, canDelete: false,
    build: (f) => { const wa = `2782${Math.floor(Math.random() * 1e7)}`; return { workspace_id: f.ws, whatsapp_number_id: f.ids.number, wa_id: wa, phone_number: `+${wa}` }; } },
  { table: "inbox_alerts", flag: "module.whatsapp", message: WHATSAPP, canInsert: false, canUpdate: true, canDelete: false,
    build: (f) => ({ workspace_id: f.ws, conversation_id: f.ids.conversation, alert_type: "customer_reply", title: "Gate" }) },
  { table: "inbox_internal_notes", flag: "module.whatsapp", message: WHATSAPP, canInsert: true, canUpdate: false, canDelete: false,
    build: (f) => ({ workspace_id: f.ws, conversation_id: f.ids.conversation, author_id: f.userId, author_name: "Gate", body: "note" }) },
  { table: "inbox_conversation_reads", flag: "module.whatsapp", message: WHATSAPP, canInsert: true, canUpdate: true, canDelete: false,
    // Keyed by (conversation_id, staff_id): each build uses a fresh conversation.
    build: (f) => ({ conversation_id: f.ids.nextConversation(), staff_id: f.userId, last_read_at: new Date().toISOString() }) as Row,
    key: (row) => ({ conversation_id: row.conversation_id, staff_id: row.staff_id }),
    noopUpdate: (row) => ({ last_read_at: row.last_read_at }) },
  { table: "workspace_business_hours", flag: "module.whatsapp", message: WHATSAPP, canInsert: true, canUpdate: true, canDelete: true,
    // One row per (workspace, day): each build takes the next day.
    build: (f) => ({ workspace_id: f.ws, day_of_week: (dayCursor++ % 7) + 1, is_open: false }) },
  // Deleting the integration itself is refused by its foreign keys (numbers,
  // pages, ad accounts), not by the plan trigger, so only insert/update here.
  { table: "workspace_integrations", flag: "module.integrations", message: INTEGRATIONS, serverOnlyUpdate: TOGGLE_ONLY, canInsert: false, canUpdate: true, canDelete: false,
    build: (f) => ({ workspace_id: f.ws, provider: "meta" }) },
  { table: "workspace_whatsapp_numbers", flag: "module.integrations", message: INTEGRATIONS, serverOnlyInsert: SERVER_ONLY, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, integration_id: f.ids.waIntegration, phone_number_id: `gate-${uniq()}` }) },
  { table: "workspace_facebook_pages", flag: "module.integrations", message: INTEGRATIONS, serverOnlyInsert: SERVER_ONLY, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, integration_id: f.ids.metaIntegration, page_id: `gate-${uniq()}`, page_name: "Gate" }) },
  { table: "workspace_instagram_accounts", flag: "module.integrations", message: INTEGRATIONS, serverOnlyInsert: SERVER_ONLY, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, integration_id: f.ids.metaIntegration, ig_business_account_id: `gate-${uniq()}` }) },
  { table: "workspace_meta_ad_accounts", flag: "module.integrations", message: INTEGRATIONS, serverOnlyInsert: SERVER_ONLY, canInsert: true, canUpdate: true, canDelete: true,
    build: (f) => ({ workspace_id: f.ws, integration_id: f.ids.metaIntegration, ad_account_id: `gate-${uniq()}` }) },
  { table: "ai_conversations", flag: "module.flow_ai", message: FLOW_AI, canInsert: true, canUpdate: true, canDelete: false,
    build: (f) => ({ workspace_id: f.ws, created_by: f.userId }) },
];

let tenant: TestTenant;
let fixture: Fixture & { ids: Fixture["ids"] & { nextConversation: () => string } };
const extraConversations: string[] = [];

async function seed(table: string, row: Row): Promise<Row> {
  const { data, error } = await admin.from(table).insert(row).select("*").single();
  if (error) throw new Error(`seed ${table}: ${error.message}`);
  return data as Row;
}

async function setModules(on: boolean, ...flags: string[]) {
  if (on) return enableModules(tenant.workspaceId, ...flags);
  const { error } = await admin.from("feature_flag_workspace_targets").delete().eq("workspace_id", tenant.workspaceId).in("flag_key", flags);
  if (error) throw new Error(error.message);
}

function keyOf(spec: Spec, row: Row): Row {
  return spec.key ? spec.key(row) : { id: row.id };
}

function matchKey<T extends { eq: (c: string, v: unknown) => T }>(q: T, key: Row): T {
  return Object.entries(key).reduce((acc, [c, v]) => acc.eq(c, v), q);
}

beforeAll(async () => {
  tenant = await createTestTenant("module-plan-writes");
  const ws = tenant.workspaceId;
  const { data: session } = await tenant.client.auth.getSession();
  const userId = session.session!.user.id;
  // Everything below is written by the service role while every module is
  // OFF for this Free workspace: the triggers must not block it.
  const ids: Record<string, string> = {};
  ids.waIntegration = (await seed("workspace_integrations", { workspace_id: ws, provider: "whatsapp" })).id as string;
  ids.metaIntegration = (await seed("workspace_integrations", { workspace_id: ws, provider: "meta" })).id as string;
  ids.number = (await seed("workspace_whatsapp_numbers", { workspace_id: ws, integration_id: ids.waIntegration, phone_number_id: `gate-${uniq()}` })).id as string;
  ids.fbPage = (await seed("workspace_facebook_pages", { workspace_id: ws, integration_id: ids.metaIntegration, page_id: `gate-${uniq()}`, page_name: "Gate" })).id as string;
  ids.adAccount = (await seed("workspace_meta_ad_accounts", { workspace_id: ws, integration_id: ids.metaIntegration, ad_account_id: `gate-${uniq()}` })).id as string;
  ids.media = (await seed("content_media_assets", { workspace_id: ws, title: "Gate", storage_path: `${ws}/gate.png`, mime_type: "image/png", width_px: 1080, height_px: 1080, aspect_ratio: 1, file_size_bytes: 100, checksum_sha256: "c".repeat(64) })).id as string;
  ids.series = (await seed("content_series", { workspace_id: ws, name: "Gate", start_at: new Date().toISOString() })).id as string;
  ids.post = (await seed("content_scheduled_posts", { workspace_id: ws, media_asset_id: ids.media, target_platform: "facebook", facebook_page_id: ids.fbPage, scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), caption: "Gate", idempotency_key: `gate-${uniq()}` })).id as string;
  ids.batch = (await seed("creative_studio_batches", { workspace_id: ws, business_context: "Gate" })).id as string;
  ids.concept = (await seed("creative_studio_concepts", { workspace_id: ws, batch_id: ids.batch, concept_name: "Gate", headline: "Gate", supporting_text: "Gate", cta: "Go", visual_prompt: "Gate" })).id as string;
  ids.automation = (await seed("automations", { workspace_id: ws, name: "Gate", trigger_event_type: "message.received", created_by: userId })).id as string;
  ids.pipeline = (await seed("pipelines", { workspace_id: ws, name: "Gate" })).id as string;
  ids.lead = (await seed("leads", { workspace_id: ws, source: "manual", contact_name: "Gate" })).id as string;
  ids.conversation = (await seed("inbox_conversations", { workspace_id: ws, whatsapp_number_id: ids.number, wa_id: "27820000001", phone_number: "+27820000001" })).id as string;
  fixture = {
    ws,
    userId,
    ids: Object.assign(ids, {
      nextConversation: () => {
        const id = extraConversations.shift();
        if (!id) throw new Error("out of spare conversations");
        return id;
      },
    }),
  };
  for (let i = 0; i < 4; i++) {
    const wa = `2782100000${i}`;
    extraConversations.push((await seed("inbox_conversations", { workspace_id: ws, whatsapp_number_id: ids.number, wa_id: wa, phone_number: `+${wa}` })).id as string);
  }
});

afterAll(async () => cleanupTenant(tenant));

describe("module-owned tables follow the plan for direct writes", () => {
  for (const spec of SPECS) {
    it(`${spec.table} (${spec.flag})`, async () => {
      await setModules(false, spec.flag);

      // Service role can write while the module is off (edge functions).
      const fixtureRow = spec.table === "workspace_integrations"
          ? ((await admin.from(spec.table).select("*").eq("id", fixture.ids.metaIntegration).single()).data as Row)
          : await seed(spec.table, spec.build(fixture));
      expect(fixtureRow).toBeTruthy();
      const key = keyOf(spec, fixtureRow);
      const noop = spec.noopUpdate ? spec.noopUpdate(fixtureRow) : { workspace_id: fixture.ws };

      // Module OFF: the workspace's own user cannot insert or update.
      if (spec.canInsert) {
        const { error } = await tenant.client.from(spec.table).insert(spec.build(fixture));
        expect(error?.code, `${spec.table} insert while off`).toBe("42501");
        expect(error?.message).toMatch(spec.message);
      }
      if (spec.canUpdate) {
        const { error } = await matchKey(tenant.client.from(spec.table).update(noop), key);
        expect(error?.code, `${spec.table} update while off`).toBe("42501");
        expect(error?.message).toMatch(spec.message);
      }
      // ...but can still read it.
      const { data: readable } = await matchKey(tenant.client.from(spec.table).select("*"), key);
      expect((readable ?? []).length, `${spec.table} readable while off`).toBe(1);

      // Module ON: the same writes succeed.
      await setModules(true, spec.flag);
      let inserted: Row | null = null;
      if (spec.canInsert && spec.serverOnlyInsert) {
        const { error } = await tenant.client.from(spec.table).insert(spec.build(fixture));
        expect(error?.code, `${spec.table} client insert while on`).toBe("42501");
        expect(error?.message).toMatch(spec.serverOnlyInsert);
      } else if (spec.canInsert) {
        const { data, error } = await tenant.client.from(spec.table).insert(spec.build(fixture)).select("*").single();
        expect(error, `${spec.table} insert while on`).toBeNull();
        inserted = data as Row;
      }
      if (spec.canUpdate && spec.serverOnlyUpdate) {
        const { error } = await matchKey(tenant.client.from(spec.table).update(noop), key);
        expect(error?.code, `${spec.table} client update while on`).toBe("42501");
        expect(error?.message).toMatch(spec.serverOnlyUpdate);
      } else if (spec.canUpdate) {
        const { data, error } = await matchKey(tenant.client.from(spec.table).update(noop), key).select("*");
        expect(error, `${spec.table} update while on`).toBeNull();
        expect((data ?? []).length).toBe(1);
      }

      // Module OFF again: delete still works (downgraded workspaces can remove data).
      await setModules(false, spec.flag);
      if (spec.canDelete) {
        const target = inserted ?? fixtureRow;
        const targetKey = keyOf(spec, target);
        const { error } = await matchKey(tenant.client.from(spec.table).delete(), targetKey);
        expect(error, `${spec.table} delete while off`).toBeNull();
        const { data: left } = await matchKey(admin.from(spec.table).select("*"), targetKey);
        expect((left ?? []).length, `${spec.table} deleted while off`).toBe(0);
      }
    });
  }
});

describe("what the triggers deliberately leave alone", () => {
  it("a Free workspace still gets its default pipeline from create_workspace (SECURITY DEFINER)", async () => {
    const { count } = await admin.from("pipelines").select("id", { count: "exact", head: true }).eq("workspace_id", tenant.workspaceId).eq("is_default", true);
    expect(count).toBe(1);
  });

  it("Free can still write the shared brand kit and media library used by My Business", async () => {
    await setModules(false, "module.content", "module.creative_studio");
    const { error: brandError } = await tenant.client.from("creative_brand_profiles").insert({ workspace_id: tenant.workspaceId, name: "Brand", company_name: "Gate Co" });
    expect(brandError).toBeNull();
    const { error: mediaError } = await tenant.client.from("content_media_assets").insert({ workspace_id: tenant.workspaceId, title: "Logo", storage_path: `${tenant.workspaceId}/logo.png`, mime_type: "image/png", width_px: 10, height_px: 10, aspect_ratio: 1, file_size_bytes: 10, checksum_sha256: "d".repeat(64) });
    expect(mediaError).toBeNull();
  });

  it("another workspace's member cannot write either (RLS still applies first)", async () => {
    const other = await createTestTenant("module-plan-writes-other");
    await enableModules(other.workspaceId, "module.leads");
    const { error } = await other.client.from("leads").insert({ workspace_id: tenant.workspaceId, source: "manual", contact_name: "Intruder" });
    await cleanupTenant(other);
    expect(error).not.toBeNull();
  });
});
