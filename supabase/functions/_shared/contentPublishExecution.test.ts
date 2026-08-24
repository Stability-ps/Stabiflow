import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { claimScheduledPost, executePublish, type PublishablePost } from "./contentPublishExecution.ts";

const EXEC_OPTS = { metaApiVersion: "v20.0" };

// A minimal in-memory stand-in for the Supabase-backed tables/RPCs
// executePublish/claimScheduledPost touch. Every read/write is keyed by row
// id, so a test can assert "post B's row/attempts/log are untouched" after
// only post A was processed.
function makeFakeStore(options: {
  posts: PublishablePost[];
  assets?: Record<string, { storage_path: string }>;
  facebookPages?: Record<string, { page_id: string; integration_id: string; workspace_id: string }>;
  instagramAccounts?: Record<string, { ig_business_account_id: string; integration_id: string; workspace_id: string }>;
  integrations?: Record<string, { id: string; workspace_id: string; status: string }>;
  tokensByIntegrationId?: Record<string, string>;
}) {
  const scheduledPosts = new Map(options.posts.map((p) => [p.id, { ...p }]));
  const assets = options.assets || {};
  const facebookPages = options.facebookPages || {};
  const instagramAccounts = options.instagramAccounts || {};
  const integrations = options.integrations || {};
  const tokensByIntegrationId = options.tokensByIntegrationId || {};
  const publishAttempts: Record<string, unknown>[] = [];
  const activityLog: Record<string, unknown>[] = [];

  function singleLookup(table: Record<string, unknown>) {
    return { select: () => ({ eq: (_col: string, id: string) => ({ single: async () => ({ data: table[id] || null, error: table[id] ? null : { message: "not found" } }) }) }) };
  }

  // deno-lint-ignore no-explicit-any
  const sb: any = {
    from(table: string) {
      if (table === "content_media_assets" || table === "content_platform_variants") return singleLookup(assets);
      if (table === "workspace_facebook_pages") return singleLookup(facebookPages);
      if (table === "workspace_instagram_accounts") return singleLookup(instagramAccounts);
      if (table === "workspace_integrations") return singleLookup(integrations);
      if (table === "content_publish_attempts") return { insert: async (row: Record<string, unknown>) => { publishAttempts.push(row); return { error: null }; } };
      if (table === "workspace_activity_log") return { insert: async (row: Record<string, unknown>) => { activityLog.push(row); return { error: null }; } };
      if (table === "content_scheduled_posts") {
        return {
          update(patch: Record<string, unknown>) {
            return {
              eq(_col1: string, id: string) {
                const eqChain = {
                  // claimScheduledPost: .update().eq("id",x).eq("status","scheduled").select(...).maybeSingle()
                  eq(_col2: string, expectedStatus: string) {
                    return {
                      select: () => ({
                        async maybeSingle() {
                          const row = scheduledPosts.get(id);
                          if (!row || row.status !== expectedStatus) return { data: null, error: null };
                          Object.assign(row, patch);
                          return { data: { ...row }, error: null };
                        },
                      }),
                    };
                  },
                  // executePublish's final write: .update().eq("id",x) awaited directly, no second eq/select.
                  then(resolve: (v: { data: null; error: null }) => void) {
                    const row = scheduledPosts.get(id);
                    if (row) Object.assign(row, patch);
                    resolve({ data: null, error: null });
                  },
                };
                return eqChain;
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table in fake store: ${table}`);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "get_workspace_integration_secret") {
        const integrationId = args.p_integration_id as string;
        const token = tokensByIntegrationId[integrationId];
        return { data: token ?? null, error: token ? null : { message: "no secret" } };
      }
      throw new Error(`Unexpected rpc in fake store: ${name}`);
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}` }, error: null }),
      }),
    },
  };

  return { sb, scheduledPosts, publishAttempts, activityLog };
}

function makePost(overrides: Partial<PublishablePost> = {}): PublishablePost {
  return {
    id: "post-A",
    workspace_id: "ws-1",
    series_id: null,
    media_asset_id: "asset-1",
    platform_variant_id: null,
    target_platform: "facebook",
    facebook_page_id: "page-1",
    instagram_account_id: null,
    caption: "Hello",
    hashtags: [],
    attempt_count: 0,
    status: "scheduled",
    ...overrides,
  };
}

