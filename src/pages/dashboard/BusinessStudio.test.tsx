import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import BusinessStudio from "./BusinessStudio";

const auth = { currentWorkspaceId: "ws-1", currentMembership: { role: "owner" }, hasPermission: () => true };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

const scanWebsite = vi.fn();
const fetchPreview = vi.fn();
vi.mock("@/lib/businessStudio", async (orig) => ({
  ...(await orig<typeof import("@/lib/businessStudio")>()),
  scanWebsite: (...a: unknown[]) => scanWebsite(...a),
  fetchPreview: (...a: unknown[]) => fetchPreview(...a),
  fetchStudioAccess: vi.fn().mockResolvedValue("full"),
  fetchPendingProposals: vi.fn().mockResolvedValue([
    { id: "p1", workspace_id: "ws-1", origin: "website_scan", target: "identity_field", field: "legal_name", proposed: { value: "Acme (Pty) Ltd" }, current_value: null, evidence: "Acme (Pty) Ltd", evidence_url: "https://acme.co.za/", extraction_method: "structured_data", status: "pending" },
  ]),
  acceptProposal: vi.fn().mockResolvedValue("accepted"),
}));
vi.mock("@/lib/businessIdentity", async (orig) => ({
  ...(await orig<typeof import("@/lib/businessIdentity")>()),
  fetchBusinessIdentity: vi.fn().mockResolvedValue({
    identity: { trading_name: "Acme", core_values: [] }, contacts: [], locations: [], socialLinks: [], offerings: [], team: [], projects: [], certifications: [], identifiers: [], sectionPreferences: [],
  }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BusinessStudio />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Business Studio flow", () => {
  afterEach(() => {
    cleanup();
    scanWebsite.mockReset();
  });

  it("scans the website, then shows 'We found this business' with facts to review and their source", async () => {
    scanWebsite.mockResolvedValue({ scanId: "s1", finalUrl: "https://acme.co.za/", pagesFetched: 4, proposalsCreated: 1, summary: { name: "Acme Engineering", description: "Steel structures", website: "https://acme.co.za/" } });
    renderPage();
    fireEvent.change(screen.getByLabelText("Your website address"), { target: { value: "acme.co.za" } });
    fireEvent.click(screen.getByRole("button", { name: /Scan my website/ }));
    await waitFor(() => expect(screen.getByText("We found this business")).toBeInTheDocument());
    expect(scanWebsite).toHaveBeenCalledWith("ws-1", "acme.co.za");
    expect(screen.getByText("Acme Engineering")).toBeInTheDocument();
    expect(await screen.findByText("Acme (Pty) Ltd")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /source/ })).toHaveAttribute("href", "https://acme.co.za/");
    expect(screen.getByRole("button", { name: /Accept/ })).toBeInTheDocument();
  });

  it("surfaces a customer-safe scan error without advancing", async () => {
    scanWebsite.mockRejectedValue(new Error("That address is not a public website"));
    renderPage();
    fireEvent.change(screen.getByLabelText("Your website address"), { target: { value: "localhost" } });
    fireEvent.click(screen.getByRole("button", { name: /Scan my website/ }));
    await waitFor(() => expect(scanWebsite).toHaveBeenCalled());
    expect(screen.queryByText("We found this business")).not.toBeInTheDocument();
  });
});

describe("Business Studio - preview honesty", () => {
  afterEach(() => { cleanup(); fetchPreview.mockReset(); });

  it("a failed preview read never offers 'Buy professional profile'", async () => {
    fetchPreview.mockRejectedValue(new Error("boom"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /6\. Preview & download/ }));
    expect(await screen.findByText(/Couldn't load your preview/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buy professional profile/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See subscriptions" })).not.toBeInTheDocument();
  });

  it("while the preview loads, no purchase option is shown", () => {
    fetchPreview.mockReturnValue(new Promise(() => {}));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /6\. Preview & download/ }));
    expect(screen.getByRole("status", { name: "Loading preview" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See subscriptions" })).not.toBeInTheDocument();
  });
});
