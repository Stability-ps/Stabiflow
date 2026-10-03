import { describe, expect, it, vi } from "vitest";
import { generateCreativeCopy } from "@/lib/creativeStudio";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

// Shape of a supabase-js FunctionsHttpError: `data` is null, the JSON body
// is reachable via `error.context` (a Response). Mirrors adCampaigns.test.ts.
function httpError(body: unknown) {
  return {
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code", // raw supabase string - must never surface
      context: { json: () => Promise.resolve(body), clone() { return this; } },
    },
  };
}

// Production bug: every creative-studio-* edge function error surfaced
// only the generic "Edge Function returned a non-2xx status code" toast,
// because invoke() never read the structured error body from
// error.context (supabase-js leaves `data` null on a non-2xx response).
describe("creativeStudio invoke() - error.context unwrapping", () => {
  it("surfaces the edge function's own error message instead of the generic supabase string", async () => {
    invokeMock.mockResolvedValue(httpError({ error: "That would exceed the 30-creative limit for one batch. Pick fewer concepts, layouts or sizes." }));
    const err = await generateCreativeCopy({ workspaceId: "ws-1", businessContext: "A bakery", variantCount: 3 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("That would exceed the 30-creative limit for one batch. Pick fewer concepts, layouts or sizes.");
    expect(err.message).not.toMatch(/non-2xx|Edge Function/);
  });

  it("prefers a `message` field over `error` when both are present", async () => {
    invokeMock.mockResolvedValue(httpError({ error: "workspace_suspended", message: "This workspace is suspended. Contact support to reactivate it." }));
    const err = await generateCreativeCopy({ workspaceId: "ws-1", businessContext: "A bakery", variantCount: 3 }).catch((e) => e);
    expect(err.message).toBe("This workspace is suspended. Contact support to reactivate it.");
  });

  it("falls back to the generic supabase message only when no structured body is readable at all", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: {} } });
    const err = await generateCreativeCopy({ workspaceId: "ws-1", businessContext: "A bakery", variantCount: 3 }).catch((e) => e);
    expect(err.message).toBe("Edge Function returned a non-2xx status code");
  });

  it("a successful call still returns data normally (unchanged happy path)", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, variants: [] }, error: null });
    const result = await generateCreativeCopy({ workspaceId: "ws-1", businessContext: "A bakery", variantCount: 3 });
    expect(result).toEqual({ ok: true, variants: [] });
  });
});
