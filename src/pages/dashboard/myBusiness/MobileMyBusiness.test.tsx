import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import MyBusiness from "@/pages/dashboard/MyBusiness";
import BusinessHub from "@/pages/dashboard/BusinessHub";

// jsdom's matchMedia (src/test/setup.ts) never matches, i.e. a phone-sized
// viewport - so MyBusiness renders its mobile layout here.

const auth = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentWorkspaceId: "ws-1", currentMembership: { role: auth.role, workspace: { name: "Acme WS" } }, user: { id: "u1" }, profile: null, hasPermission: () => true }),
}));
const flags = vi.hoisted(() => ({ on: ["module.business_studio"] as string[] }));
vi.mock("@/hooks/useFeatureFlags", () => ({ useFeatureFlags: () => ({ isEnabled: (k: string) => flags.on.includes(k), isLoading: false, hasAdvancedModules: false }) }));
vi.mock("@/components/creative-studio/BrandProfileSelector", () => ({ BrandProfileSelector: () => <div>Brand selector</div> }));
vi.mock("@/components/business/WebsiteMonitorCard", () => ({ WebsiteMonitorCard: () => <div>Website monitoring card</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const data = vi.hoisted(() => ({
  proposals: [] as unknown[],
  scanWebsite: vi.fn(),
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  update: vi.fn(),
  bundle: null as unknown,
}));
vi.mock("@/lib/businessStudio", async (orig) => ({
  ...(await orig<typeof import("@/lib/businessStudio")>()),
  scanWebsite: (...a: unknown[]) => data.scanWebsite(...a),
  fetchPendingProposals: () => Promise.resolve(data.proposals),
  acceptProposal: (...a: unknown[]) => data.acceptProposal(...a),
  rejectProposal: (...a: unknown[]) => data.rejectProposal(...a),
}));
vi.mock("@/lib/businessIdentity", async (orig) => ({
  ...(await orig<typeof import("@/lib/businessIdentity")>()),
  fetchBusinessIdentity: () => Promise.resolve(data.bundle),
  updateBusinessIdentity: (...a: unknown[]) => data.update(...a),
}));

const identity = (over: Record<string, unknown> = {}) => ({
  id: "bi-1", workspace_id: "ws-1", trading_name: "Acme", legal_name: null, country_code: "ZA", industry: null, website: "https://acme.co.za", founded_year: null,
  employee_count_range: null, tagline: null, short_description: null, long_description: null, mission: null, vision: null, core_values: [], brand_profile_id: null,
  field_provenance: {}, ...over,
});
const bundle = (over: Record<string, unknown> = {}, lists: Record<string, unknown[]> = {}) => ({
  identity: identity(over), contacts: [], locations: [], socialLinks: [], offerings: [], team: [], projects: [], certifications: [], identifiers: [], ...lists,
});
const proposal = { id: "p1", workspace_id: "ws-1", origin: "website_scan", target: "identity_field", field: "mission", proposed: { value: "Fix every leak." }, current_value: null, evidence: "Our mission: fix every leak.", evidence_url: "https://acme.co.za/about", extraction_method: "ai_extraction", status: "pending" };

function Probe() {
  const l = useLocation();
  return <output data-testid="loc">{l.pathname + l.search}</output>;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/business" element={<MyBusiness />} />
          <Route path="/app/business-hub" element={<BusinessHub />} />
          <Route path="*" element={null} />
        </Routes>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("My Business on a phone", () => {
  afterEach(() => {
    cleanup();
    auth.role = "owner";
    flags.on = ["module.business_studio"];
    data.proposals = [];
    data.scanWebsite.mockReset();
    data.acceptProposal.mockReset();
    data.rejectProposal.mockReset();
  });

  it("leads with compact progress and an actionable completion card (missing details collapsed)", async () => {
    data.bundle = bundle();
    renderAt("/app/business");
    expect(await screen.findByRole("heading", { level: 1, name: "My Business" })).toBeInTheDocument();
    expect(screen.getByText(/% complete$/)).toBeInTheDocument();
    const card = screen.getByTestId("complete-profile-card");
    expect(within(card).getByText(/items remaining/)).toBeInTheDocument();
    expect(document.getElementById("missing-list")).toBeNull();
    // Desktop's long "Still missing: a, b, c..." paragraph is not used on phones.
    expect(screen.queryByText(/^Still missing:/)).not.toBeInTheDocument();
  });

  it("Continue setup opens the most important missing section", async () => {
    data.bundle = bundle();
    renderAt("/app/business");
    fireEvent.click(await screen.findByRole("button", { name: "Continue setup" }));
    // Heaviest missing item for this bundle: "At least 3 services or products".
    expect(screen.getByTestId("loc")).toHaveTextContent("/app/business?section=offerings");
    expect(screen.getByText("Services and products")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All sections" })).toBeInTheDocument();
  });

  it("expands what's missing and jumps straight to that section", async () => {
    data.bundle = bundle();
    renderAt("/app/business");
    fireEvent.click(await screen.findByRole("button", { name: /What's missing/ }));
    const chips = within(document.getElementById("missing-list")!).getAllByRole("button");
    // 44px touch targets with a visible keyboard focus ring (review finding 11).
    for (const chip of chips) expect(chip.className).toMatch(/\bmin-h-11\b.*\bfocus-visible:ring-2\b/);
    fireEvent.click(within(document.getElementById("missing-list")!).getByRole("button", { name: "Social media links" }));
    expect(screen.getByTestId("loc")).toHaveTextContent("section=social");
  });

  it("shows compact section cards with status, current value and the right action", async () => {
    data.bundle = bundle({ industry: "Plumbing" }, { offerings: [{ id: "o1" }, { id: "o2" }, { id: "o3" }] });
    renderAt("/app/business");
    const nav = await screen.findByRole("navigation", { name: "Business sections" });
    expect(within(nav).getByRole("button", { name: /^Company:/ })).toHaveTextContent("Acme · Plumbing");
    const services = within(nav).getByRole("button", { name: /^Services:/ });
    expect(services).toHaveTextContent("3 services and products");
    expect(services).toHaveTextContent("Edit");
    expect(within(nav).getByRole("button", { name: /^Team:/ })).toHaveTextContent("Add");
    expect(within(nav).getByRole("link", { name: /Documents/ })).toHaveAttribute("href", "/app/documents");
  });

  it("Company section edits the existing identity form with a sticky Save", async () => {
    data.bundle = bundle();
    renderAt("/app/business?section=company");
    expect(await screen.findByLabelText("Trading name")).toHaveValue("Acme");
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Trading name"), { target: { value: "Acme Plumbing" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("Scan & complete profile runs the existing Business Studio scan and opens the review", async () => {
    data.bundle = bundle();
    data.scanWebsite.mockResolvedValue({ scanId: "s1", finalUrl: "https://acme.co.za/", pagesFetched: 3, proposalsCreated: 1, summary: { name: "Acme", description: null, website: null } });
    renderAt("/app/business");
    const card = await screen.findByTestId("scan-profile-card");
    expect(within(card).getByLabelText("Website to scan")).toHaveValue("https://acme.co.za");
    data.proposals = [proposal];
    fireEvent.click(within(card).getByRole("button", { name: /Scan & complete profile/ }));
    await waitFor(() => expect(data.scanWebsite).toHaveBeenCalledWith("ws-1", "https://acme.co.za"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("section=review"));
    expect(await screen.findByText("Fix every leak.")).toBeInTheDocument();
  });

  it("hides the scan when Business Studio is off or the member can't edit", async () => {
    data.bundle = bundle();
    flags.on = [];
    renderAt("/app/business");
    await screen.findByRole("heading", { level: 1, name: "My Business" });
    expect(screen.queryByTestId("scan-profile-card")).not.toBeInTheDocument();
    cleanup();
    flags.on = ["module.business_studio"];
    auth.role = "member";
    renderAt("/app/business");
    await screen.findByRole("heading", { level: 1, name: "My Business" });
    expect(screen.queryByTestId("scan-profile-card")).not.toBeInTheDocument();
  });

  it("review: accept, correct, reject a proposal with provenance and phone-size buttons", async () => {
    data.bundle = bundle();
    data.proposals = [proposal];
    data.acceptProposal.mockResolvedValue("accepted");
    data.rejectProposal.mockResolvedValue("rejected");
    renderAt("/app/business");
    fireEvent.click(await screen.findByRole("button", { name: /1 change to review/ }));
    expect(await screen.findByText("Fix every leak.")).toBeInTheDocument();
    expect(screen.getByText("Found on your website")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /source/ })).toHaveAttribute("href", "https://acme.co.za/about");
    const accept = screen.getByRole("button", { name: /Accept/ });
    expect(accept.className).toContain("h-11");
    fireEvent.click(screen.getByRole("button", { name: /Correct/ }));
    fireEvent.change(screen.getByLabelText("value"), { target: { value: "Fix every leak, first time." } });
    fireEvent.click(screen.getByRole("button", { name: /Save and accept/ }));
    await waitFor(() => expect(data.acceptProposal).toHaveBeenCalledWith("p1", expect.objectContaining({ value: "Fix every leak, first time." })));
    fireEvent.click(screen.getByRole("button", { name: /Not correct/ }));
    await waitFor(() => expect(data.rejectProposal).toHaveBeenCalledWith("p1"));
  });
});

describe("Business hub", () => {
  afterEach(() => {
    cleanup();
    flags.on = ["module.business_studio"];
    data.proposals = [];
  });

  it("routes to every existing Business Studio / My Business module", async () => {
    data.bundle = bundle();
    renderAt("/app/business-hub");
    await screen.findByText(/% complete/);
    const href = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href");
    expect(href(/^Business Studio/)).toBe("/app/business-studio");
    expect(href(/^My Business/)).toBe("/app/business");
    expect(href(/^Documents/)).toBe("/app/documents");
    expect(href(/^Company(?! profile)/)).toBe("/app/business?section=company");
    expect(href(/^Services & products/)).toBe("/app/business?section=offerings");
    expect(href(/^Brand assets/)).toBe("/app/business?section=branding");
    expect(href(/^Team/)).toBe("/app/business?section=team");
    expect(href(/^Projects & case studies/)).toBe("/app/business?section=projects");
    expect(href(/^Certifications & registrations/)).toBe("/app/business?section=credentials");
    expect(href(/^Company profile PDF/)).toBe("/app/business-studio");
  });

  it("hides Business Studio entries when module.business_studio is off", async () => {
    data.bundle = bundle();
    flags.on = [];
    renderAt("/app/business-hub");
    await screen.findByText(/% complete/);
    expect(screen.queryByRole("link", { name: /^Business Studio/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Company profile PDF/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^My Business/ })).toBeInTheDocument();
  });

  it("surfaces pending proposals and opens them in My Business", async () => {
    data.bundle = bundle();
    data.proposals = [proposal, { ...proposal, id: "p2" }];
    renderAt("/app/business-hub");
    fireEvent.click(await screen.findByRole("link", { name: /2 changes to review/ }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/app/business?section=review");
    expect(await screen.findAllByText("Fix every leak.")).toHaveLength(2);
  });
});

// Finding 3: "Done" in the Company / About sections must never discard edits.
describe("My Business phone sections: Done saves first", () => {
  afterEach(() => {
    cleanup();
    data.update.mockReset();
  });

  const savedIdentity = (over: Record<string, unknown>) => ({ ...(data.bundle as { identity: Record<string, unknown> }).identity, ...over });

  it("Company: edit -> Done saves via the canonical save, then closes", async () => {
    data.bundle = bundle();
    data.update.mockImplementation(async (_cur: unknown, patch: Record<string, unknown>) => savedIdentity(patch));
    renderAt("/app/business?section=company");
    fireEvent.change(await screen.findByLabelText("Trading name"), { target: { value: "Acme Plumbing" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(data.update).toHaveBeenCalledTimes(1));
    expect(data.update.mock.calls[0][1]).toMatchObject({ trading_name: "Acme Plumbing" });
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent(/^\/app\/business$/));
  });

  it("About: edit -> Done saves, then closes", async () => {
    data.bundle = bundle();
    data.update.mockImplementation(async (_cur: unknown, patch: Record<string, unknown>) => savedIdentity(patch));
    renderAt("/app/business?section=about");
    fireEvent.change(await screen.findByLabelText("Mission"), { target: { value: "Fix every leak." } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(data.update).toHaveBeenCalledTimes(1));
    expect(data.update.mock.calls[0][1]).toMatchObject({ mission: "Fix every leak." });
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent(/^\/app\/business$/));
  });

  it("a failed save keeps the section open and the edits intact", async () => {
    data.bundle = bundle();
    data.update.mockRejectedValue(new Error("Network error"));
    renderAt("/app/business?section=company");
    fireEvent.change(await screen.findByLabelText("Trading name"), { target: { value: "Acme Plumbing" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(data.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).not.toBeDisabled());
    expect(screen.getByTestId("loc")).toHaveTextContent("section=company");
    expect(screen.getByLabelText("Trading name")).toHaveValue("Acme Plumbing");
  });

  it("Done with no changes closes without writing", async () => {
    data.bundle = bundle();
    renderAt("/app/business?section=company");
    await screen.findByLabelText("Trading name");
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent(/^\/app\/business$/));
    expect(data.update).not.toHaveBeenCalled();
  });
});
