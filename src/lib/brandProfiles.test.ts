import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrandProfile, listBrandProfiles, seedDefaultProfileIfMissing, updateBrandProfile } from "@/lib/brandProfiles";

const { state, supabaseMock } = vi.hoisted(() => {
  const state = {
    profiles: [] as Record<string, unknown>[],
    settings: null as Record<string, unknown> | null,
    updates: [] as { table: string; payload: unknown }[],
    inserted: null as Record<string, unknown> | null,
  };
  function profilesBuilder() {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (col: string, val: unknown) => {
      if (col === "workspace_id") return { ...chain, order: () => ({ order: () => Promise.resolve({ data: state.profiles.filter((p) => p.workspace_id === val), error: null }) }) };
      return chain;
    };
    chain.order = () => chain;
    chain.insert = (payload: Record<string, unknown>) => {
      state.updates.push({ table: "creative_brand_profiles", payload });
      const row = { id: `profile-${state.profiles.length + 1}`, created_at: "now", updated_at: "now", ...payload };
      state.inserted = row;
      state.profiles.push(row);
      return { select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) };
    };
    chain.update = (payload: Record<string, unknown>) => {
      state.updates.push({ table: "creative_brand_profiles", payload });
      return {
        eq: (_col: string, val: unknown) => ({
          eq: () => Promise.resolve({ data: null, error: null }),
          select: () => ({
            single: () => {
              const existing = state.profiles.find((p) => p.id === val) ?? {};
              const merged = { ...existing, ...payload };
              return Promise.resolve({ data: merged, error: null });
            },
          }),
        }),
      };
    };
    return chain;
  }
  function settingsBuilder() {
    return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.settings, error: null }) }) }) };
  }
  const supabaseMock = {
    from: (table: string) => (table === "creative_brand_profiles" ? profilesBuilder() : settingsBuilder()),
  };
  return { state, supabaseMock };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

function resetState() {
  state.profiles = [];
  state.settings = null;
  state.updates = [];
  state.inserted = null;
}

describe("brandProfiles - create/edit/multiple/default", () => {
  afterEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  it("creates a brand profile with the supplied fields", async () => {
    const profile = await createBrandProfile("ws-1", { name: "Car Smart Fix", companyName: "Car Smart Fix (Pty) Ltd", primaryColor: "#800080" });
    expect(profile.name).toBe("Car Smart Fix");
    expect(profile.companyName).toBe("Car Smart Fix (Pty) Ltd");
    expect(profile.primaryColor).toBe("#800080");
    expect(profile.workspaceId).toBe("ws-1");
  });

  it("supports multiple profiles in the same workspace", async () => {
    await createBrandProfile("ws-1", { name: "Brand One", companyName: "One Ltd" });
    await createBrandProfile("ws-1", { name: "Brand Two", companyName: "Two Ltd" });
    const list = await listBrandProfiles("ws-1");
    expect(list.map((p) => p.name).sort()).toEqual(["Brand One", "Brand Two"]);
  });

  it("updateBrandProfile only sends fields that were actually supplied (partial patch)", async () => {
    const created = await createBrandProfile("ws-1", { name: "Brand One", companyName: "One Ltd", website: "https://one.co.za" });
    const updated = await updateBrandProfile(created.id, "ws-1", { defaultCta: "Book now" });
    const lastPatch = state.updates.at(-1)?.payload as Record<string, unknown>;
    expect(lastPatch).toEqual({ default_cta: "Book now" });
    expect(updated.defaultCta).toBe("Book now");
  });

  it("marking a new profile as default clears any existing default first", async () => {
    await createBrandProfile("ws-1", { name: "Old default", companyName: "Old Ltd", isDefault: true });
    await createBrandProfile("ws-1", { name: "New default", companyName: "New Ltd", isDefault: true });
    // clearExistingDefault issues an update({is_default:false}) before the
    // new insert - assert it happened at least once.
    const clearedDefault = state.updates.some((u) => (u.payload as Record<string, unknown>).is_default === false);
    expect(clearedDefault).toBe(true);
  });
});

describe("brandProfiles - legacy Brand Kit compatibility seed", () => {
  afterEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  it("does not seed when the workspace already has a profile", async () => {
    await createBrandProfile("ws-1", { name: "Existing", companyName: "Existing Ltd" });
    const seeded = await seedDefaultProfileIfMissing("ws-1", "Acme");
    expect(seeded).toBeNull();
  });

  it("does not seed an empty profile when workspace_settings has no branding at all", async () => {
    state.settings = { logo_path: null, brand_primary_color: null, brand_accent_color: null, default_ad_cta: null, contact_phone: null, contact_email: null, website: null };
    const seeded = await seedDefaultProfileIfMissing("ws-1", "Acme");
    expect(seeded).toBeNull();
  });

  it("seeds ONE default profile from legacy workspace_settings when meaningful branding exists", async () => {
    state.settings = {
      logo_path: "ws-1/logo.png",
      brand_primary_color: "#1f2937",
      secondary_brand_color: null,
      brand_accent_color: null,
      brand_cta_text_color: null,
      ad_footer_disclaimer: null,
      default_ad_cta: "Get a quote",
      contact_email: "hi@acme.co",
      contact_phone: null,
      website: null,
    };
    const seeded = await seedDefaultProfileIfMissing("ws-1", "Acme");
    expect(seeded).not.toBeNull();
    expect(seeded?.isDefault).toBe(true);
    expect(seeded?.primaryColor).toBe("#1f2937");
    expect(seeded?.defaultCta).toBe("Get a quote");
    // The legacy logo path is intentionally NOT copied into
    // logoMediaAssetId - it stays null (see seedDefaultProfileIfMissing).
    expect(seeded?.logoMediaAssetId).toBeNull();
  });
});
