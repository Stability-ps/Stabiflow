import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeInsightsRow } from "./adMetrics.ts";
import type { InsightsRow } from "./ad-providers/types.ts";

const baseRow: InsightsRow = {
  date_start: "2026-08-20",
  date_stop: "2026-08-20",
  spend: "125.50",
  impressions: "10000",
  reach: "8000",
  clicks: "150",
  ctr: "1.5",
  cpc: "0.837",
  cpm: "12.55",
  frequency: "1.25",
  currency: "ZAR",
  actions: [{ action_type: "link_click", value: "120" }],
  cost_per_action_type: [{ action_type: "link_click", value: "1.0458" }],
};

Deno.test("spend/cpc/cpm decimal strings convert to minor units with rounding, not truncation", () => {
  const normalized = normalizeInsightsRow(baseRow, "OUTCOME_TRAFFIC");
  assertEquals(normalized.spend_minor_units, 12550);
  assertEquals(normalized.cpc_minor_units, 84); // 0.837 -> 83.7 cents -> rounds to 84
  assertEquals(normalized.cpm_minor_units, 1255);
});

Deno.test("impressions/reach/clicks are integers", () => {
  const normalized = normalizeInsightsRow(baseRow, "OUTCOME_TRAFFIC");
  assertEquals(normalized.impressions, 10000);
  assertEquals(normalized.reach, 8000);
  assertEquals(normalized.clicks, 150);
});

Deno.test("results is derived from the objective's mapped action_type (link_click for OUTCOME_TRAFFIC)", () => {
  const normalized = normalizeInsightsRow(baseRow, "OUTCOME_TRAFFIC");
  assertEquals(normalized.results, 120);
  assertEquals(normalized.cost_per_result_minor_units, 105); // 1.0458 -> rounds to 105 cents
});

Deno.test("OUTCOME_ENGAGEMENT reads results from post_engagement, not link_click", () => {
  const row: InsightsRow = { ...baseRow, actions: [{ action_type: "post_engagement", value: "42" }, { action_type: "link_click", value: "5" }] };
  const normalized = normalizeInsightsRow(row, "OUTCOME_ENGAGEMENT");
  assertEquals(normalized.results, 42);
});

Deno.test("OUTCOME_AWARENESS has no mapped result action_type - results stays null rather than guessing", () => {
  const normalized = normalizeInsightsRow(baseRow, "OUTCOME_AWARENESS");
  assertEquals(normalized.results, null);
  assertEquals(normalized.cost_per_result_minor_units, null);
});

Deno.test("a row with no actions array at all does not throw and produces null results", () => {
  const row: InsightsRow = { date_start: "2026-08-20", date_stop: "2026-08-20" };
  const normalized = normalizeInsightsRow(row, "OUTCOME_TRAFFIC");
  assertEquals(normalized.results, null);
  assertEquals(normalized.spend_minor_units, 0);
  assertEquals(normalized.impressions, 0);
});

Deno.test("cost_per_result falls back to spend/results when Meta omits cost_per_action_type for the mapped action", () => {
  const row: InsightsRow = { ...baseRow, cost_per_action_type: undefined };
  const normalized = normalizeInsightsRow(row, "OUTCOME_TRAFFIC");
  // spend 12550 minor units / 120 results = 104.58 -> rounds to 105
  assertEquals(normalized.cost_per_result_minor_units, 105);
});

Deno.test("missing optional numeric fields (ctr/frequency) become null, not zero or NaN", () => {
  const row: InsightsRow = { date_start: "2026-08-20", date_stop: "2026-08-20" };
  const normalized = normalizeInsightsRow(row, "OUTCOME_TRAFFIC");
  assertEquals(normalized.ctr, null);
  assertEquals(normalized.frequency, null);
  assertEquals(normalized.cpc_minor_units, null);
});
