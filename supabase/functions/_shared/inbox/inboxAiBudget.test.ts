import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideInboxAiBudget,
  INBOX_AI_CAP_HARD_FALLBACK,
  INBOX_AI_CAP_MAX,
  inboxAiPauseReason,
  isValidInboxAiCap,
  resolveInboxAiCap,
  utcDayStartIso,
  utcMonthStartIso,
} from "./inboxAiBudget.ts";

Deno.test("utcMonthStartIso / utcDayStartIso: UTC calendar boundaries, mid-month + late-day", () => {
  const d = new Date("2026-03-17T22:45:10.000Z");
  assertEquals(utcMonthStartIso(d), "2026-03-01T00:00:00.000Z");
  assertEquals(utcDayStartIso(d), "2026-03-17T00:00:00.000Z");
  // Jan 1 just after midnight UTC still belongs to January
  assertEquals(utcMonthStartIso(new Date("2026-01-01T00:00:01.000Z")), "2026-01-01T00:00:00.000Z");
});

Deno.test("resolveInboxAiCap: explicit override wins, then env default, then hard fallback", () => {
  assertEquals(resolveInboxAiCap(250000, "1000000"), 250000);
  assertEquals(resolveInboxAiCap("250000", "1000000"), 250000); // jsonb string form
  assertEquals(resolveInboxAiCap(null, "1000000"), 1000000);
  assertEquals(resolveInboxAiCap(undefined, undefined), INBOX_AI_CAP_HARD_FALLBACK);
});

Deno.test("resolveInboxAiCap: never treats a bad value as unlimited - it falls through", () => {
  assertEquals(resolveInboxAiCap(0, "1000000"), 1000000);
  assertEquals(resolveInboxAiCap(-5, "1000000"), 1000000);
  assertEquals(resolveInboxAiCap(1.5, "1000000"), 1000000);
  assertEquals(resolveInboxAiCap(INBOX_AI_CAP_MAX + 1, "1000000"), 1000000);
  assertEquals(resolveInboxAiCap("garbage", "also-garbage"), INBOX_AI_CAP_HARD_FALLBACK);
});

Deno.test("isValidInboxAiCap: null/undefined ok (= default); positive integer in bounds ok; else no", () => {
  assertEquals(isValidInboxAiCap(null), true);
  assertEquals(isValidInboxAiCap(undefined), true);
  assertEquals(isValidInboxAiCap(1), true);
  assertEquals(isValidInboxAiCap(1_000_000), true);
  assertEquals(isValidInboxAiCap(INBOX_AI_CAP_MAX), true);
  assertEquals(isValidInboxAiCap(0), false);
  assertEquals(isValidInboxAiCap(-1), false);
  assertEquals(isValidInboxAiCap(2.5), false);
  assertEquals(isValidInboxAiCap(INBOX_AI_CAP_MAX + 1), false);
  assertEquals(isValidInboxAiCap("garbage"), false);
});

Deno.test("decideInboxAiBudget: under the cap -> allowed", () => {
  assertEquals(decideInboxAiBudget({ workspaceUsed: 999_999, workspaceCap: 1_000_000 }), { allowed: true });
});

Deno.test("decideInboxAiBudget: at or over the cap -> workspace_cap block (no OpenAI call)", () => {
  assertEquals(decideInboxAiBudget({ workspaceUsed: 1_000_000, workspaceCap: 1_000_000 }), { allowed: false, scope: "workspace_cap" });
  assertEquals(decideInboxAiBudget({ workspaceUsed: 1_500_000, workspaceCap: 1_000_000 }), { allowed: false, scope: "workspace_cap" });
});

Deno.test("decideInboxAiBudget: platform daily ceiling blocks even when the workspace is under its own cap", () => {
  assertEquals(
    decideInboxAiBudget({ workspaceUsed: 10, workspaceCap: 1_000_000, platformUsed: 5_000_000, platformCeiling: 5_000_000 }),
    { allowed: false, scope: "platform_ceiling" },
  );
});

Deno.test("decideInboxAiBudget: an unconfigured platform ceiling (null) is ignored", () => {
  assertEquals(
    decideInboxAiBudget({ workspaceUsed: 10, workspaceCap: 1_000_000, platformUsed: null, platformCeiling: null }),
    { allowed: true },
  );
});

Deno.test("inboxAiPauseReason: honest, distinct, never a token number or platform hint", () => {
  const ws = inboxAiPauseReason("workspace_cap");
  const plat = inboxAiPauseReason("platform_ceiling");
  assertEquals(ws.includes("monthly Inbox AI usage limit"), true);
  assertEquals(plat.includes("temporarily unavailable"), true);
  assertEquals(ws === plat, false);
  assertEquals(/\d/.test(ws), false);
  assertEquals(/\d/.test(plat), false);
});
