import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { fetchStudioAccess } from "@/lib/businessStudio";

describe("fetchStudioAccess", () => {
  beforeEach(() => invoke.mockReset());

  it("uses accessMode when the server returns it", async () => {
    invoke.mockResolvedValue({ data: { accessMode: "purchased", canExportPdf: true }, error: null });
    await expect(fetchStudioAccess("ws")).resolves.toBe("purchased");
  });

  it("falls back to canExportPdf on deployments that don't return accessMode", async () => {
    invoke.mockResolvedValue({ data: { canExportPdf: false }, error: null });
    await expect(fetchStudioAccess("ws")).resolves.toBe("teaser");
    invoke.mockResolvedValue({ data: { canExportPdf: true }, error: null });
    await expect(fetchStudioAccess("ws")).resolves.toBe("full");
  });
});
