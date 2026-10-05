import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ADMIN_CONSOLE_ACTIONS, ADMIN_ROLES, can, EXPORT_DATASETS, OPERATOR_ADMIN_ACTIONS, ROLE_PERMISSIONS } from "./permissions.ts";
import { buildAlerts, type AttentionSignals } from "./attention.ts";
import { csvCell, exportFilename, toCsv } from "./csv.ts";

Deno.test("owner has every permission; nothing else manages staff", () => {
  for (const role of ADMIN_ROLES) {
    assertEquals(can(role, "admins.manage"), role === "owner", role);
  }
  assert(can("owner", "plans.manage"));
  assertFalse(can("admin", "plans.manage"));
});

Deno.test("support and analyst cannot move money or change configuration", () => {
  for (const role of ["support", "analyst"] as const) {
    for (const p of ["billing.manage", "plans.manage", "features.manage", "settings.manage", "businesses.manage", "users.manage"] as const) {
      assertFalse(can(role, p), `${role} ${p}`);
    }
  }
  assertFalse(can("analyst", "users.read"));
  assertFalse(can("analyst", "businesses.read"));
});

Deno.test("unknown or missing roles have no permissions", () => {
  assertFalse(can(null, "analytics.read"));
  assertFalse(can(undefined, "analytics.read"));
  // deno-lint-ignore no-explicit-any
  assertFalse(can("superuser" as any, "analytics.read"));
});

Deno.test("every mapped action uses a real permission held by the owner", () => {
  for (const p of [...Object.values(OPERATOR_ADMIN_ACTIONS), ...Object.values(ADMIN_CONSOLE_ACTIONS), ...Object.values(EXPORT_DATASETS).map((d) => d.permission)]) {
    assert(ROLE_PERMISSIONS.owner.includes(p), p);
  }
});

const EMPTY: AttentionSignals = {
  failed_webhooks: [], payment_problems: [], subscriptions_at_risk: [], automation_failures: [], publishing_failures: [],
  integration_problems: [], message_dead_letters: [], ai_24h: { calls: 0, failed: 0, at: null }, creative_failures: [],
  website_scan_failures: { failed: 0, total: 0, at: null }, near_limits: [], stale_checkouts: 0,
};

Deno.test("no signals means no alerts", () => {
  assertEquals(buildAlerts(EMPTY), []);
});

Deno.test("alerts are ranked by severity and link to the affected business", () => {
  const alerts = buildAlerts({
    ...EMPTY,
    near_limits: [{ workspace_id: "w1", workspace_name: "Acme", at: "2026-10-05T10:00:00Z", entitlement_key: "automation_runs", used: 90, limit_value: 100 }],
    failed_webhooks: [{ id: "e1", provider: "paystack", event_type: "charge.success", processing_result: "no transaction", at: "2026-10-01T10:00:00Z", workspace_id: null, workspace_name: null }],
    automation_failures: [{ automation_id: "a1", automation_name: "Welcome", failures: 6, at: "2026-10-04T10:00:00Z", workspace_id: "w2", workspace_name: "Beta" }],
  });
  assertEquals(alerts.map((a) => a.severity), ["critical", "high", "low"]);
  assertEquals(alerts[1].href, "/admin/businesses/w2");
  assertEquals(alerts[2].title, "Nearing automation runs allowance");
});

Deno.test("AI failure alert needs enough volume and a real failure rate", () => {
  assertEquals(buildAlerts({ ...EMPTY, ai_24h: { calls: 5, failed: 5, at: null } }), []);
  assertEquals(buildAlerts({ ...EMPTY, ai_24h: { calls: 100, failed: 5, at: null } }), []);
  const [a] = buildAlerts({ ...EMPTY, ai_24h: { calls: 100, failed: 35, at: null } });
  assertEquals(a.severity, "critical");
  assertEquals(a.title, "AI failure rate 35% in the last 24 hours");
});

Deno.test("expired tokens are high severity", () => {
  const now = new Date("2026-10-06T00:00:00Z");
  const [a] = buildAlerts({
    ...EMPTY,
    integration_problems: [{ id: "i1", provider: "meta", status: "connected", last_health_check_status: null, token_expires_at: "2026-10-05T00:00:00Z", webhook_subscription_status: null, at: null, workspace_id: "w", workspace_name: "W" }],
  }, now);
  assertEquals(a.title, "Meta access token expired");
  assertEquals(a.severity, "high");
});

Deno.test("csv escapes quotes, commas, newlines and neutralises formulas", () => {
  assertEquals(csvCell('a "b", c'), '"a ""b"", c"');
  assertEquals(csvCell("line\nbreak"), '"line\nbreak"');
  assertEquals(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assertEquals(csvCell("-12"), "'-12");
  assertEquals(csvCell(-12), "-12");
  assertEquals(csvCell(null), "");
  assertEquals(toCsv([{ key: "a", label: "A" }, { key: "b", label: "B" }], [{ a: 1, b: "x,y" }]), 'A,B\r\n1,"x,y"\r\n');
  assertEquals(exportFilename("users", new Date("2026-10-06T08:05:00Z")), "stabiflow-users-20261006-0805.csv");
});
