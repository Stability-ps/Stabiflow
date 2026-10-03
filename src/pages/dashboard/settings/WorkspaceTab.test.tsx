import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceTab } from "./WorkspaceTab";

// Brand management moved to Creative Studio (instruction #24 - one
// authoritative editing surface). This card is now a READ-ONLY summary
// of the legacy default brand plus a link, not a second editor - so
// these tests only cover that it displays correctly and links out, not
// colour-picker sync/validation (that UX now lives in
// BrandColorField.test.tsx, exercised through BrandProfileEditor).
function freshSettings() {
  return {
    business_description: "", website: "", timezone: "Africa/Johannesburg", currency: "ZAR", industry: "",
    contact_email: "", contact_phone: "", brand_primary_color: "", secondary_brand_color: "", brand_accent_color: "",
    default_ad_cta: "", logo_path: null as string | null,
  };
}

const mocks = vi.hoisted(() => ({
  data: {
    workspace: { id: "ws-1", name: "Acme", slug: "acme" },
    settings: {
      business_description: "", website: "", timezone: "Africa/Johannesburg", currency: "ZAR", industry: "",
      contact_email: "", contact_phone: "", brand_primary_color: "", secondary_brand_color: "", brand_accent_color: "",
      default_ad_cta: "", logo_path: null as string | null,
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentWorkspaceId: "ws-1",
    currentMembership: { role: "admin" },
    refreshMemberships: vi.fn(),
  }),
}));
vi.mock("@/hooks/useWorkspaceProfile", () => ({
  useWorkspaceProfile: () => ({ data: mocks.data, isLoading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const workspaceProfileMock = vi.hoisted(() => ({
  updateWorkspaceIdentity: vi.fn().mockResolvedValue(undefined),
  updateWorkspaceProfile: vi.fn().mockResolvedValue(undefined),
  isWorkspaceSlugAvailable: vi.fn().mockResolvedValue(true),
  uploadWorkspaceLogo: vi.fn(),
  getWorkspaceLogoUrl: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/workspaceProfile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspaceProfile")>();
  return { ...actual, ...workspaceProfileMock };
});
vi.mock("@/lib/workspaceLifecycle", () => ({
  deleteWorkspace: vi.fn(),
  exportWorkspaceData: vi.fn(),
}));

function Tree() {
  return (
    <MemoryRouter>
      <WorkspaceTab />
    </MemoryRouter>
  );
}

function renderTab(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { client, ...render(<QueryClientProvider client={client}><Tree /></QueryClientProvider>) };
}

describe("WorkspaceTab - Brand Kit summary + link to Creative Studio", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.data = { workspace: { id: "ws-1", name: "Acme", slug: "acme" }, settings: freshSettings() };
  });

  it("renders a Brand Kit card reusing the existing profile's name/website/contact - no duplicate fields", () => {
    mocks.data.settings.website = "https://acme.co.za";
    mocks.data.settings.contact_email = "hello@acme.co.za";
    renderTab();
    expect(screen.getByText("Brand Kit")).toBeInTheDocument();
    // Only ONE "Workspace name" field exists - the Brand Kit card is a
    // summary, not a second editable copy.
    expect(screen.getAllByLabelText(/workspace name/i)).toHaveLength(1);
    expect(screen.getByText("https://acme.co.za · hello@acme.co.za")).toBeInTheDocument();
  });

  it("shows a link to manage brands in Creative Studio, not an inline colour editor", () => {
    renderTab();
    expect(screen.getByRole("link", { name: /manage brands in creative studio/i })).toHaveAttribute("href", "/app/creative-studio");
    // The old inline editor is gone from this page.
    expect(screen.queryByLabelText(/^primary colour$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/default cta/i)).not.toBeInTheDocument();
  });

  it("shows legacy brand colour swatches read-only when set", () => {
    mocks.data.settings.brand_primary_color = "#1f2937";
    mocks.data.settings.brand_accent_color = "#2563eb";
    renderTab();
    // Rendered as plain coloured dots (aria-hidden), not editable inputs.
    const dots = document.querySelectorAll('span[style*="background-color"]');
    expect(dots.length).toBeGreaterThanOrEqual(2);
  });

  it("saving the workspace profile no longer sends any Brand Kit colour fields", async () => {
    renderTab();
    const { fireEvent, waitFor } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(workspaceProfileMock.updateWorkspaceProfile).toHaveBeenCalled());
    const payload = workspaceProfileMock.updateWorkspaceProfile.mock.calls[0][1];
    expect(payload).not.toHaveProperty("brand_primary_color");
    expect(payload).not.toHaveProperty("default_ad_cta");
  });

  it("unmounting and remounting still shows the persisted contact summary, never resets to blank", () => {
    mocks.data.settings.website = "https://acme.co.za";
    mocks.data.settings.contact_email = "hello@acme.co.za";
    const { unmount } = renderTab();
    unmount();
    renderTab();
    expect(screen.queryByText("No website or contact details set yet")).not.toBeInTheDocument();
  });
});
