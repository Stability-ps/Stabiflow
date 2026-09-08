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

function freshData() {
  return { workspace: { id: "ws-1", name: "Acme", slug: "acme" }, settings: freshSettings() };
}

// useWorkspaceProfile (the real hook) is backed by react-query, which
// keeps a STABLE `data` object reference between renders as long as the
// underlying query hasn't changed - WorkspaceTab's hydration effect relies
// on that (plus its own hydratedWorkspaceId guard) to only sync state from
// the server once per mount, not re-stomp local edits on every re-render.
// vi.hoisted callbacks run before other module code, so the initial value
// here duplicates freshSettings()'s shape rather than calling it.
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
  // normalizeHexColor/HEX_COLOR_RE/isCompleteHexColor are pure validation
  // logic under test here too - keep the real implementation, only stub
  // the network calls.
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

// The text input and the native colour-picker input both expose an
// accessible name containing "Primary colour" (the picker's is "Primary
// colour picker") - getByLabelText's regex would match both, so tests
// disambiguate by element type.
function primaryTextInput() {
  return screen.getByLabelText(/^primary colour$/i);
}
function primaryPicker() {
  return screen.getByLabelText("Primary colour picker") as HTMLInputElement;
}

describe("WorkspaceTab - Brand Kit (approved reference-ads + Brand Kit plan)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.data = freshData();
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

  it("1. loads existing Brand Kit colour values into the text fields on hydration", () => {
    mocks.data.settings.brand_primary_color = "#1f2937";
    mocks.data.settings.secondary_brand_color = "#64748b";
    mocks.data.settings.brand_accent_color = "#2563eb";
    renderTab();
    expect(primaryTextInput()).toHaveValue("#1f2937");
    expect(screen.getByLabelText(/^secondary colour$/i)).toHaveValue("#64748b");
    expect(screen.getByLabelText(/^accent colour$/i)).toHaveValue("#2563eb");
  });

  it("2. loads the saved default CTA on hydration", () => {
    mocks.data.settings.default_ad_cta = "Get a free quote";
    renderTab();
    expect(screen.getByLabelText(/default cta/i)).toHaveValue("Get a free quote");
  });

  it("3. renders the saved contact/website summary from the same authoritative state, not a duplicate", () => {
    mocks.data.settings.website = "https://acme.co.za";
    mocks.data.settings.contact_email = "hello@acme.co.za";
    renderTab();
    expect(screen.getByText("https://acme.co.za · hello@acme.co.za")).toBeInTheDocument();
  });

  it("4. unmounting and remounting (Settings tab switch / route navigation) still shows the persisted values, never resets to blank", () => {
    mocks.data.settings.brand_primary_color = "#800080";
    mocks.data.settings.secondary_brand_color = "#80d080";
    mocks.data.settings.brand_accent_color = "#200080";
    mocks.data.settings.default_ad_cta = "Get This";
    mocks.data.settings.contact_email = "hello@acme.co.za";
    const { unmount } = renderTab();
    unmount();
    renderTab();
    expect(primaryTextInput()).toHaveValue("#800080");
    expect(screen.getByLabelText(/^secondary colour$/i)).toHaveValue("#80d080");
    expect(screen.getByLabelText(/^accent colour$/i)).toHaveValue("#200080");
    expect(screen.getByLabelText(/default cta/i)).toHaveValue("Get This");
    expect(screen.queryByText("No website or contact details set yet")).not.toBeInTheDocument();
  });

  it("4b. a background refetch of the SAME workspace (new data reference, unchanged values) does not clobber an in-progress typed edit", () => {
    mocks.data.settings.brand_primary_color = "#1f2937";
    const { rerender, client } = renderTab();
    fireEvent.change(primaryTextInput(), { target: { value: "#800080" } });
    // Simulate react-query's staleTime:0 background refetch resolving with
    // a NEW object reference for the SAME workspace (e.g. re-mount-on-focus
    // or an invalidate elsewhere) - this must not stomp the user's edit.
    mocks.data = { ...mocks.data, settings: { ...mocks.data.settings } };
    rerender(<QueryClientProvider client={client}><Tree /></QueryClientProvider>);
    expect(primaryTextInput()).toHaveValue("#800080");
  });

  it("5. fallback placeholder colours only ever apply when the persisted value is genuinely null - a real value is never overwritten", () => {
    mocks.data.settings.brand_primary_color = "#1f2937"; // same as the placeholder text, on purpose
    renderTab();
    // The rendered VALUE must be the real persisted colour, not merely
    // placeholder text that happens to look similar.
    expect(primaryTextInput()).toHaveAttribute("value", "#1f2937");
    expect(primaryTextInput()).not.toHaveAttribute("placeholder", "");
  });

  it("5b. an unset (null) colour renders empty with only placeholder text, never a fabricated value", () => {
    renderTab();
    expect(primaryTextInput()).toHaveValue("");
    expect(primaryTextInput()).toHaveAttribute("placeholder", "#1F2937");
  });

  it("6. an unset colour is never automatically written back to the database on save", async () => {
    renderTab();
    fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]);
    await waitFor(() => expect(workspaceProfileMock.updateWorkspaceProfile).toHaveBeenCalled());
    expect(workspaceProfileMock.updateWorkspaceProfile).toHaveBeenCalledWith("ws-1", expect.objectContaining({ brand_primary_color: null }));
  });

  it("7. typing a valid hex updates the colour picker swatch", () => {
    renderTab();
    fireEvent.change(primaryTextInput(), { target: { value: "#800080" } });
    expect(primaryPicker()).toHaveValue("#800080");
  });

  it("8. selecting through input[type=color] updates the text value", () => {
    renderTab();
    fireEvent.change(primaryPicker(), { target: { value: "#123456" } });
    expect(primaryTextInput()).toHaveValue("#123456");
  });

  it("9. an incomplete typed hex does not destroy the last valid picker value", () => {
    mocks.data.settings.brand_primary_color = "#1f2937";
    renderTab();
    expect(primaryPicker()).toHaveValue("#1f2937");
    fireEvent.change(primaryTextInput(), { target: { value: "#80" } });
    // The text field freely shows the in-progress value...
    expect(primaryTextInput()).toHaveValue("#80");
    // ...but the picker (which cannot hold an invalid colour) keeps
    // showing the last known-good one instead of resetting to black.
    expect(primaryPicker()).toHaveValue("#1f2937");
  });

  it("10. invalid hex blocks Save and shows inline validation after blur", () => {
    renderTab();
    const input = primaryTextInput();
    fireEvent.change(input, { target: { value: "blue" } });
    fireEvent.blur(input);
    expect(screen.getByText(/use a hex colour like/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /save changes/i })[0]).toBeDisabled();
  });

  it("10b. does not show the inline error before the field has been blurred (no per-keystroke nagging)", () => {
    renderTab();
    fireEvent.change(primaryTextInput(), { target: { value: "b" } });
    expect(screen.queryByText(/use a hex colour like/i)).not.toBeInTheDocument();
  });

  it("11. saving preserves unrelated workspace profile fields untouched", async () => {
    mocks.data.settings.industry = "Marketing Agency";
    mocks.data.settings.timezone = "Africa/Johannesburg";
    renderTab();
    fireEvent.change(primaryTextInput(), { target: { value: "#800080" } });
    fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]);
    await waitFor(() => expect(workspaceProfileMock.updateWorkspaceProfile).toHaveBeenCalled());
    expect(workspaceProfileMock.updateWorkspaceProfile).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ industry: "Marketing Agency", timezone: "Africa/Johannesburg", brand_primary_color: "#800080" }),
    );
  });

  it("12. after save, remounting still displays the saved values", async () => {
    const { unmount } = renderTab();
    fireEvent.change(primaryTextInput(), { target: { value: "#800080" } });
    fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]);
    await waitFor(() => expect(workspaceProfileMock.updateWorkspaceProfile).toHaveBeenCalled());
    // Simulate the server now holding what was just saved (the real save
    // path persists this; here we mirror it into the mock "database").
    mocks.data.settings.brand_primary_color = "#800080";
    unmount();
    renderTab();
    expect(primaryTextInput()).toHaveValue("#800080");
  });

  it("saves Brand Kit colours and default CTA alongside the existing profile fields in one call", async () => {
    renderTab();
    fireEvent.change(primaryTextInput(), { target: { value: "#1F2937" } });
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
    fireEvent.change(primaryTextInput(), { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]);
    await waitFor(() => expect(workspaceProfileMock.updateWorkspaceProfile).toHaveBeenCalled());
    expect(workspaceProfileMock.updateWorkspaceProfile).toHaveBeenCalledWith("ws-1", expect.objectContaining({ brand_primary_color: null }));
  });
});
