import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeMessagingWindowState, getLastCustomerMessageAt, MESSAGING_WINDOW_HOURS, resolveMessagingWindow } from "./messagingWindow.ts";

const NOW = "2026-08-28T12:00:00.000Z";

Deno.test("exactly inside 24 hours: a message from 23h59m ago is open", () => {
  const last = new Date(new Date(NOW).getTime() - (23 * 60 + 59) * 60 * 1000).toISOString();
  assertEquals(computeMessagingWindowState(last, NOW), "open");
});

Deno.test("just outside 24 hours: a message from 24h01m ago is closed", () => {
  const last = new Date(new Date(NOW).getTime() - (24 * 60 + 1) * 60 * 1000).toISOString();
  assertEquals(computeMessagingWindowState(last, NOW), "closed");
});

Deno.test("boundary condition: exactly 24h00m00s ago is still open (inclusive, now <= last + 24h)", () => {
  const last = new Date(new Date(NOW).getTime() - MESSAGING_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  assertEquals(computeMessagingWindowState(last, NOW), "open");
});

Deno.test("boundary condition: 1 second past exactly 24 hours is closed", () => {
  const last = new Date(new Date(NOW).getTime() - MESSAGING_WINDOW_HOURS * 60 * 60 * 1000 - 1000).toISOString();
  assertEquals(computeMessagingWindowState(last, NOW), "closed");
});

Deno.test("a message from moments ago is open", () => {
  const last = new Date(new Date(NOW).getTime() - 60 * 1000).toISOString();
  assertEquals(computeMessagingWindowState(last, NOW), "open");
});

Deno.test("missing inbound timestamp (null) is 'unknown', never 'open' - fail closed", () => {
  assertEquals(computeMessagingWindowState(null, NOW), "unknown");
});

Deno.test("an unparseable timestamp is 'unknown', never 'open' - fail closed", () => {
  assertEquals(computeMessagingWindowState("not-a-real-date", NOW), "unknown");
});

Deno.test("getLastCustomerMessageAt selects only direction=inbound AND sender_type=customer, ordered newest-first", async () => {
  const calls: { method: string; args: unknown[] }[] = [];
  const fakeSb = {
    from(table: string) {
      calls.push({ method: "from", args: [table] });
      const builder = {
        select(cols: string) {
          calls.push({ method: "select", args: [cols] });
          return builder;
        },
        eq(col: string, val: unknown) {
          calls.push({ method: "eq", args: [col, val] });
          return builder;
        },
        order(col: string, opts: unknown) {
          calls.push({ method: "order", args: [col, opts] });
          return builder;
        },
        limit(n: number) {
          calls.push({ method: "limit", args: [n] });
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: { created_at: "2026-08-28T10:00:00.000Z" } });
        },
      };
      return builder;
    },
  };
  const result = await getLastCustomerMessageAt(fakeSb, "conv-1");
  assertEquals(result, "2026-08-28T10:00:00.000Z");
  assertEquals(calls.some((c) => c.method === "eq" && c.args[0] === "direction" && c.args[1] === "inbound"), true);
  assertEquals(calls.some((c) => c.method === "eq" && c.args[0] === "sender_type" && c.args[1] === "customer"), true);
  assertEquals(calls.some((c) => c.method === "order" && (c.args[1] as { ascending?: boolean })?.ascending === false), true);
});

function fakeSbReturning(data: { created_at: string } | null) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data }),
  };
  return { from: () => builder };
}

Deno.test("getLastCustomerMessageAt returns null when no inbound customer message has ever arrived", async () => {
  assertEquals(await getLastCustomerMessageAt(fakeSbReturning(null), "conv-1"), null);
});

Deno.test("resolveMessagingWindow combines the resolver and the pure calculation consistently", async () => {
  const fakeSb = fakeSbReturning({ created_at: new Date(new Date(NOW).getTime() - 60 * 1000).toISOString() });
  const result = await resolveMessagingWindow(fakeSb, "conv-1", NOW);
  assertEquals(result.state, "open");
  assertEquals(typeof result.lastCustomerMessageAt, "string");
});
