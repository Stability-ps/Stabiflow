import { assertEquals, assertInstanceOf, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchWithTimeout, ProviderTimeoutError } from "./fetchWithTimeout.ts";
import { classifyIntegrationNetworkError } from "./metaGraphError.ts";

Deno.test("fetchWithTimeout: passes a successful response straight through (and clears its timer - Deno's op sanitizer fails a leaked setTimeout)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_i: unknown, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ ok: 1 }), { status: 200 }))) as typeof fetch;
  try {
    const res = await fetchWithTimeout("https://graph.example/x", { method: "GET" }, 5_000);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: 1 });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("fetchWithTimeout: aborts a hung request past the timeout and throws ProviderTimeoutError", async () => {
  const original = globalThis.fetch;
  // A fetch that only settles when its signal aborts.
  globalThis.fetch = ((_i: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const s = init?.signal;
      if (s) s.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  try {
    const err = await assertRejects(() => fetchWithTimeout("https://graph.example/hang", { method: "POST" }, 20));
    assertInstanceOf(err, ProviderTimeoutError);
    // The message is fixed and secret-free - never the URL/token.
    assertEquals(err.message.includes("graph.example"), false);
    assertEquals(err.message.includes("access_token"), false);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("fetchWithTimeout: a timeout classifies as a temporary/network failure via the existing taxonomy", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_i: unknown, init?: RequestInit) =>
    new Promise<Response>((_r, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  try {
    const classified = await assertRejects(async () => {
      try {
        await fetchWithTimeout("https://graph.example/hang", {}, 20);
      } catch (e) {
        classifyIntegrationNetworkError(e); // throws TemporaryIntegrationError
      }
    });
    // classifyIntegrationNetworkError -> TemporaryIntegrationError(category "temporary_unavailable")
    assertEquals((classified as { category?: string }).category, "temporary_unavailable");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("fetchWithTimeout: a caller-supplied signal that is already aborted cancels immediately (not reported as our timeout)", async () => {
  const original = globalThis.fetch;
  // Model real fetch: an already-aborted signal rejects synchronously.
  globalThis.fetch = ((_i: unknown, init?: RequestInit) =>
    new Promise<Response>((_r, reject) => {
      const s = init?.signal;
      if (s?.aborted) return reject(new DOMException("aborted", "AbortError"));
      s?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  try {
    const ac = new AbortController();
    ac.abort();
    const err = await assertRejects(() => fetchWithTimeout("https://graph.example/x", { signal: ac.signal }, 5_000));
    // external abort -> the original AbortError, NOT ProviderTimeoutError
    assertEquals(err instanceof ProviderTimeoutError, false);
  } finally {
    globalThis.fetch = original;
  }
});
