import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { asIntakeRecord, deepMergePreferExisting, resolveSummaryAndIntake, safeTypedLeadFields } from "./leadContext.ts";

// --- asIntakeRecord ---------------------------------------------------------

Deno.test("asIntakeRecord: only a plain object passes through", () => {
  assertEquals(asIntakeRecord({ a: 1 }), { a: 1 });
  assertEquals(asIntakeRecord(null), {});
  assertEquals(asIntakeRecord([1, 2]), {});
  assertEquals(asIntakeRecord("x"), {});
});

// --- safeTypedLeadFields --------------------------------------------------

const EMPTY = { contact_name: null, email: null, company_name: null, estimated_value: null };

Deno.test("maps unambiguous values into empty typed columns", () => {
  const { patch, mapped } = safeTypedLeadFields(
    { customer_name: "  Ada Lovelace ", email: "ADA@Example.COM", company_name: "Analytical Engines", interest_summary: "wants a demo" },
    EMPTY,
  );
  assertEquals(patch, { contact_name: "Ada Lovelace", email: "ada@example.com", company_name: "Analytical Engines" });
  assertEquals(mapped.sort(), ["company_name", "contact_name", "email"]);
});

Deno.test("never overwrites a column that already has a value", () => {
  const { patch, mapped } = safeTypedLeadFields(
    { customer_name: "New Name", email: "new@example.com", company_name: "New Co" },
    { contact_name: "Existing", email: "old@example.com", company_name: "Old Co", estimated_value: 100 },
  );
  assertEquals(patch, {});
  assertEquals(mapped, []);
});

Deno.test("a malformed email is NOT mapped", () => {
  const { patch } = safeTypedLeadFields({ email: "not-an-email" }, EMPTY);
  assertEquals(patch.email, undefined);
});

Deno.test("REGRESSION: an ambiguous 'budget' / 'amount' number is NEVER guessed into estimated_value", () => {
  assertEquals(safeTypedLeadFields({ budget: 5000 }, EMPTY).patch.estimated_value, undefined);
  assertEquals(safeTypedLeadFields({ amount: "R 5 000" }, EMPTY).patch.estimated_value, undefined);
  assertEquals(safeTypedLeadFields({ price: 250, value: 999 }, EMPTY).patch.estimated_value, undefined);
});

Deno.test("estimated_value maps ONLY from a key literally named estimated_value that is a finite non-negative number", () => {
  assertEquals(safeTypedLeadFields({ estimated_value: 1250.5 }, EMPTY).patch.estimated_value, 1250.5);
  assertEquals(safeTypedLeadFields({ estimated_value: -1 }, EMPTY).patch.estimated_value, undefined);
  assertEquals(safeTypedLeadFields({ estimated_value: "1250" }, EMPTY).patch.estimated_value, undefined);
  assertEquals(safeTypedLeadFields({ estimated_value: Number.NaN }, EMPTY).patch.estimated_value, undefined);
});

// --- resolveSummaryAndIntake --------------------------------------------

Deno.test("fills an empty lead summary from the conversation AI summary", () => {
  const d = resolveSummaryAndIntake({ summary: null, intake: {} }, "Customer wants a quote for 20 units.", {});
  assertEquals(d.patch.summary, "Customer wants a quote for 20 units.");
  assertEquals(d.summary_copied, true);
  assertEquals(d.summary_skipped, false);
});

Deno.test("REGRESSION: never fabricates a summary when the conversation has none", () => {
  const d = resolveSummaryAndIntake({ summary: null, intake: {} }, null, { interest_summary: "x" });
  assertEquals(d.patch.summary, undefined);
  assertEquals(d.summary_copied, false);
});

Deno.test("REGRESSION: does NOT overwrite a non-empty lead summary by default", () => {
  const d = resolveSummaryAndIntake({ summary: "Curated by sales.", intake: {} }, "AI version.", {});
  assertEquals(d.patch.summary, undefined);
  assertEquals(d.summary_skipped, true);
  assertEquals(d.summary_overwritten, false);
});

