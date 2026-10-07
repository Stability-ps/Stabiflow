import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Home from "./Home";

const flags = vi.hoisted(() => ({ isLoading: false, hasAdvancedModules: false }));

vi.mock("@/hooks/useFeatureFlags", () => ({ useFeatureFlags: () => ({ ...flags, isEnabled: () => false, isPlanLocked: () => false }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "w1", currentMembership: { workspace: { name: "Ubuntu Bakery" } } }) }));
vi.mock("@/lib/businessIdentity", async (orig) => ({
  ...(await orig<typeof import("@/lib/businessIdentity")>()),
  fetchBusinessIdentity: vi.fn().mockResolvedValue({
    identity: { trading_name: "Ubuntu Bakery", core_values: [] }, contacts: [], locations: [], socialLinks: [], offerings: [], team: [], projects: [], certifications: [], identifiers: [], sectionPreferences: [],
  }),
}));
vi.mock("./Overview", () => ({ default: () => <div>FULL HOME</div> }));

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><Home /></MemoryRouter></QueryClientProvider>);
}

describe("Home", () => {
  afterEach(() => { cleanup(); flags.isLoading = false; flags.hasAdvancedModules = false; });

  it("shows a layout-shaped skeleton (not a spinner) while module flags load", () => {
    flags.isLoading = true;
    renderHome();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("launch workspaces get the focused business home with profile progress and plans", async () => {
    renderHome();
    expect(screen.getByRole("heading", { level: 1, name: "Welcome to StabiFlow" })).toBeInTheDocument();
    expect(await screen.findByRole("progressbar", { name: "Business profile completeness" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review my business/ })).toHaveAttribute("href", "/app/business");
    expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/app/billing");
  });

  it("workspaces with advanced modules get the full command centre", () => {
    flags.hasAdvancedModules = true;
    renderHome();
    expect(screen.getByText("FULL HOME")).toBeInTheDocument();
  });
});
