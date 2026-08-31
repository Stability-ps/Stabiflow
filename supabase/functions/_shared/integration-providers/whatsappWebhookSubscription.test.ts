import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fetchWabaSubscribedApps,
  parseSubscribedAppsResponse,
  subscribeAndVerifyWabas,
  subscribeWabaToApp,
  subscribeWhatsAppWebhooks,
  summarizeWebhookSubscription,
  verifyWhatsAppWebhooks,
} from "./whatsappWebhookSubscription.ts";

const CRED = { token: "vault-token-abc", apiVersion: "v21.0" };

// --- fetch stub -------------------------------------------------------------

type StubCall = { url: string; method: string };
type StubResponse = { status?: number; body: unknown } | ((call: StubCall) => { status?: number; body: unknown });

function withStubbedFetch(responder: StubResponse, run: (calls: StubCall[]) => Promise<void> | void) {
  const calls: StubCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || "GET").toUpperCase();
    calls.push({ url, method });
    const r = typeof responder === "function" ? responder({ url, method }) : responder;
    return Promise.resolve(new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  const restore = () => { globalThis.fetch = original; };
  const maybePromise = run(calls);
  if (maybePromise instanceof Promise) return maybePromise.finally(restore);
  restore();
  return Promise.resolve();
}

// Minimal chainable Supabase stub: records the last update payload.
function stubSupabase() {
  const updates: Array<{ table: string; payload: Record<string, unknown>; eqField: string; eqValue: unknown }> = [];
  return {
    updates,
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          return {
            eq(eqField: string, eqValue: unknown) {
              updates.push({ table, payload, eqField, eqValue });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

// --- parseSubscribedAppsResponse -----------------------------------------------

Deno.test("parseSubscribedAppsResponse reads the app id from whatsapp_business_api_data, a bare id, and tolerates junk", () => {
  assertEquals(
    parseSubscribedAppsResponse({ data: [{ whatsapp_business_api_data: { id: "app-1", name: "StabiFlow" } }, { id: "app-2" }] }),
    ["app-1", "app-2"],
  );
  assertEquals(parseSubscribedAppsResponse({}), []);
  assertEquals(parseSubscribedAppsResponse({ data: "not-an-array" }), []);
  assertEquals(parseSubscribedAppsResponse(null), []);
});

// --- summarizeWebhookSubscription --------------------------------------------

Deno.test("summarizeWebhookSubscription: no WABAs -> unknown", () => {
  assertEquals(summarizeWebhookSubscription([]).status, "unknown");
});

Deno.test("summarizeWebhookSubscription: every WABA subscribed -> subscribed", () => {
  assertEquals(
    summarizeWebhookSubscription([{ wabaId: "w1", subscribed: true, error: null }, { wabaId: "w2", subscribed: true, error: null }]).status,
    "subscribed",
  );
});

Deno.test("summarizeWebhookSubscription: any hard error -> error (never silently 'subscribed')", () => {
  assertEquals(
    summarizeWebhookSubscription([{ wabaId: "w1", subscribed: true, error: null }, { wabaId: "w2", subscribed: false, error: "token expired" }]).status,
    "error",
  );
});

Deno.test("summarizeWebhookSubscription: a confirmed-not-subscribed WABA with no error -> not_subscribed", () => {
  assertEquals(
    summarizeWebhookSubscription([{ wabaId: "w1", subscribed: false, error: null }]).status,
    "not_subscribed",
  );
});

// --- subscribeWabaToApp / fetchWabaSubscribedApps ----------------------------

Deno.test("subscribeWabaToApp POSTs to /{waba}/subscribed_apps and resolves on success", async () => {
  await withStubbedFetch({ body: { success: true } }, async (calls) => {
    await subscribeWabaToApp(CRED, "waba-123");
    assertEquals(calls.length, 1);
    assertEquals(calls[0].method, "POST");
    assertEquals(new URL(calls[0].url).pathname, "/v21.0/waba-123/subscribed_apps");
  });
});

Deno.test("subscribeWabaToApp throws a classified error on a Graph error body (expired token)", async () => {
  await withStubbedFetch({ status: 400, body: { error: { code: 190, message: "Session expired" } } }, async () => {
    await assertRejects(() => subscribeWabaToApp(CRED, "waba-123"));
  });
});

Deno.test("subscribeWabaToApp throws on a network failure", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new TypeError("connection refused"))) as typeof fetch;
  try {
    await assertRejects(() => subscribeWabaToApp(CRED, "waba-123"));
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("fetchWabaSubscribedApps GETs and returns the parsed id list", async () => {
  await withStubbedFetch({ body: { data: [{ whatsapp_business_api_data: { id: "the-app" } }] } }, async (calls) => {
    const ids = await fetchWabaSubscribedApps(CRED, "waba-9");
    assertEquals(ids, ["the-app"]);
    assertEquals(calls[0].method, "GET");
  });
});

// --- subscribeAndVerifyWabas -------------------------------------------------

Deno.test("subscribeAndVerifyWabas subscribes each distinct WABA EXACTLY once (1 POST + 1 verify GET per WABA) and only ever hits /subscribed_apps", async () => {
  await withStubbedFetch(
    (call) => (call.method === "GET" ? { body: { data: [{ whatsapp_business_api_data: { id: "app-x" } }] } } : { body: { success: true } }),
    async (calls) => {
      const result = await subscribeAndVerifyWabas(CRED, ["waba-a", "waba-b"], "app-x");
      assertEquals(result.status, "subscribed");
      assertEquals(result.perWaba.length, 2);

      const posts = calls.filter((c) => c.method === "POST");
      const gets = calls.filter((c) => c.method === "GET");
      assertEquals(posts.length, 2); // exactly one POST per WABA
      assertEquals(gets.length, 2); // exactly one verify GET per WABA
      assertEquals(posts.map((c) => new URL(c.url).pathname).sort(), ["/v21.0/waba-a/subscribed_apps", "/v21.0/waba-b/subscribed_apps"]);
      // No outbound message path is ever touched.
      assertEquals(calls.every((c) => c.url.includes("/subscribed_apps")), true);
      assertEquals(calls.some((c) => c.url.includes("/messages")), false);
    },
  );
});

Deno.test("subscribeAndVerifyWabas NEVER throws when a POST fails - it records the failure and reports not-healthy", async () => {
  await withStubbedFetch({ status: 403, body: { error: { code: 200, message: "Permissions error" } } }, async () => {
    const result = await subscribeAndVerifyWabas(CRED, ["waba-a"], "app-x");
    // did not throw; surfaced as a non-subscribed state
    assertEquals(result.status === "not_subscribed" || result.status === "error", true);
    assertEquals(result.perWaba[0].subscribed, false);
    assertEquals(typeof result.perWaba[0].error, "string");
  });
});

Deno.test("subscribeAndVerifyWabas trusts a successful POST even if the verify GET fails", async () => {
  await withStubbedFetch(
    (call) => (call.method === "GET" ? { status: 500, body: { error: { message: "transient" } } } : { body: { success: true } }),
    async () => {
      const result = await subscribeAndVerifyWabas(CRED, ["waba-a"], "app-x");
      assertEquals(result.status, "subscribed");
      assertEquals(result.perWaba[0].subscribed, true);
    },
  );
});

// --- subscribeWhatsAppWebhooks (persisting wrapper) --------------------------

Deno.test("subscribeWhatsAppWebhooks in MOCK MODE makes ZERO Graph API calls and records 'subscribed'", async () => {
  await withStubbedFetch({ body: {} }, async (calls) => {
    const sb = stubSupabase();
    const result = await subscribeWhatsAppWebhooks(sb, "integration-1", CRED, ["waba-a", "waba-b"], /* mockMode */ true, "app-x");
    assertEquals(calls.length, 0); // <-- the critical assertion: no real call in tests
    assertEquals(result.status, "subscribed");
    assertEquals(sb.updates.length, 1);
    assertEquals(sb.updates[0].table, "workspace_integrations");
    assertEquals(sb.updates[0].payload.webhook_subscription_status, "subscribed");
    assertEquals(sb.updates[0].eqValue, "integration-1");
  });
});

Deno.test("subscribeWhatsAppWebhooks with no discovered WABA records 'unknown' and makes no call", async () => {
  await withStubbedFetch({ body: {} }, async (calls) => {
    const sb = stubSupabase();
    const result = await subscribeWhatsAppWebhooks(sb, "integration-1", CRED, [], false, "app-x");
    assertEquals(calls.length, 0);
    assertEquals(result.status, "unknown");
    assertEquals(sb.updates[0].payload.webhook_subscription_status, "unknown");
  });
});

Deno.test("no discovered WABA -> 'unknown' EVEN IN MOCK MODE (a zero-WABA integration is never a vacuous 'subscribed')", async () => {
  await withStubbedFetch({ body: {} }, async (calls) => {
    const sb = stubSupabase();
    const subResult = await subscribeWhatsAppWebhooks(sb, "integration-1", CRED, [], /* mockMode */ true, "app-x");
    assertEquals(subResult.status, "unknown");
    const verResult = await verifyWhatsAppWebhooks(sb, "integration-1", CRED, [], /* mockMode */ true, "app-x");
    assertEquals(verResult.status, "unknown");
    assertEquals(calls.length, 0);
  });
});

Deno.test("subscribeWhatsAppWebhooks de-duplicates a repeated WABA id (one POST, not two)", async () => {
  await withStubbedFetch(
    (call) => (call.method === "GET" ? { body: { data: [{ id: "app-x" }] } } : { body: { success: true } }),
    async (calls) => {
      const sb = stubSupabase();
      const result = await subscribeWhatsAppWebhooks(sb, "integration-1", CRED, ["waba-a", "waba-a", "waba-a"], false, "app-x");
      assertEquals(result.perWaba.length, 1);
      assertEquals(calls.filter((c) => c.method === "POST").length, 1);
      assertEquals(result.status, "subscribed");
    },
  );
});

Deno.test("subscribeWhatsAppWebhooks records 'error' (not healthy) when Meta rejects the subscribe", async () => {
  await withStubbedFetch({ status: 400, body: { error: { code: 190, message: "expired" } } }, async () => {
    const sb = stubSupabase();
    const result = await subscribeWhatsAppWebhooks(sb, "integration-1", CRED, ["waba-a"], false, "app-x");
    assertEquals(result.status === "error" || result.status === "not_subscribed", true);
    assertEquals(sb.updates[0].payload.webhook_subscription_status, result.status);
    assertEquals(["error", "not_subscribed"].includes(String(sb.updates[0].payload.webhook_subscription_status)), true);
  });
});

// --- verifyWhatsAppWebhooks (read-only) ------------------------------------

Deno.test("verifyWhatsAppWebhooks only ever GETs - it never POSTs a subscription", async () => {
  await withStubbedFetch({ body: { data: [{ id: "app-x" }] } }, async (calls) => {
    const sb = stubSupabase();
    const result = await verifyWhatsAppWebhooks(sb, "integration-1", CRED, ["waba-a"], false, "app-x");
    assertEquals(calls.every((c) => c.method === "GET"), true);
    assertEquals(calls.some((c) => c.method === "POST"), false);
    assertEquals(result.status, "subscribed");
  });
});

Deno.test("verifyWhatsAppWebhooks in mock mode makes no call", async () => {
  await withStubbedFetch({ body: {} }, async (calls) => {
    const sb = stubSupabase();
    await verifyWhatsAppWebhooks(sb, "integration-1", CRED, ["waba-a"], true, "app-x");
    assertEquals(calls.length, 0);
  });
});
