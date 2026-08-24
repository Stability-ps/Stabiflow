import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildIdempotencyKey } from "./contentIdempotency.ts";

const base = {
  workspaceId: "00000000-0000-0000-0000-000000000001",
  seriesId: "11111111-1111-1111-1111-111111111111" as string | null,
  mediaAssetId: "22222222-2222-2222-2222-222222222222",
  targetPlatform: "facebook",
  destinationId: "33333333-3333-3333-3333-333333333333",
  scheduledAt: new Date("2026-09-01T07:00:00.000Z"),
};

Deno.test("identical input always produces the identical key (deterministic, not random)", async () => {
  const a = await buildIdempotencyKey(base);
  const b = await buildIdempotencyKey({ ...base });
  assertEquals(a, b);
});

Deno.test("a retry of the exact same scheduled post produces the exact same key, so a duplicate insert is rejected by the unique constraint", async () => {
  const originalAttempt = await buildIdempotencyKey(base);
  const retryAttempt = await buildIdempotencyKey({ ...base }); // simulates a second worker/regeneration computing the key independently
  assertEquals(originalAttempt, retryAttempt);
});

Deno.test("changing any single field changes the key", async () => {
  const original = await buildIdempotencyKey(base);
  assertNotEquals(original, await buildIdempotencyKey({ ...base, workspaceId: "99999999-9999-9999-9999-999999999999" }));
  assertNotEquals(original, await buildIdempotencyKey({ ...base, seriesId: "99999999-9999-9999-9999-999999999999" }));
  assertNotEquals(original, await buildIdempotencyKey({ ...base, mediaAssetId: "99999999-9999-9999-9999-999999999999" }));
  assertNotEquals(original, await buildIdempotencyKey({ ...base, targetPlatform: "instagram" }));
  assertNotEquals(original, await buildIdempotencyKey({ ...base, destinationId: "99999999-9999-9999-9999-999999999999" }));
  assertNotEquals(original, await buildIdempotencyKey({ ...base, scheduledAt: new Date("2026-09-04T07:00:00.000Z") }));
});

Deno.test("REGRESSION: two workspaces scheduling the same media asset id at the exact same instant never collide", async () => {
  // Guards the field this module added over Acapolite's single-tenant
  // original: workspaceId is now part of the hash input specifically so
  // this cannot happen once two tenants can have numerically-similar or
  // even identical-looking foreign ids.
  const a = await buildIdempotencyKey({ ...base, workspaceId: "00000000-0000-0000-0000-000000000001" });
  const b = await buildIdempotencyKey({ ...base, workspaceId: "00000000-0000-0000-0000-000000000002" });
  assertNotEquals(a, b);
});

Deno.test("a null seriesId (ad-hoc single post) produces a stable, distinct key from any real series id", async () => {
  const adHoc = await buildIdempotencyKey({ ...base, seriesId: null });
  const withSeries = await buildIdempotencyKey({ ...base, seriesId: "11111111-1111-1111-1111-111111111111" });
  assertNotEquals(adHoc, withSeries);
  assertEquals(adHoc, await buildIdempotencyKey({ ...base, seriesId: null }));
});

Deno.test("key is a 64-character lowercase hex SHA-256 digest, safe for a text/unique column", async () => {
  const key = await buildIdempotencyKey(base);
  assertEquals(key.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(key), true);
});
