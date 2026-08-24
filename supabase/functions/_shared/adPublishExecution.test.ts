import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveNextStep, type ProviderState } from "./adPublishExecution.ts";

const at = () => new Date().toISOString();

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
