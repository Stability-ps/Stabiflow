import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateOauthState, isOauthStateValid } from "./oauthState.ts";

Deno.test("generateOauthState produces a long, unguessable, distinct value each call", () => {
  const a = generateOauthState();
  const b = generateOauthState();
  assertNotEquals(a, b);
  assertEquals(a.length, 64); // 32 bytes hex-encoded
  assertEquals(/^[0-9a-f]+$/.test(a), true);
});

Deno.test("a fresh, unused state is valid", () => {
  const valid = isOauthStateValid({ expires_at: "2026-01-01T00:10:00.000Z", used_at: null }, "2026-01-01T00:00:00.000Z");
  assertEquals(valid, true);
});

Deno.test("REGRESSION: an already-used state can never be revalidated (replay protection)", () => {
  const valid = isOauthStateValid({ expires_at: "2026-01-01T00:10:00.000Z", used_at: "2026-01-01T00:01:00.000Z" }, "2026-01-01T00:02:00.000Z");
  assertEquals(valid, false);
});

Deno.test("an expired, never-used state is invalid", () => {
  const valid = isOauthStateValid({ expires_at: "2026-01-01T00:10:00.000Z", used_at: null }, "2026-01-01T00:10:00.001Z");
  assertEquals(valid, false);
});

Deno.test("a state exactly at its expiry instant is invalid (strict inequality, not <=)", () => {
  const valid = isOauthStateValid({ expires_at: "2026-01-01T00:10:00.000Z", used_at: null }, "2026-01-01T00:10:00.000Z");
  assertEquals(valid, false);
});
