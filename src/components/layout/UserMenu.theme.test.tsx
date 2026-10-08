import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UserMenu } from "./UserMenu";
import { getThemePreference, setThemePreference } from "@/lib/theme";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ profile: { full_name: "Thandi Mokoena" }, user: { email: "t@example.com" }, signOut: vi.fn() }) }));
vi.mock("@/hooks/useAdminAccess", () => ({ useAdminAccess: () => false }));
afterEach(() => { cleanup(); setThemePreference("light"); });

describe("UserMenu theme choice", () => {
  it("offers Light / Dark / Match device and stores the pick", async () => {
    render(<MemoryRouter><UserMenu /></MemoryRouter>);
    fireEvent.keyDown(screen.getByRole("button", { name: "Account menu" }), { key: "Enter" });
    expect(await screen.findByRole("menuitemradio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Match device" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(getThemePreference()).toBe("dark");
  });
});
