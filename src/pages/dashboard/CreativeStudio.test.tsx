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
