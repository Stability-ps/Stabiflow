// 20261025070000_integration_resources_server_managed. Connected-account
// rows (integrations, WhatsApp numbers, Facebook pages, Instagram accounts,
// Meta ad accounts) are created and changed by the server. Even on a plan
// with Integrations, a workspace's user can only switch a resource on/off
// (what the Integrations page does) and delete it - never claim a
// phone_number_id/page_id or repoint a row. Runs against LOCAL Supabase.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, enableModules, type TestTenant } from "./helpers";

const SERVER_ONLY = /Accounts are connected from the Integrations page/;
const TOGGLE_ONLY = /Only the on\/off setting of a connected account can be changed here/;
const uniq = () => randomUUID().slice(0, 8);

let growth: TestTenant;
let waIntegration: string;
let metaIntegration: string;

async function seed(table: string, row: Record<string, unknown>) {
  const { data, error } = await admin.from(table).insert(row).select("*").single();
  if (error) throw new Error(`seed ${table}: ${error.message}`);
  return data as Record<string, unknown>;
}

beforeAll(async () => {
  growth = await createTestTenant("integration-resources");
  await enableModules(growth.workspaceId, "module.integrations", "module.whatsapp");
  // The server (service role) can still create connected accounts.
  waIntegration = (await seed("workspace_integrations", { workspace_id: growth.workspaceId, provider: "whatsapp" })).id as string;
  metaIntegration = (await seed("workspace_integrations", { workspace_id: growth.workspaceId, provider: "meta" })).id as string;
});

afterAll(async () => cleanupTenant(growth));

const RESOURCES = [
  { table: "workspace_whatsapp_numbers", idColumn: "phone_number_id", build: () => ({ integration_id: waIntegration, phone_number_id: `squat-${uniq()}` }) },
  { table: "workspace_facebook_pages", idColumn: "page_id", build: () => ({ integration_id: metaIntegration, page_id: `squat-${uniq()}`, page_name: "Page" }) },
  { table: "workspace_instagram_accounts", idColumn: "ig_business_account_id", build: () => ({ integration_id: metaIntegration, ig_business_account_id: `squat-${uniq()}` }) },
  { table: "workspace_meta_ad_accounts", idColumn: "ad_account_id", build: () => ({ integration_id: metaIntegration, ad_account_id: `squat-${uniq()}` }) },
];

describe("connected-account rows are server-managed", () => {
  for (const r of RESOURCES) {
    it(`${r.table}: a user cannot create one, cannot change its ids, can toggle and delete it`, async () => {
      const { error: insertError } = await growth.client.from(r.table).insert({ workspace_id: growth.workspaceId, ...r.build() });
      expect(insertError?.code).toBe("42501");
      expect(insertError?.message).toMatch(SERVER_ONLY);

      const row = await seed(r.table, { workspace_id: growth.workspaceId, ...r.build() });

      const { error: repointError } = await growth.client.from(r.table).update({ [r.idColumn]: `squat-${uniq()}` }).eq("id", row.id as string);
      expect(repointError?.code).toBe("42501");
      expect(repointError?.message).toMatch(TOGGLE_ONLY);

      const { data: off, error: offError } = await growth.client.from(r.table).update({ is_active: false }).eq("id", row.id as string).select("is_active");
      expect(offError).toBeNull();
      expect(off?.[0]?.is_active).toBe(false);
      const { data: on, error: onError } = await growth.client.from(r.table).update({ is_active: true }).eq("id", row.id as string).select("is_active");
      expect(onError).toBeNull();
      expect(on?.[0]?.is_active).toBe(true);

      const { error: deleteError } = await growth.client.from(r.table).delete().eq("id", row.id as string);
      expect(deleteError).toBeNull();
      const { data: left } = await admin.from(r.table).select("id").eq("id", row.id as string);
      expect(left ?? []).toHaveLength(0);
    });
  }

  it("workspace_integrations: a user can neither create nor edit the integration itself", async () => {
    const other = await createTestTenant("integration-resources-new");
    await enableModules(other.workspaceId, "module.integrations", "module.whatsapp");
    const { error: insertError } = await other.client.from("workspace_integrations").insert({ workspace_id: other.workspaceId, provider: "whatsapp" });
    await cleanupTenant(other);
    expect(insertError?.code).toBe("42501");
    expect(insertError?.message).toMatch(SERVER_ONLY);

    const { error: updateError } = await growth.client.from("workspace_integrations").update({ status: "connected" }).eq("id", waIntegration);
    expect(updateError?.code).toBe("42501");
    expect(updateError?.message).toMatch(TOGGLE_ONLY);
  });

  it("the server can still update resources (health checks, intake schema)", async () => {
    const row = await seed("workspace_whatsapp_numbers", { workspace_id: growth.workspaceId, integration_id: waIntegration, phone_number_id: `srv-${uniq()}` });
    const { error } = await admin.from("workspace_whatsapp_numbers").update({ display_phone_number: "+27 82 000 0000", quality_rating: "GREEN" }).eq("id", row.id as string);
    expect(error).toBeNull();
    const { error: integrationError } = await admin.from("workspace_integrations").update({ last_health_check_status: "healthy" }).eq("id", waIntegration);
    expect(integrationError).toBeNull();
  });
});
