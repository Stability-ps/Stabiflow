import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MobileBottomNav } from "./MobileBottomNav";
import { NAV_ITEMS } from "@/lib/navigation";

function renderNav(path = "/app") {
  return render(<MemoryRouter initialEntries={[path]}><MobileBottomNav items={NAV_ITEMS} /></MemoryRouter>);
}

describe("MobileBottomNav", () => {
  afterEach(cleanup);

  it("shows the four primary sections directly, with everything else behind More", () => {
    renderNav();
    expect(screen.getByRole("link", { name: /Home/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Business/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Messages/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Marketing/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
    // Not cramped into the bar itself before opening More.
    expect(screen.queryByRole("link", { name: /^Automations/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Analytics/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Settings/ })).not.toBeInTheDocument();
  });

  it("opens a bottom sheet with Automations, Analytics and Settings when More is tapped", () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("link", { name: "Automations" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("closes the More sheet after picking a destination", () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(screen.queryByRole("link", { name: "Automations" })).not.toBeInTheDocument();
  });

  it("marks Business as the current page while on a page nested under it", () => {
    renderNav("/app/customers");
    expect(screen.getByRole("link", { name: /Business/ })).toHaveAttribute("aria-current", "page");
  });
});
