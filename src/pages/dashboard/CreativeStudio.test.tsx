import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CreativeStudio from "./CreativeStudio";

const mocks = vi.hoisted(() => ({ assets: [] as Array<Record<string, unknown>> }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentWorkspaceId: "workspace-1",
    currentMembership: { workspace: { name: "Test Workspace" } },
    user: { id: "user-1" },
    hasPermission: () => true,
  }),
}));
vi.mock("@/hooks/useContentMediaAssets", () => ({ useContentMediaAssets: () => ({ data: mocks.assets }) }));
vi.mock("@/components/content/MediaPreview", () => ({ MediaPreview: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const brandProfilesMock = vi.hoisted(() => ({
  listBrandProfiles: vi.fn().mockResolvedValue([]),
  seedDefaultProfileIfMissing: vi.fn().mockResolvedValue(null),
  createBrandProfile: vi.fn(),
  updateBrandProfile: vi.fn(),
  deleteBrandProfile: vi.fn(),
}));
vi.mock("@/lib/brandProfiles", () => brandProfilesMock);

function supabaseChain() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => Promise.resolve({ data: [], error: null });
  chain.update = () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) });
  chain.then = (onFulfilled: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(onFulfilled);
  return chain;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => supabaseChain(), auth: { getUser: () => Promise.resolve({ data: { user: null } }) } },
}));

const creativeStudioMock = vi.hoisted(() => ({
  generateCreativeCopy: vi.fn(),
  generateVisualConcepts: vi.fn(),
  generateBatchVisuals: vi.fn(),
  planBatchRender: vi.fn(),
  storeRenderedCreative: vi.fn(),
  DEFAULT_REFERENCE_PREFERENCES: { keep_colours: false, keep_layout: false, keep_imagery: false, fresh_layout: false },
}));
vi.mock("@/lib/creativeStudio", () => creativeStudioMock);

function renderStudio() {
  return render(<MemoryRouter><CreativeStudio /></MemoryRouter>);
}

function openAdvanced() {
  fireEvent.click(screen.getByRole("button", { name: /show generation details/i }));
}

// fb180b0 (AI-first brief) keeps the reference-image grid closed until the
// user chooses "Add reference"; the selection flow itself is unchanged.
function openReferencePicker() {
  fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
}

describe("Creative Studio - one-page form (regression)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("explains the required field and disables the primary Generate Ads button", () => {
    mocks.assets = [];
    renderStudio();
    const textarea = screen.getByLabelText(/What do you want to create/i);
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/Tell StabiFlow what you want to promote before generating ads/i)).toBeInTheDocument();
  });

  it("shows a clear selected media card and allows removal", () => {
    mocks.assets = [{ id: "asset-1", title: "summer-sale.jpg", storage_path: "private/summer-sale.jpg", width_px: 1200, height_px: 900 }];
    renderStudio();
    openReferencePicker();
    fireEvent.click(screen.getByRole("button", { name: "Select summer-sale.jpg" }));
    expect(screen.getByText("Selected media")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Selected summer-sale.jpg" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Remove summer-sale.jpg" }));
    expect(screen.queryByText("Selected media")).not.toBeInTheDocument();
  });

  it("routes an empty library to the existing Media Library", () => {
    mocks.assets = [];
    renderStudio();
    expect(screen.getByText("Your Media Library is empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Media Library" })).toBeInTheDocument();
  });

  it("the advanced standalone-copy path still calls the existing copy generator with the brief", async () => {
    mocks.assets = [];
    creativeStudioMock.generateCreativeCopy.mockResolvedValue({
      ok: true,
      variants: [{ headline: "H", primaryText: "P", description: "D", cta: "Go" }],
    });
    renderStudio();
    fireEvent.change(screen.getByLabelText(/What do you want to create/i), { target: { value: "A weekend baking course" } });
    fireEvent.click(screen.getByRole("button", { name: /show standalone copy ideas/i }));
    fireEvent.click(screen.getByRole("button", { name: /generate copy ideas/i }));
    await waitFor(() => expect(creativeStudioMock.generateCreativeCopy).toHaveBeenCalledTimes(1));
    expect(creativeStudioMock.generateCreativeCopy).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", businessContext: "A weekend baking course", variantCount: 3 }),
    );
    expect(await screen.findByText("H")).toBeInTheDocument();
  });
});