const DEFAULT_FIXTURES = {
  assets: { "asset-1": { storage_path: "orig/a.jpg" } },
  facebookPages: { "page-1": { page_id: "111222333", integration_id: "integration-1", workspace_id: "ws-1" } },
  integrations: { "integration-1": { id: "integration-1", workspace_id: "ws-1", status: "connected" } },
  tokensByIntegrationId: { "integration-1": "test-meta-token" },
};

function mockFetchOnce(handler: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = async (input: string | URL | Request, init?: RequestInit) => handler(input, init);
  return () => { globalThis.fetch = original; };
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

Deno.test("REGRESSION: executePublish on post A never touches post B's row, attempts, or log", async () => {
  const postA = makePost({ id: "post-A" });
  const postB = makePost({ id: "post-B" });
  const store = makeFakeStore({ posts: [postA, postB], ...DEFAULT_FIXTURES });

  const restore = mockFetchOnce(() => jsonResponse({ post_id: "pid_1" }));
  try {
    await executePublish(store.sb, postA, { triggeredBy: "manual_admin", actorUserId: "admin-1", ...EXEC_OPTS });
  } finally {
    restore();
  }

  assertEquals(store.scheduledPosts.get("post-A")?.status, "published");
  assertEquals(store.scheduledPosts.get("post-B")?.status, "scheduled", "post B must be completely untouched");
  assertEquals(store.publishAttempts.length, 1);
  assertEquals(store.activityLog.length, 1);
  assertEquals(store.activityLog[0].target_id, "post-A");
});

Deno.test("provider success: marks published, stores provider_post_id/permalink, sets published_at", async () => {
  const post = makePost();
  const store = makeFakeStore({ posts: [post], ...DEFAULT_FIXTURES });
  const restore = mockFetchOnce(() => jsonResponse({ post_id: "pid_42" }));
  let result;
  try {
    result = await executePublish(store.sb, post, { triggeredBy: "manual_admin", actorUserId: "admin-1", ...EXEC_OPTS });
  } finally {
    restore();
  }
  assertEquals(result.status, "published");
  assertEquals(result.outcome.kind, "success");
  const row = store.scheduledPosts.get("post-A")!;
  assertEquals(row.status, "published");
  assertEquals((row as unknown as { provider_post_id: string }).provider_post_id, "pid_42");
  assertEquals((row as unknown as { provider_permalink: string }).provider_permalink, "https://www.facebook.com/pid_42");
  assert((row as unknown as { published_at: string }).published_at);
  assertEquals(store.publishAttempts[0].status, "success");
  assertEquals(store.activityLog[0].action, "content_post_published");
});

Deno.test("provider temporary failure (5xx): post returns to scheduled with a retry time, not failed", async () => {
  const post = makePost();
  const store = makeFakeStore({ posts: [post], ...DEFAULT_FIXTURES });
  const restore = mockFetchOnce(() => jsonResponse({ error: { message: "server busy" } }, 503));
  let result;
  try {
    result = await executePublish(store.sb, post, { triggeredBy: "system_cron", ...EXEC_OPTS });
  } finally {
    restore();
  }
  assertEquals(result.outcome.kind, "temporary_failure");
  assertEquals(result.status, "scheduled");
  const row = store.scheduledPosts.get("post-A")!;
  assertEquals(row.status, "scheduled");
  assert((row as unknown as { next_retry_at: string }).next_retry_at);
  assertEquals(store.publishAttempts[0].status, "temporary_failure");
  assertEquals(store.activityLog[0].action, "content_post_publish_retry_scheduled");
});

Deno.test("provider permanent failure (invalid token, code 190): post is marked failed, not retried", async () => {
  const post = makePost();
  const store = makeFakeStore({ posts: [post], ...DEFAULT_FIXTURES });
  const restore = mockFetchOnce(() => jsonResponse({ error: { code: 190, message: "Invalid OAuth access token" } }, 400));
  let result;
  try {
    result = await executePublish(store.sb, post, { triggeredBy: "manual_admin", actorUserId: "admin-1", ...EXEC_OPTS });
  } finally {
    restore();
  }
  assertEquals(result.outcome.kind, "permanent_failure");
  assertEquals(result.status, "failed");
  const row = store.scheduledPosts.get("post-A")!;
  assertEquals(row.status, "failed");
  assertEquals((row as unknown as { failure_code: string }).failure_code, "meta_190");
  assertEquals((row as unknown as { next_retry_at: string | null }).next_retry_at, null);
  assertEquals(store.activityLog[0].action, "content_post_publish_failed");
});

Deno.test("a variant-linked post publishes the variant's storage path, not the original's", async () => {
  const post = makePost({ platform_variant_id: "variant-1" });
  const store = makeFakeStore({
    posts: [post],
    ...DEFAULT_FIXTURES,
    assets: { "variant-1": { storage_path: "variants/ig.png" }, "asset-1": { storage_path: "orig/a.jpg" } },
  });
  let capturedUrl = "";
  const restore = mockFetchOnce((_input, init) => {
    capturedUrl = String(JSON.parse(String(init?.body)).url);
    return jsonResponse({ post_id: "pid_1" });
  });
  try {
    await executePublish(store.sb, post, { triggeredBy: "manual_admin", actorUserId: "admin-1", ...EXEC_OPTS });
  } finally {
    restore();
  }
  assertEquals(capturedUrl, "https://signed.example/variants/ig.png");
});

Deno.test("REGRESSION: workspace A's post cannot resolve workspace B's Facebook Page - the destination lookup re-checks workspace_id, not just the row id", async () => {
  const post = makePost({ workspace_id: "ws-A", facebook_page_id: "page-owned-by-ws-B" });
  const store = makeFakeStore({
    posts: [post],
    assets: { "asset-1": { storage_path: "orig/a.jpg" } },
    // The page row exists, but belongs to a DIFFERENT workspace than the post -
    // resolveDestination must refuse this, not trust the foreign key blindly.
    facebookPages: { "page-owned-by-ws-B": { page_id: "999", integration_id: "integration-ws-B", workspace_id: "ws-B" } },
    integrations: { "integration-ws-B": { id: "integration-ws-B", workspace_id: "ws-B", status: "connected" } },
    tokensByIntegrationId: { "integration-ws-B": "ws-B-token" },
  });
  const restore = mockFetchOnce(() => jsonResponse({ post_id: "should-never-be-called" }));
  let result;
  try {
    result = await executePublish(store.sb, post, { triggeredBy: "manual_admin", actorUserId: "admin-1", ...EXEC_OPTS });
  } finally {
    restore();
  }
  assertEquals(result.outcome.kind, "permanent_failure");
  if (result.outcome.kind !== "success") assertEquals(result.outcome.code, "missing_destination");
});

// --- claimScheduledPost: the idempotency/concurrency primitive ------------

Deno.test("REGRESSION: claiming post A never touches post B's row", async () => {
  const postA = makePost({ id: "post-A" });
  const postB = makePost({ id: "post-B" });
  const store = makeFakeStore({ posts: [postA, postB] });

  const claimed = await claimScheduledPost(store.sb, "post-A", "manual:admin-1", new Date().toISOString());
  assert(claimed, "post A should be claimed");
  assertEquals(claimed?.id, "post-A");
  assertEquals(store.scheduledPosts.get("post-A")?.status, "publishing");
  assertEquals(store.scheduledPosts.get("post-B")?.status, "scheduled", "post B must be untouched by claiming post A");
});

Deno.test("REGRESSION: a second concurrent claim on the same post fails - it is never published twice", async () => {
  const post = makePost();
  const store = makeFakeStore({ posts: [post] });
  const nowIso = new Date().toISOString();

  const first = await claimScheduledPost(store.sb, "post-A", "claim-1", nowIso);
  const second = await claimScheduledPost(store.sb, "post-A", "claim-2", nowIso);

  assert(first, "the first claim should win");
  assertEquals(second, null, "the second concurrent claim must lose - never both claim the same post");
});

Deno.test("an already-published post cannot be claimed (and therefore cannot publish twice)", async () => {
  const post = makePost({ status: "published" });
  const store = makeFakeStore({ posts: [post] });
  const claimed = await claimScheduledPost(store.sb, "post-A", "claim-1", new Date().toISOString());
  assertEquals(claimed, null);
});

Deno.test("a post already in 'publishing' (claimed by someone else) cannot be claimed again", async () => {
  const post = makePost({ status: "publishing" });
  const store = makeFakeStore({ posts: [post] });
  const claimed = await claimScheduledPost(store.sb, "post-A", "claim-1", new Date().toISOString());
  assertEquals(claimed, null);
});
