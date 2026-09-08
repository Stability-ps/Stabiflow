import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceTab } from "./WorkspaceTab";

function freshSettings() {
  return {
    business_description: "",
    website: "",
    timezone: "Africa/Johannesburg",
    currency: "ZAR",
    industry: "",
    contact_email: "",
    contact_phone: "",
    brand_primary_color: "",
    secondary_brand_color: "",
    brand_accent_color: "",
    default_ad_cta: "",
    logo_path: null as string | null,
  };
}

// useWorkspaceProfile (the real hook) is backed by react-query, which
// keeps a STABLE `data` object reference between renders as long as the
// underlying query hasn't changed - WorkspaceTab's `useEffect(..., [data])`
// relies on that to only sync state from the server ONCE, not re-stomp
// local edits on every re-render. The mock below must preserve that same
// stable-reference behaviour (one object per test, mutated in place),
// or typing into a field gets silently reset by the effect mid-test.
const mocks = vi.hoisted(() => ({ data: { workspace: { name: "Acme", slug: "acme" }, settings: freshSettings() } }));

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
  // normalizeHexColor/HEX_COLOR_RE are pure validation logic under test
  // here too - keep the real implementation, only stub the network calls.
  const actual = await importOriginal<typeof import("@/lib/workspaceProfile")>();
  return { ...actual, ...workspaceProfileMock };
});
vi.mock("@/lib/workspaceLifecycle", () => ({
  deleteWorkspace: vi.fn(),
  exportWorkspaceData: vi.fn(),
}));

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><WorkspaceTab /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WorkspaceTab - Brand Kit (approved reference-ads + Brand Kit plan)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.data = { workspace: { name: "Acme", slug: "acme" }, settings: freshSettings() };
  });

  it("renders a Brand Kit card reusing the existing profile's name/website/contact - no duplicate fields", () => {
    mocks.data.settings.website = "https://acme.co.za";
    mocks.data.settings.contact_email = "hello@acme.co.za";
    renderTab();
    expect(screen.getByText("Brand Kit")).toBeInTheDocument();
    // Only ONE "Workspace name" field exists (Brand Kit reuses it via a
    // read-only summary, it does not add a second editable copy).
    expect(screen.getAllByLabelText(/workspace name/i)).toHaveLength(1);
    expect(screen.getByText("https://acme.co.za · hello@acme.co.za")).toBeInTheDocument();
  });

  it("loads existing Brand Kit values into the colour and CTA fields", () => {
    mocks.data.settings.brand_primary_color = "#1f2937";
    mocks.data.settings.secondary_brand_color = "#64748b";
    mocks.data.settings.brand_accent_color = "#2563eb";
    mocks.data.settings.default_ad_cta = "Get a free quote";
    renderTab();
    expect(screen.getByLabelText(/primary colour/i)).toHaveValue("#1f2937");
    expect(screen.getByLabelText(/secondary colour/i)).toHaveValue("#64748b");
    expect(screen.getByLabelText(/accent colour/i)).toHaveValue("#2563eb");
    expect(screen.getByLabelText(/default cta/i)).toHaveValue("Get a free quote");
  });

  it("flags an invalid hex colour instead of silently accepting it", () => {
    renderTab();
    fireEvent.change(screen.getByLabelText(/primary colour/i), { target: { value: "blue" } });
    expect(screen.getByText(/use a hex colour like/i)).toBeInTheDocument();
  });

  it("saves Brand Kit colours and default CTA alongside the existing profile fields in one call", async () => {
    renderTab();
    fireEvent.change(screen.getByLabelText(/primary colour/i), { target: { value: "#1F2937" } });
    fireEvent.change(screen.getByLabelText(/default cta/i), { target: { value: "Book now" } });
    fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]);
    await waitFor(() => expect(workspaceProfileMock.updateWorkspaceProfile).toHaveBeenCalled());
    expect(workspaceProfileMock.updateWorkspaceProfile).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ brand_primary_color: "#1f2937", default_ad_cta: "Book now" }),
    );
  });

  it("clears a colour field to null rather than sending an empty string", async () => {
    mocks.data.settings.brand_primary_color = "#1f2937";
    renderTab();
    fireEvent.change(screen.getByLabelText(/primary colour/i), { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]);
    await waitFor(() => expect(workspaceProfileMock.updateWorkspaceProfile).toHaveBeenCalled());
    expect(workspaceProfileMock.updateWorkspaceProfile).toHaveBeenCalledWith("ws-1", expect.objectContaining({ brand_primary_color: null }));
  });
});
