import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildAIInputText, buildAIInstructions, mergeExtracted, missingFields } from "./aiReplyEngine.ts";

Deno.test("buildAIInstructions names the business and never claims a fixed human identity", () => {
  const instructions = buildAIInstructions("Acme Co");
  assertEquals(instructions.includes("Acme Co"), true);
  assertEquals(instructions.toLowerCase().includes("invent a name"), true);
});

Deno.test("buildAIInputText includes current details, recent history, and the latest message", () => {
  const text = buildAIInputText(
    [{ direction: "inbound", content: "Hi" }, { direction: "outbound", content: "Hello, how can I help?" }],
    "What are your prices?",
    { customer_name: "Jane" },
  );
  assertEquals(text.includes("Jane"), true);
  assertEquals(text.includes("Customer: Hi"), true);
  assertEquals(text.includes("Assistant: Hello"), true);
  assertEquals(text.includes("What are your prices?"), true);
});

Deno.test("buildAIInputText only keeps the last 16 history entries", () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ direction: "inbound", content: `msg-${i}` }));
  const text = buildAIInputText(history, "latest", {});
  assertEquals(text.includes("msg-0"), false);
  assertEquals(text.includes("msg-19"), true);
});

Deno.test("mergeExtracted only overwrites fields the AI actually filled in", () => {
  const current = { customer_name: "Jane", email: null };
  const merged = mergeExtracted(current, { customer_name: null, email: "jane@example.com", interest_summary: null, urgency: "high" });
  assertEquals(merged, { customer_name: "Jane", email: "jane@example.com", urgency: "high" });
});

Deno.test("missingFields reports which core fields are still unknown", () => {
  assertEquals(missingFields({}), ["customer_name", "email", "interest_summary"]);
  assertEquals(missingFields({ customer_name: "Jane", email: "jane@example.com", interest_summary: "Pricing" }), []);
});

Deno.test("missingFields treats an empty string the same as missing", () => {
  assertEquals(missingFields({ customer_name: "", email: "jane@example.com", interest_summary: "Pricing" }), ["customer_name"]);
});
