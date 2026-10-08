import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertWorkspaceActive, getWorkspaceStatus, isBlockedStatus, workspaceSuspendedBody } from "./workspaceStatus.ts";

function fakeClient(row: { status?: string } | null, error = false) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  if (error) return { data: null, error: new Error("boom") };
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

Deno.test("trial and active are not blocked", () => {
  assertEquals(isBlockedStatus("trial"), false);
  assertEquals(isBlockedStatus("active"), false);
});

Deno.test("suspended and cancelled are blocked", () => {
  assertEquals(isBlockedStatus("suspended"), true);
  assertEquals(isBlockedStatus("cancelled"), true);
});

Deno.test("unknown status is blocked (fail closed)", () => {
  assertEquals(isBlockedStatus("unknown"), true);
});

Deno.test("getWorkspaceStatus returns the stored status for a valid row", async () => {
  const sb = fakeClient({ status: "active" });
  assertEquals(await getWorkspaceStatus(sb, "ws-1"), "active");
});

Deno.test("getWorkspaceStatus returns 'unknown' when no workspace_billing row exists (fail closed, not fail open)", async () => {
  const sb = fakeClient(null);
  assertEquals(await getWorkspaceStatus(sb, "ws-1"), "unknown");
});

Deno.test("getWorkspaceStatus returns 'unknown' on a query error rather than assuming active", async () => {
  const sb = fakeClient(null, true);
  assertEquals(await getWorkspaceStatus(sb, "ws-1"), "unknown");
});

Deno.test("getWorkspaceStatus returns 'unknown' for an unrecognized stored value (defensive against future enum drift)", async () => {
  const sb = fakeClient({ status: "some_future_status" });
  assertEquals(await getWorkspaceStatus(sb, "ws-1"), "unknown");
});

Deno.test("assertWorkspaceActive allows trial/active", async () => {
  assertEquals(await assertWorkspaceActive(fakeClient({ status: "trial" }), "ws-1"), { allowed: true });
  assertEquals(await assertWorkspaceActive(fakeClient({ status: "active" }), "ws-1"), { allowed: true });
});

Deno.test("assertWorkspaceActive blocks suspended/cancelled with the specific status attached", async () => {
  assertEquals(await assertWorkspaceActive(fakeClient({ status: "suspended" }), "ws-1"), { allowed: false, status: "suspended" });
  assertEquals(await assertWorkspaceActive(fakeClient({ status: "cancelled" }), "ws-1"), { allowed: false, status: "cancelled" });
});

Deno.test("workspaceSuspendedBody returns a specific, legible error code - never a bare/cryptic 403", () => {
  const body = workspaceSuspendedBody("suspended");
  assertEquals(body.error, "workspace_suspended");
  assertEquals(body.status, "suspended");
  assertEquals(typeof body.message, "string");
});

Deno.test("workspaceSuspendedBody distinguishes cancelled from suspended in its message", () => {
  const suspended = workspaceSuspendedBody("suspended");
  const cancelled = workspaceSuspendedBody("cancelled");
  assertEquals(suspended.message === cancelled.message, false);
});
