import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CreativeStudio from "./CreativeStudio";

const mocks = vi.hoisted(() => ({ assets: [] as Array<Record<string, unknown>> }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "workspace-1", hasPermission: () => true }) }));
vi.mock("@/hooks/useContentMediaAssets", () => ({ useContentMediaAssets: () => ({ data: mocks.assets }) }));
vi.mock("@/components/content/MediaPreview", () => ({ MediaPreview: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock("@/lib/creativeStudio", () => ({ generateCreativeCopy: vi.fn() }));

function renderStudio() {
  return render(<MemoryRouter><CreativeStudio /></MemoryRouter>);
}

describe("Creative Studio form and media", () => {
  afterEach(cleanup);

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
});
