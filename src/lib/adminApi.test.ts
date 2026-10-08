import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { AdminApiError, adminConsole } from "@/lib/adminApi";

describe("adminConsole('me')", () => {
  beforeEach(() => invoke.mockReset());

  it("treats a non-staff answer ({ admin: false }) as the usual 403", async () => {
    invoke.mockResolvedValue({ data: { ok: true, admin: false }, error: null });
    const err = await adminConsole("me").catch((e) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect((err as AdminApiError).status).toBe(403);
  });

  it("returns staff details unchanged", async () => {
    invoke.mockResolvedValue({ data: { ok: true, userId: "u1", role: "owner", permissions: [] }, error: null });
    await expect(adminConsole("me")).resolves.toMatchObject({ userId: "u1", role: "owner" });
  });

  it("only applies the mapping to 'me'", async () => {
    invoke.mockResolvedValue({ data: { ok: true, admin: false }, error: null });
    await expect(adminConsole("overview")).resolves.toEqual({ ok: true, admin: false });
  });
});
