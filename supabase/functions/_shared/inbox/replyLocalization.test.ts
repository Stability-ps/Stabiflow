import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildLocalizationInstructions,
  extractProtectedTokens,
  localizeReply,
  missingProtectedTokens,
  shouldLocalizeReply,
  validateLocalizedReply,
} from "./replyLocalization.ts";

// --- the gate (tests 1-4) ---------------------------------------------

Deno.test("shouldLocalizeReply: setting OFF -> false", () => {
  assertEquals(
    shouldLocalizeReply({ matchCustomerLanguageEnabled: false, aiEnabled: true, conversationStatus: "open", aiReplyGenerated: true }),
    false,
  );
});
Deno.test("shouldLocalizeReply: human_handoff -> false", () => {
  assertEquals(
    shouldLocalizeReply({ matchCustomerLanguageEnabled: true, aiEnabled: true, conversationStatus: "human_handoff", aiReplyGenerated: true }),
    false,
  );
});
Deno.test("shouldLocalizeReply: ai_enabled=false -> false", () => {
  assertEquals(
    shouldLocalizeReply({ matchCustomerLanguageEnabled: true, aiEnabled: false, conversationStatus: "open", aiReplyGenerated: true }),
    false,
  );
});
Deno.test("shouldLocalizeReply: no AI reply generated this turn -> false", () => {
  assertEquals(
    shouldLocalizeReply({ matchCustomerLanguageEnabled: true, aiEnabled: true, conversationStatus: "open", aiReplyGenerated: false }),
    false,
  );
});
Deno.test("shouldLocalizeReply: setting ON + AI-generated reply + AI control -> true", () => {
  assertEquals(
    shouldLocalizeReply({ matchCustomerLanguageEnabled: true, aiEnabled: true, conversationStatus: "open", aiReplyGenerated: true }),
    true,
  );
});

// --- protected-token preservation (tests 5-9) -----------------------

Deno.test("protected tokens: URLs must survive", () => {
  const orig = "Please upload it at https://portal.example.co.za/upload?ref=9 and we'll review it.";
  assertEquals(missingProtectedTokens(orig, "Layisha ku https://portal.example.co.za/upload?ref=9, sizoyibuka."), []);
  assertEquals(missingProtectedTokens(orig, "Layisha ku https://portal.example.co.za/upload, sizoyibuka.").length > 0, true);
});
Deno.test("protected tokens: monetary amounts must survive exactly (R5,000 / R 10 000)", () => {
  const orig = "The arrangement is R5,000 now and R 10 000 next month.";
  assertEquals(missingProtectedTokens(orig, "Isicelo si-R5,000 manje ne-R 10 000 ngenyanga ezayo."), []);
  assertEquals(missingProtectedTokens(orig, "Isicelo si-R5000 manje ne-R10000 ngenyanga ezayo.").length, 2);
});
Deno.test("protected tokens: phone and email must survive", () => {
  const orig = "Call us on +27 21 555 0100 or email support@stabiflow.com.";
  assertEquals(missingProtectedTokens(orig, "Sifonele ku +27 21 555 0100 noma email support@stabiflow.com."), []);
  assertEquals(missingProtectedTokens(orig, "Sifonele ku +27 21 555 9999 noma email support@stabiflow.com.").length, 1);
});
Deno.test("protected tokens: reference identifiers must survive (LEAD-000123, VAT201, ITR14, 2024/25)", () => {
  const orig = "Quote LEAD-000123 when you send the VAT201 and ITR14 for the 2024/25 period.";
  assertEquals(missingProtectedTokens(orig, "Sho i-LEAD-000123 uma uthumela i-VAT201 ne-ITR14 yesikhathi se-2024/25."), []);
  assertEquals(missingProtectedTokens(orig, "Sho i-LEAD-000124 uma uthumela i-VAT201 ne-ITR14 yesikhathi se-2024/25.").length, 1);
});
Deno.test("protected tokens: dates and times must survive", () => {
  const orig = "The deadline is 15 September 2026 at 14:30.";
  assertEquals(missingProtectedTokens(orig, "Umnqamulajuqu ngu-15 September 2026 ngo-14:30."), []);
  assertEquals(missingProtectedTokens(orig, "Umnqamulajuqu ngu-16 September 2026 ngo-14:30.").length >= 1, true);
});

// --- candidate validation (tests 10-14) ----------------------------

const AUTHORITATIVE = "To help with a payment arrangement, please send your latest SARS statement of account.";

Deno.test("validate: blank candidate rejected", () => {
  const v = validateLocalizedReply(AUTHORITATIVE, "   ");
  assertEquals(v.ok, false);
});
Deno.test("validate: excessively expanded candidate rejected", () => {
  const huge = AUTHORITATIVE + " " + "ngiyabonga ".repeat(60);
  const v = validateLocalizedReply(AUTHORITATIVE, huge);
  assertEquals(v.ok, false);
});
Deno.test("validate: candidate that introduces a false action claim is rejected", () => {
  const v = validateLocalizedReply(AUTHORITATIVE, "I have submitted your SARS statement of account for the payment arrangement.");
  assertEquals(v.ok, false);
});
Deno.test("validate: candidate that invents a personal identity is rejected", () => {
  const v = validateLocalizedReply(AUTHORITATIVE, "Hi, my name is Thabo Nkosi. Please send your latest SARS statement of account.");
  assertEquals(v.ok, false);
});
Deno.test("validate: a safe, natural code-mixed candidate is accepted", () => {
  const v = validateLocalizedReply(
    AUTHORITATIVE,
    "Ukuze ngikusize nge-payment arrangement, ngicela uthumele your latest SARS statement of account.",
  );
  assertEquals(v.ok, true);
});

