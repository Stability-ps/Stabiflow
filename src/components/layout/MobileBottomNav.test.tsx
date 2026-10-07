import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NAV_ITEMS } from "@/lib/navigation";
import { MobileBottomNav } from "./MobileBottomNav";

vi.mock("@/hooks/useWorkspaceSwitch", () => ({
  useWorkspaceSwitch: () => ({ memberships: [], currentWorkspaceId: "w", currentMembership: null, switchTo: vi.fn() }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock("@/hooks/usePwaInstall", () => ({ usePwaInstall: () => ({ canInstall: false }) }));

const label = (l: string) => NAV_ITEMS.find((i) => i.label === l)!;

describe("MobileBottomNav", () => {
  afterEach(cleanup);

  it("keeps the phone information architecture: Home, Business, Messages, Leads, More", () => {
    render(<MemoryRouter initialEntries={["/app/whatsapp/inbox"]}><MobileBottomNav items={NAV_ITEMS} /></MemoryRouter>);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Home", "Business", "Messages", "Leads"]);
    expect(within(nav).getByRole("link", { name: "Messages" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "More destinations" })).toBeInTheDocument();
  });

  it("lists plan-locked modules in More with a lock explanation, never as primary tabs", () => {
    const visible = NAV_ITEMS.filter((i) => i.label !== "Flow AI");
    render(<MemoryRouter initialEntries={["/app"]}><MobileBottomNav items={visible} lockedItems={[label("Flow AI")]} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "More destinations" }));
    const locked = screen.getByRole("link", { name: /Flow AI \(locked\)/ });
    expect(locked).toHaveAttribute("href", "/app/flow-ai");
    expect(locked).toHaveAccessibleName("Flow AI (locked). Included in the Growth plan. View upgrade options");
  });
});
