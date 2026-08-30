import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { META_AD_SET_START_TIME_MIN_LEAD_MS, resolveAdSetStartTime, resolveNextStep, type ProviderState } from "./adPublishExecution.ts";

const at = () => new Date().toISOString();

// --- resolveAdSetStartTime: MEDIUM-2 publish-time safety net. Meta rejects
// a past ad-set start_time; a scheduled start that has arrived (or is
// imminent) must publish immediately (null -> start_time omitted).

const NOW = new Date("2026-08-30T12:00:00Z").getTime();

Deno.test("resolveAdSetStartTime: null / undefined -> null (Start now)", () => {
  assertEquals(resolveAdSetStartTime(null, NOW), null);
  assertEquals(resolveAdSetStartTime(undefined, NOW), null);
});

Deno.test("resolveAdSetStartTime: a start comfortably in the future passes through unchanged", () => {
  const future = "2026-08-30T18:00:00Z";
  assertEquals(resolveAdSetStartTime(future, NOW), future);
});

Deno.test("resolveAdSetStartTime: a start already in the past -> null (publish immediately, don't send a timestamp Meta rejects)", () => {
  assertEquals(resolveAdSetStartTime("2026-08-30T11:59:00Z", NOW), null);
  assertEquals(resolveAdSetStartTime("2026-08-30T12:00:00Z", NOW), null); // exactly now
});

Deno.test("resolveAdSetStartTime: a start within the minimum lead window -> null (would be past by the time the request reaches Meta)", () => {
  const justInside = new Date(NOW + META_AD_SET_START_TIME_MIN_LEAD_MS - 1000).toISOString();
  const justOutside = new Date(NOW + META_AD_SET_START_TIME_MIN_LEAD_MS + 1000).toISOString();
  assertEquals(resolveAdSetStartTime(justInside, NOW), null);
  assertEquals(resolveAdSetStartTime(justOutside, NOW), justOutside);
});

Deno.test("resolveAdSetStartTime: a malformed instant -> null rather than throwing", () => {
  assertEquals(resolveAdSetStartTime("not-a-date", NOW), null);
});

Deno.test("empty provider_state resumes at 'campaign' - a fresh publish", () => {
  assertEquals(resolveNextStep({}), "campaign");
});

Deno.test("REGRESSION (partial failure): campaign created but nothing else resumes at 'ad_set', never re-creating the campaign", () => {
  const state: ProviderState = { campaign: { external_id: "123", created_at: at() } };
  assertEquals(resolveNextStep(state), "ad_set");
});

Deno.test("campaign + ad_set created resumes at 'creative'", () => {
  const state: ProviderState = {
    campaign: { external_id: "123", created_at: at() },
    ad_set: { external_id: "456", created_at: at() },
  };
  assertEquals(resolveNextStep(state), "creative");
});

Deno.test("campaign + ad_set + creative created resumes at 'ad' (the documented 'Campaign created, Ad creation failed' scenario)", () => {
  const state: ProviderState = {
    campaign: { external_id: "123", created_at: at() },
    ad_set: { external_id: "456", created_at: at() },
    creative: { external_id: "789", created_at: at() },
  };
  assertEquals(resolveNextStep(state), "ad");
});

Deno.test("everything created resolves to 'done' - a re-publish attempt after full success is a no-op, not a re-run", () => {
  const state: ProviderState = {
    campaign: { external_id: "123", created_at: at() },
    ad_set: { external_id: "456", created_at: at() },
    creative: { external_id: "789", created_at: at() },
    ad: { external_id: "abc", created_at: at() },
  };
  assertEquals(resolveNextStep(state), "done");
});
