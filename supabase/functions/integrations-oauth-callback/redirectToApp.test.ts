// Unit-level regression test (no network, no Meta calls) for the
// production blank-page bug: the callback used to redirect to
// "/integrations", a path with no matching route in src/App.tsx (the real
// route is "/app/integrations"), and there was no catch-all route to
// rescue an unmatched path - so the browser landed on a blank page after
// a successful (or failed) Meta OAuth consent.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { redirectToApp } from "./redirectToApp.ts";

Deno.test("redirectToApp points at the authenticated app's real Integrations route, not the removed bare path", () => {
  const res = redirectToApp("https://app.stabiflow.com", { integration_connected: "meta" });
  const location = new URL(res.headers.get("Location")!);
  assertEquals(location.origin, "https://app.stabiflow.com");
  assertEquals(location.pathname, "/app/integrations");
  assertEquals(location.searchParams.get("integration_connected"), "meta");
});

Deno.test("redirectToApp carries integration_error for failed callbacks to the same real route", () => {
  const res = redirectToApp("https://app.stabiflow.com", { integration_error: "access_denied" });
  const location = new URL(res.headers.get("Location")!);
  assertEquals(location.pathname, "/app/integrations");
  assertEquals(location.searchParams.get("integration_error"), "access_denied");
  assertEquals(location.searchParams.get("integration_connected"), null);
});

Deno.test("redirectToApp always returns a 302 so the browser navigates instead of rendering the raw function response", () => {
  const res = redirectToApp("https://app.stabiflow.com", { integration_connected: "whatsapp" });
  assertEquals(res.status, 302);
});
