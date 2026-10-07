import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateContentCaption } from "@/lib/contentFunctions";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

// Shape of a supabase-js FunctionsHttpError: `data` is null, the JSON body
// is reachable via `error.context` (a Response).
function httpError(body: unknown) {
  return {
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: { json: () => Promise.resolve(body), clone() { return this; } },
    },
  };
}

const input = { workspace_id: "ws-1", media_asset_id: "asset-1" };

describe("generateContentCaption", () => {
  beforeEach(() => invokeMock.mockReset());

  // Production bug: the client called "content-ai-caption-preview", which
  // was never deployed, so "Write with AI" failed for every workspace.
  it("calls the deployed content-ai-caption function", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, suggestion: { caption: "Fresh bread", hashtags: [], cta: "" } }, error: null });
    await generateContentCaption(input);
    expect(invokeMock).toHaveBeenCalledWith("content-ai-caption", { body: input });
  });

  it("surfaces the function's own error message, not the generic supabase string", async () => {
    invokeMock.mockResolvedValue(httpError({ error: "Your monthly AI allowance has been reached.", code: "USAGE_LIMIT_REACHED" }));
    const err = await generateContentCaption(input).catch((e) => e);
    expect(err.message).toBe("Your monthly AI allowance has been reached.");
  });

  it("falls back to the supabase message when no body is readable", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: {} } });
    const err = await generateContentCaption(input).catch((e) => e);
    expect(err.message).toBe("Edge Function returned a non-2xx status code");
  });
});
