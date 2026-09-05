import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cleanReply, containsFalseActionClaim, containsInventedPersonalIdentity, isSimpleGreeting, requestsHumanHandoff } from "./replyGuardrails.ts";

Deno.test("cleanReply strips filler acknowledgements", () => {
  const out = cleanReply("Thanks, I've noted that. How can I help further?");
  assertEquals(out.includes("noted"), false);
});

Deno.test("cleanReply caps overly long replies at a sentence boundary", () => {
  const long = "This is a sentence. ".repeat(40).trim();
  const out = cleanReply(long);
  assertEquals(out.length <= 360, true);
  assertEquals(/[.!?]$/.test(out), true);
});

Deno.test("cleanReply collapses excess blank lines and dashes", () => {
  const out = cleanReply("Line one — with a dash.\n\n\n\nLine two.");
  assertEquals(out.includes("—"), false);
  assertEquals(out.includes("\n\n\n"), false);
});

Deno.test("requestsHumanHandoff detects an explicit ask for a person", () => {
  assertEquals(requestsHumanHandoff("Can I speak to a human please"), true);
  assertEquals(requestsHumanHandoff("I want to talk to someone"), true);
  assertEquals(requestsHumanHandoff("please connect me with an agent"), true);
});

Deno.test("requestsHumanHandoff does not fire on unrelated text", () => {
  assertEquals(requestsHumanHandoff("What are your opening hours?"), false);
  assertEquals(requestsHumanHandoff("Thanks for the help"), false);
});

Deno.test("containsFalseActionClaim flags the AI claiming to have taken an action", () => {
  assertEquals(containsFalseActionClaim("I'll send that over right away"), true);
  assertEquals(containsFalseActionClaim("Your request has been submitted"), true);
});

Deno.test("containsFalseActionClaim does not flag ordinary informative text", () => {
  assertEquals(containsFalseActionClaim("Our office hours are 9 to 5"), false);
});

Deno.test("containsInventedPersonalIdentity flags the AI inventing a human name", () => {
  assertEquals(containsInventedPersonalIdentity("My name is Sarah Jones"), true);
  assertEquals(containsInventedPersonalIdentity("I'm John Smith, happy to help"), true);
});

Deno.test("containsInventedPersonalIdentity does not flag normal replies", () => {
  assertEquals(containsInventedPersonalIdentity("I'm happy to help with that"), false);
});

Deno.test("isSimpleGreeting matches only a bare greeting", () => {
  assertEquals(isSimpleGreeting("Hi"), true);
  assertEquals(isSimpleGreeting("hello!"), true);
  assertEquals(isSimpleGreeting("Hi, I have a question about pricing"), false);
});