describe("Creative Studio - one-click Generate Ads orchestration entry point", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the primary Generate Ads button with the concepts x formats calculation", () => {
    mocks.assets = [];
    renderStudio();
    expect(screen.getByRole("button", { name: /generate ads/i })).toBeInTheDocument();
    // Default: 3 concepts x 2 formats (1080x1080 + 1080x1350) = 6 ads.
    expect(screen.getAllByText(/= 6 finished ads/i).length).toBeGreaterThan(0);
  });

  it("advanced controls still expose the underlying stage-by-stage buttons (old workflow preserved)", async () => {
    mocks.assets = [];
    creativeStudioMock.generateVisualConcepts.mockRejectedValue(new Error("stop after the call is made"));
    renderStudio();
    fireEvent.change(screen.getByLabelText(/What do you want to create/i), { target: { value: "A bakery in Cape Town" } });
    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: /generate visual concepts/i }));
    await waitFor(() => expect(creativeStudioMock.generateVisualConcepts).toHaveBeenCalledTimes(1));
    expect(creativeStudioMock.generateVisualConcepts).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", businessContext: "A bakery in Cape Town" }),
    );
  });

  it("legacy no-reference workflow is unchanged: asset_purpose is not sent when nothing is selected", async () => {
    mocks.assets = [];
    creativeStudioMock.generateVisualConcepts.mockRejectedValue(new Error("stop after the call is made"));
    renderStudio();
    fireEvent.change(screen.getByLabelText(/What do you want to create/i), { target: { value: "A bakery in Cape Town" } });
    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: /generate visual concepts/i }));
    await waitFor(() => expect(creativeStudioMock.generateVisualConcepts).toHaveBeenCalledTimes(1));
    const call = creativeStudioMock.generateVisualConcepts.mock.calls[0][0];
    expect(call.assetPurpose).toBeNull();
  });
});

describe("Creative Studio - reference-ads asset purpose + controls (approved plan, still functional)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the purpose selector for an UNCLASSIFIED asset (asset_role null) - never gated on classification", () => {
    mocks.assets = [{ id: "asset-1", title: "old-ad.jpg", storage_path: "p", width_px: 1200, height_px: 900, asset_role: null }];
    renderStudio();
    openReferencePicker();
    fireEvent.click(screen.getByRole("button", { name: "Select old-ad.jpg" }));
    expect(screen.getByText("How should StabiFlow use this image?")).toBeInTheDocument();
    expect(screen.queryByText(/Media Library classifies this as/)).not.toBeInTheDocument();
  });

  it("suggests (but does not force) the purpose from an already-classified asset", () => {
    mocks.assets = [{ id: "asset-1", title: "old-ad.jpg", storage_path: "p", width_px: 1200, height_px: 900, asset_role: "reference_creative" }];
    renderStudio();
    openReferencePicker();
    fireEvent.click(screen.getByRole("button", { name: "Select old-ad.jpg" }));
    expect(screen.getByText(/Media Library classifies this as "Reference advert"/)).toBeInTheDocument();
    expect(screen.getByText("How should StabiFlow use this reference?")).toBeInTheDocument();
  });

  it("passes asset_purpose and reference_preferences through to concept generation when Reference is chosen", async () => {
    mocks.assets = [{ id: "asset-1", title: "old-ad.jpg", storage_path: "p", width_px: 1200, height_px: 900, asset_role: "reference_creative" }];
    creativeStudioMock.generateVisualConcepts.mockRejectedValue(new Error("stop after the call is made"));
    renderStudio();
    fireEvent.change(screen.getByLabelText(/What do you want to create/i), { target: { value: "A bakery in Cape Town" } });
    openReferencePicker();
    fireEvent.click(screen.getByRole("button", { name: "Select old-ad.jpg" }));
    expect(screen.getByText("How should StabiFlow use this reference?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keep similar colours"));
    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: /generate visual concepts/i }));
    await waitFor(() => expect(creativeStudioMock.generateVisualConcepts).toHaveBeenCalledTimes(1));
    expect(creativeStudioMock.generateVisualConcepts).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMediaAssetId: "asset-1",
        assetPurpose: "reference_creative",
        referencePreferences: expect.objectContaining({ keep_colours: true, fresh_layout: false }),
      }),
    );
  });
});