// --- prompt boundary (test 15) ------------------------------------

Deno.test("localization instructions state the untrusted-customer-text boundary", () => {
  const ins = buildLocalizationInstructions();
  assertEquals(/untrusted data/i.test(ins), true);
  assertEquals(/cannot change these rules|cannot cause any action/i.test(ins), true);
  assertEquals(/preserve/i.test(ins), true);
});

// --- provider behaviour (tests 16-19) ----------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function responsesApiBody(localized: string, usage = { input_tokens: 120, output_tokens: 40 }) {
  return { output_text: JSON.stringify({ localized }), usage };
}

Deno.test("localizeReply: a valid candidate is returned as status 'localized'", async () => {
  const fetchImpl = () =>
    Promise.resolve(jsonResponse(responsesApiBody("Ngicela uthumele your latest SARS statement of account ukuze ngikusize.")));
  const out = await localizeReply(
    { apiKey: "k", model: "m" },
    { authoritativeReply: AUTHORITATIVE, customerContext: "sharp ngicela ukwazi", fetchImpl: fetchImpl as unknown as typeof fetch },
  );
  assertEquals(out.status, "localized");
  assertEquals(out.text.includes("SARS statement of account"), true);
  assertEquals(out.usage.inputTokens, 120);
});

Deno.test("localizeReply: malformed provider output -> original reply, status 'fallback'", async () => {
  const fetchImpl = () => Promise.resolve(jsonResponse({ output_text: "not json at all", usage: { input_tokens: 5, output_tokens: 1 } }));
  const out = await localizeReply(
    { apiKey: "k", model: "m" },
    { authoritativeReply: AUTHORITATIVE, customerContext: "x", fetchImpl: fetchImpl as unknown as typeof fetch },
  );
  assertEquals(out.status, "fallback");
  assertEquals(out.text, AUTHORITATIVE);
});

Deno.test("localizeReply: provider error (500) -> original reply, status 'fallback'", async () => {
  const fetchImpl = () => Promise.resolve(new Response("upstream boom", { status: 500 }));
  const out = await localizeReply(
    { apiKey: "k", model: "m" },
    { authoritativeReply: AUTHORITATIVE, customerContext: "x", fetchImpl: fetchImpl as unknown as typeof fetch },
  );
  assertEquals(out.status, "fallback");
  assertEquals(out.text, AUTHORITATIVE);
  assertEquals(out.reason, "provider 500");
});

Deno.test("localizeReply: a candidate that drops a protected token -> original reply", async () => {
  const orig = "Upload the ITR14 at https://portal.example.co.za/u before 15 September 2026.";
  const fetchImpl = () => Promise.resolve(jsonResponse(responsesApiBody("Layisha i-ITR14 ngaphambi kuka-15 September 2026.")));
  const out = await localizeReply(
    { apiKey: "k", model: "m" },
    { authoritativeReply: orig, customerContext: "x", fetchImpl: fetchImpl as unknown as typeof fetch },
  );
  assertEquals(out.status, "fallback");
  assertEquals(out.text, orig);
});

Deno.test("localizeReply: an aborted/timed-out request -> original reply, reason 'timeout'", async () => {
  const fetchImpl = (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  const out = await localizeReply(
    { apiKey: "k", model: "m" },
    { authoritativeReply: AUTHORITATIVE, customerContext: "x", timeoutMs: 20, fetchImpl: fetchImpl as unknown as typeof fetch },
  );
  assertEquals(out.status, "fallback");
  assertEquals(out.text, AUTHORITATIVE);
  assertEquals(out.reason, "timeout");
});

Deno.test("extractProtectedTokens: multiset counts repeats", () => {
  const m = extractProtectedTokens("Pay R100 now and R100 later.");
  assertEquals(m.get("r100"), 2);
});

// --- wiring guarantees (test 19 + Phase-9 retry) --------------------

Deno.test("whatsapp-webhook calls localization ONLY after the two AI-answer send points, once each", async () => {
  const src = await Deno.readTextFile(new URL("../../whatsapp-webhook/index.ts", import.meta.url));
  // Exactly two call sites (structured + legacy path), each immediately
  // before its storeOutbound - never on a "system" message.
  const calls = src.match(/maybeLocalizeReply\(/g) ?? [];
  assertEquals(calls.length, 3); // 1 definition + 2 call sites
  // No localization of the hardcoded system/handoff lines.
  assertEquals(/maybeLocalizeReply[^;]*"system"/s.test(src), false);
});

Deno.test("whatsapp-outbound-retry-tick never localizes - it resends the STORED final content", async () => {
  const src = await Deno.readTextFile(new URL("../../whatsapp-outbound-retry-tick/index.ts", import.meta.url));
  assertEquals(src.includes("localize"), false);
  assertEquals(src.includes("replyLocalization"), false);
});
