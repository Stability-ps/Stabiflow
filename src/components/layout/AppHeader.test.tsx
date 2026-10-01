// Finding 2: the phone header Back button must behave like a native back -
// pop in-app history when there is some, otherwise replace to the parent
// page. It must never push a new entry (that made system Back return to the
// page the user had just left).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { AppHeader } from "./AppHeader";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentWorkspaceId: "ws-1", user: { id: "u1" }, currentMembership: { workspace: { name: "Acme" } }, profile: null, signOut: vi.fn() }),
}));
vi.mock("@/hooks/useAutomations", () => ({ useNotifications: () => ({ data: [], refetch: vi.fn() }) }));
vi.mock("@/hooks/useWorkspaceSwitch", () => ({
  useWorkspaceSwitch: () => ({ memberships: [], currentWorkspaceId: "ws-1", currentMembership: null, switchTo: vi.fn() }),
}));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));

function Probe() {
  const l = useLocation();
  const type = useNavigationType();
  return <output data-testid="probe">{`${type} ${l.pathname}`}</output>;
}

function renderAt(entries: string[]) {
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <AppHeader />
      <Routes>
        <Route path="*" element={<Link to="/app/business">to my business</Link>} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  );
}

const back = () => fireEvent.click(screen.getByRole("button", { name: "Back" }));

describe("AppHeader phone Back button", () => {
  afterEach(cleanup);

  it("pops in-app history (no new entry) after normal navigation", () => {
    renderAt(["/app/leads"]);
    fireEvent.click(screen.getByRole("link", { name: "to my business" }));
    expect(screen.getByTestId("probe")).toHaveTextContent("PUSH /app/business");
    back();
    // POP back to where the user actually came from - not a PUSH to the parent.
    expect(screen.getByTestId("probe")).toHaveTextContent("POP /app/leads");
  });

  it("pops to the Business hub when that is where the user came from", () => {
    renderAt(["/app/business-hub", "/app/business"]);
    back();
    expect(screen.getByTestId("probe")).toHaveTextContent("POP /app/business-hub");
  });

  it("falls back to the parent with REPLACE on a direct entry / deep link", () => {
    renderAt(["/app/business"]);
    back();
    expect(screen.getByTestId("probe")).toHaveTextContent("REPLACE /app/business-hub");
  });

  it("uses the route's own parent for detail pages on a deep link", () => {
    renderAt(["/app/campaigns/abc"]);
    back();
    expect(screen.getByTestId("probe")).toHaveTextContent("REPLACE /app/campaigns");
  });

  it("shows no Back button on top-level pages", () => {
    renderAt(["/app/leads"]);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });
});
