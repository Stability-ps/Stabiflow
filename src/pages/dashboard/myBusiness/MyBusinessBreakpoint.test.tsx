// Review finding 10: My Business must switch layouts at the SAME breakpoint
// as the app shell (768px). Previously it switched at 1024px, so rotating an
// iPad (e.g. 820 <-> 1180) swapped in a different tree and discarded
// in-progress section drafts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import MyBusiness from "@/pages/dashboard/MyBusiness";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentWorkspaceId: "ws-1", currentMembership: { role: "owner", workspace: { name: "Acme WS" } }, user: { id: "u1" }, profile: null, hasPermission: () => true }),
}));
vi.mock("@/hooks/useFeatureFlags", () => ({ useFeatureFlags: () => ({ isEnabled: () => true, isLoading: false, hasAdvancedModules: true }) }));
vi.mock("@/components/creative-studio/BrandProfileSelector", () => ({ BrandProfileSelector: () => null }));
vi.mock("@/components/business/WebsiteMonitorCard", () => ({ WebsiteMonitorCard: () => null }));
vi.mock("@/lib/businessStudio", async (orig) => ({ ...(await orig<typeof import("@/lib/businessStudio")>()), fetchPendingProposals: () => Promise.resolve([]) }));
vi.mock("@/lib/businessIdentity", async (orig) => ({
  ...(await orig<typeof import("@/lib/businessIdentity")>()),
  fetchBusinessIdentity: () => Promise.resolve({
    identity: {
      id: "bi-1", workspace_id: "ws-1", trading_name: "Acme", legal_name: null, country_code: "ZA", industry: null, website: null, founded_year: null,
      employee_count_range: null, tagline: null, short_description: null, long_description: null, mission: null, vision: null, core_values: [],
      brand_profile_id: null, field_provenance: {},
    },
    contacts: [], locations: [], socialLinks: [], offerings: [], team: [], projects: [], certifications: [], identifiers: [],
  }),
}));

// A controllable viewport: min-width queries re-evaluate on "rotation".
let width = 820;
const listeners = new Set<() => void>();
const originalMatchMedia = window.matchMedia;
beforeEach(() => {
  window.matchMedia = ((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? NaN);
    return {
      get matches() { return Number.isFinite(min) ? width >= min : false; },
      media: query, onchange: null,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  listeners.clear();
  window.matchMedia = originalMatchMedia;
});
const rotate = (w: number) => act(() => { width = w; for (const cb of [...listeners]) cb(); });

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/app/business"]}><MyBusiness /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const isPhoneLayout = () => !!screen.queryByRole("navigation", { name: "Business sections" });

describe("My Business uses the app shell breakpoint (768px)", () => {
  it.each([[767, true], [768, false], [820, false], [1024, false], [1180, false]])("at %ipx the phone layout is %s", async (w, phone) => {
    width = w;
    renderPage();
    await screen.findByLabelText(phone ? "Profile completeness" : "Completeness percentage");
    expect(isPhoneLayout()).toBe(phone);
  });

  it("an in-progress draft entered at tablet width survives rotation (820 -> 1180 -> 820)", async () => {
    width = 820;
    renderPage();
    const team = (await screen.findByText("Team")).closest("div.rounded-2xl") as HTMLElement;
    fireEvent.click(within(team).getByRole("button", { name: /Add/ }));
    const nameInput = screen.getByLabelText(/Full name/);
    fireEvent.change(nameInput, { target: { value: "Thandi Mokoena" } });
    const tradingName = screen.getByLabelText("Trading name");
    fireEvent.change(tradingName, { target: { value: "Acme Plumbing" } });

    rotate(1180);
    rotate(820);

    // Same mounted inputs (not a remounted copy), drafts intact.
    expect(screen.getByLabelText(/Full name/)).toBe(nameInput);
    expect(screen.getByLabelText(/Full name/)).toHaveValue("Thandi Mokoena");
    expect(screen.getByLabelText("Trading name")).toBe(tradingName);
    expect(screen.getByLabelText("Trading name")).toHaveValue("Acme Plumbing");
    // No duplicate form state: exactly one instance of each field.
    expect(document.querySelectorAll("#bi-trading_name")).toHaveLength(1);
    expect(screen.getAllByLabelText(/Full name/)).toHaveLength(1);
  });
});
