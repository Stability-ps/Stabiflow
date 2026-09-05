import { beforeEach, describe, expect, it, vi } from "vitest";
import { startIntegrationConnect } from "@/lib/integrations";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
}));

describe("startIntegrationConnect error handling", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("REGRESSION: extracts meta_not_enabled from non-2xx edge function JSON and throws a typed code error", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(JSON.stringify({ error: "meta_not_enabled" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      },
    });

    await expect(startIntegrationConnect("workspace-1", "meta")).rejects.toMatchObject({
      name: "IntegrationInvokeError",
      code: "meta_not_enabled",
      message: "meta_not_enabled",
    });
  });

  it("falls back to a safe generic message when no known code exists", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        message: "database stack trace should never reach users",
      },
    });

    await expect(startIntegrationConnect("workspace-1", "meta")).rejects.toMatchObject({
      message: "integrations-oauth-start failed",
      code: undefined,
    });
  });
});