Deno.test("overwrites a non-empty lead summary ONLY with the explicit opt-in", () => {
  const d = resolveSummaryAndIntake({ summary: "Old.", intake: {} }, "New.", {}, { overwriteSummary: true });
  assertEquals(d.patch.summary, "New.");
  assertEquals(d.summary_overwritten, true);
});

Deno.test("intake merge: EXISTING lead keys always win; only genuinely new keys are added", () => {
  const d = resolveSummaryAndIntake(
    { summary: "s", intake: { urgency: "high", note: "staff note" } },
    "s",
    { urgency: "low", customer_name: "Grace", email: "g@x.io" },
  );
  assertEquals(d.patch.intake, { customer_name: "Grace", email: "g@x.io", urgency: "high", note: "staff note" });
  assertEquals(d.intake_new_keys.sort(), ["customer_name", "email"]);
});

Deno.test("intake unchanged when the conversation adds no new keys", () => {
  const d = resolveSummaryAndIntake({ summary: "s", intake: { a: 1 } }, "s", { a: 2 });
  assertEquals(d.patch.intake, undefined);
  assertEquals(d.intake_new_keys, []);
  assertEquals(d.intake_changed, false);
});

// --- deepMergePreferExisting (M4) --------------------------------------

Deno.test("deep merge fills a MISSING nested key, existing scalars win", () => {
  assertEquals(
    deepMergePreferExisting(
      { company: { name: "A", size: 10 } },
      { company: { name: "B", industry: "Mining" } },
    ),
    { company: { name: "A", size: 10, industry: "Mining" } },
  );
});

Deno.test("deep merge: scalar conflict at the root - existing wins", () => {
  assertEquals(deepMergePreferExisting({ urgency: "low" }, { urgency: "high", note: "x" }), { urgency: "low", note: "x" });
});

Deno.test("deep merge: arrays are atomic - existing array wins if present, else incoming is copied", () => {
  assertEquals(deepMergePreferExisting({ tags: ["a"] }, { tags: ["b", "c"] }), { tags: ["a"] });
  assertEquals(deepMergePreferExisting({}, { tags: ["b", "c"] }), { tags: ["b", "c"] });
});

Deno.test("deep merge: a key present in existing as an array is NOT merged with an incoming object", () => {
  assertEquals(deepMergePreferExisting({ x: ["keep"] }, { x: { y: 1 } }), { x: ["keep"] });
});

Deno.test("deep merge: prototype-pollution keys are dropped", () => {
  const merged = deepMergePreferExisting({ ok: 1 }, JSON.parse('{"__proto__":{"polluted":true},"constructor":{"bad":1},"ok":2,"safe":3}')) as Record<string, unknown>;
  assertEquals(merged, { ok: 1, safe: 3 });
  assertEquals(({} as Record<string, unknown>).polluted, undefined);
});

Deno.test("deep merge: non-plain objects are not recursed into (existing wins)", () => {
  const existing = { when: "2020" };
  assertEquals(deepMergePreferExisting({ meta: existing }, { meta: { extra: 1 } }), { meta: { when: "2020", extra: 1 } });
  // a non-plain object on the existing side is treated atomically
  const arr: unknown = [1, 2];
  assertEquals(deepMergePreferExisting({ v: arr }, { v: { a: 1 } }), { v: arr });
});

Deno.test("deep merge: recursion is depth-capped and does not throw on deep input", () => {
  let deep: Record<string, unknown> = { leaf: "incoming" };
  for (let i = 0; i < 40; i++) deep = { n: deep };
  const out = deepMergePreferExisting({ n: { n: { n: {} } } }, deep);
  // no throw, and the shallow existing side is preserved
  assertEquals(typeof out, "object");
});

Deno.test("resolveSummaryAndIntake: a nested-only addition still produces patch.intake + intake_changed", () => {
  const d = resolveSummaryAndIntake(
    { summary: "s", intake: { company: { name: "A" } } },
    "s",
    { company: { industry: "Mining" } },
  );
  assertEquals(d.patch.intake, { company: { name: "A", industry: "Mining" } });
  assertEquals(d.intake_changed, true);
  assertEquals(d.intake_new_keys, []); // 'company' already existed at the top level
});
