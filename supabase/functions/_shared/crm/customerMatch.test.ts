import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyCustomerMatch, type MatchConversation, type MatchCustomer } from "./customerMatch.ts";

const conv = (o: Partial<MatchConversation> = {}): MatchConversation => ({
  phoneNormalized: null, email: null, companyName: null, contactName: null, leadId: null, ...o,
});
const cust = (o: Partial<MatchCustomer> & Pick<MatchCustomer, "id">): MatchCustomer => ({
  phoneNormalized: null, email: null, companyName: null, name: null, leadId: null, ...o,
});

Deno.test("exact phone -> one exact candidate, auto-link", () => {
  const r = classifyCustomerMatch(conv({ phoneNormalized: "+27821234567" }), [
    cust({ id: "c1", phoneNormalized: "+27821234567", name: "Ada" }),
    cust({ id: "c2", phoneNormalized: "+27999999999", name: "Other" }),
  ]);
  assertEquals(r.tier, "exact");
  assertEquals(r.candidates.map((c) => c.customerId), ["c1"]);
  assertEquals(r.candidates[0].reason.startsWith("Exact match - phone"), true);
  assertEquals(r.autoLinkCustomerId, "c1");
});

Deno.test("ambiguous exact phone (two customers, same phone) -> no auto-link", () => {
  const r = classifyCustomerMatch(conv({ phoneNormalized: "+27821234567" }), [
    cust({ id: "c1", phoneNormalized: "+27821234567" }),
    cust({ id: "c2", phoneNormalized: "+27821234567" }),
  ]);
  assertEquals(r.tier, "exact");
  assertEquals(r.candidates.length, 2);
  assertEquals(r.autoLinkCustomerId, null);
});

Deno.test("no match -> NEW, no candidates, no auto-link", () => {
  const r = classifyCustomerMatch(conv({ phoneNormalized: "+27820000000", email: "x@y.com" }), [
    cust({ id: "c1", phoneNormalized: "+27821111111", email: "a@b.com" }),
  ]);
  assertEquals(r.tier, "new");
  assertEquals(r.candidates, []);
  assertEquals(r.autoLinkCustomerId, null);
});

Deno.test("exact email -> exact candidate but NOT auto-linked (phone is the only auto-link signal)", () => {
  const r = classifyCustomerMatch(conv({ email: "ADA@Example.com" }), [
    cust({ id: "c1", email: "ada@example.com", name: "Ada" }),
  ]);
  assertEquals(r.tier, "exact");
  assertEquals(r.candidates[0].customerId, "c1");
  assertEquals(r.autoLinkCustomerId, null);
});

Deno.test("conversation's own lead already a customer -> exact", () => {
  const r = classifyCustomerMatch(conv({ leadId: "lead-9" }), [
    cust({ id: "c1", leadId: "lead-9" }),
  ]);
  assertEquals(r.tier, "exact");
  assertEquals(r.candidates[0].reason.includes("lead is already this customer"), true);
  assertEquals(r.autoLinkCustomerId, null);
});

Deno.test("company + name only -> POSSIBLE, never auto-linked", () => {
  const r = classifyCustomerMatch(conv({ companyName: "Acme Ltd", contactName: "Grace Hopper" }), [
    cust({ id: "c1", companyName: "acme ltd", name: "grace hopper" }),
    cust({ id: "c2", companyName: "Acme Ltd", name: "Someone Else" }),
  ]);
  assertEquals(r.tier, "possible");
  assertEquals(r.candidates.map((c) => c.customerId), ["c1"]);
  assertEquals(r.candidates[0].tier, "possible");
  assertEquals(r.autoLinkCustomerId, null);
});

Deno.test("exact + possible together -> exact sorts first, tier is exact", () => {
  const r = classifyCustomerMatch(
    conv({ phoneNormalized: "+27821234567", companyName: "Acme", contactName: "Ada" }),
    [
      cust({ id: "poss", companyName: "acme", name: "ada" }),
      cust({ id: "exact", phoneNormalized: "+27821234567" }),
    ],
  );
  assertEquals(r.tier, "exact");
  assertEquals(r.candidates[0].customerId, "exact");
  assertEquals(r.candidates[1].customerId, "poss");
  assertEquals(r.autoLinkCustomerId, "exact");
});
