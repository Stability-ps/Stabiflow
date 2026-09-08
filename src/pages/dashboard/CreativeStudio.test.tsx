import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CreativeStudio from "./CreativeStudio";

const mocks = vi.hoisted(() => ({ assets: [] as Array<Record<string, unknown>> }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "workspace-1", hasPermission: () => true }) }));
vi.mock("@/hooks/useContentMediaAssets", () => ({ useContentMediaAssets: () => ({ data: mocks.assets }) }));
vi.mock("@/components/content/MediaPreview", () => ({ MediaPreview: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }) }), auth: { getUser: () => Promise.resolve({ data: { user: null } }) } },
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

describe("Creative Studio - existing copy generation (regression)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("explains the required field and uses the shared light textarea", () => {
    mocks.assets = [];
    renderStudio();
    const textarea = screen.getByLabelText(/what is the product or service/i);
    expect(textarea).toHaveClass("bg-background", "text-foreground");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/describe the product or service before generating/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate copy/i })).toBeDisabled();
  });

  it("shows a clear selected media card and allows removal", () => {
    mocks.assets = [{ id: "asset-1", title: "summer-sale.jpg", storage_path: "private/summer-sale.jpg", width_px: 1200, height_px: 900 }];
    renderStudio();
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

  it("still calls the existing copy generator with the brief, unchanged by the batch-ads extension", async () => {
    mocks.assets = [];
    creativeStudioMock.generateCreativeCopy.mockResolvedValue({
      ok: true,
      variants: [{ headline: "H", primaryText: "P", description: "D", cta: "Go" }],
    });
    renderStudio();
    fireEvent.change(screen.getByLabelText(/what is the product or service/i), { target: { value: "A weekend baking course" } });
    fireEvent.click(screen.getByRole("button", { name: /generate copy/i }));
    await waitFor(() => expect(creativeStudioMock.generateCreativeCopy).toHaveBeenCalledTimes(1));
    expect(creativeStudioMock.generateCreativeCopy).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", businessContext: "A weekend baking course", variantCount: 3 }),
    );
    expect(await screen.findByText("H")).toBeInTheDocument();
  });
});

describe("Creative Studio - batch image ads extension", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("adds a 'Generate visual concepts' entry point below the copy section without a second route", () => {
    mocks.assets = [];
    renderStudio();
    // Same page, extended in place - not a new wizard/route.
    expect(screen.getByRole("button", { name: /generate visual concepts/i })).toBeInTheDocument();
  });

  it("feeds the shared brief into concept generation (no re-entering the brief)", async () => {
    mocks.assets = [];
    creativeStudioMock.generateVisualConcepts.mockRejectedValue(new Error("stop after the call is made"));
    renderStudio();
    fireEvent.change(screen.getByLabelText(/what is the product or service/i), { target: { value: "A bakery in Cape Town" } });
    fireEvent.click(screen.getByRole("button", { name: /generate visual concepts/i }));
    await waitFor(() => expect(creativeStudioMock.generateVisualConcepts).toHaveBeenCalledTimes(1));
    expect(creativeStudioMock.generateVisualConcepts).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", businessContext: "A bakery in Cape Town", conceptCount: 4 }),
    );
  });
});

describe("Creative Studio - reference-ads asset purpose + controls (approved plan)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the purpose selector for an UNCLASSIFIED asset (asset_role null) - never gated on classification", () => {
    mocks.assets = [{ id: "asset-1", title: "old-ad.jpg", storage_path: "p", width_px: 1200, height_px: 900, asset_role: null }];
    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: "Select old-ad.jpg" }));
    expect(screen.getByText("How should StabiFlow use this image?")).toBeInTheDocument();
    expect(screen.queryByText(/Media Library classifies this as/)).not.toBeInTheDocument();
  });

  it("suggests (but does not force) the purpose from an already-classified asset", () => {
    mocks.assets = [{ id: "asset-1", title: "old-ad.jpg", storage_path: "p", width_px: 1200, height_px: 900, asset_role: "reference_creative" }];
    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: "Select old-ad.jpg" }));
    expect(screen.getByText(/Media Library classifies this as "Reference advert"/)).toBeInTheDocument();
    // The suggested purpose pre-selects reference_creative, which reveals the reference controls.
    expect(screen.getByText("How should StabiFlow use this reference?")).toBeInTheDocument();
  });

  it("reference preference controls stay hidden for product_image/background purposes", () => {
    mocks.assets = [{ id: "asset-1", title: "product.jpg", storage_path: "p", width_px: 1200, height_px: 900, asset_role: "product_image" }];
    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: "Select product.jpg" }));
    expect(screen.queryByText("How should StabiFlow use this reference?")).not.toBeInTheDocument();
  });

  it("passes asset_purpose and reference_preferences through to concept generation when Reference is chosen", async () => {
    // Pre-classified so the purpose auto-suggests without driving the Radix
    // Select's pointer interactions (covered structurally by the "suggests"
    // test above) - this test's job is the checkbox -> payload wiring.
    mocks.assets = [{ id: "asset-1", title: "old-ad.jpg", storage_path: "p", width_px: 1200, height_px: 900, asset_role: "reference_creative" }];
    creativeStudioMock.generateVisualConcepts.mockRejectedValue(new Error("stop after the call is made"));
    renderStudio();
    fireEvent.change(screen.getByLabelText(/what is the product or service/i), { target: { value: "A bakery in Cape Town" } });
    fireEvent.click(screen.getByRole("button", { name: "Select old-ad.jpg" }));
    expect(screen.getByText("How should StabiFlow use this reference?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keep similar colours"));
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

  it("legacy no-reference workflow is unchanged: asset_purpose is not sent when nothing is selected", async () => {
    mocks.assets = [];
    creativeStudioMock.generateVisualConcepts.mockRejectedValue(new Error("stop after the call is made"));
    renderStudio();
    fireEvent.change(screen.getByLabelText(/what is the product or service/i), { target: { value: "A bakery in Cape Town" } });
    fireEvent.click(screen.getByRole("button", { name: /generate visual concepts/i }));
    await waitFor(() => expect(creativeStudioMock.generateVisualConcepts).toHaveBeenCalledTimes(1));
    const call = creativeStudioMock.generateVisualConcepts.mock.calls[0][0];
    expect(call.assetPurpose).toBeNull();
  });
});
