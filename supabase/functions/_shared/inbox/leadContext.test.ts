import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { asIntakeRecord, resolveSummaryAndIntake, safeTypedLeadFields } from "./leadContext.ts";

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
});
