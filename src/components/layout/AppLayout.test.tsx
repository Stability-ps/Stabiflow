import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppLayout } from "./AppLayout";

vi.mock("@/components/layout/AppSidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/layout/AppHeader", () => ({ AppHeader: () => <header /> }));
vi.mock("@/components/layout/WorkspaceStatusBanner", () => ({ WorkspaceStatusBanner: () => null }));
vi.mock("@/components/layout/MobileBottomNav", () => ({ MobileBottomNav: () => <nav aria-label="Primary" /> }));
vi.mock("@/components/layout/PlatformNotice", () => ({ PlatformNotice: () => null }));
vi.mock("@/components/layout/LegalReconsentBanner", () => ({ LegalReconsentBanner: () => null }));
vi.mock("@/hooks/useFeatureFlags", () => ({ useFeatureFlags: () => ({ isEnabled: () => false, isLoading: false, hasAdvancedModules: false }) }));

describe("safe-area / bottom-nav layout", () => {
  it("reserves room for the bottom navigation (and the home indicator) below page content", () => {
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    const main = screen.getByRole("main");
    expect(main.className).toContain("pb-[calc(var(--bottom-nav-height)+1.5rem)]");
    // Desktop/tablet padding is unchanged.
    expect(main.className).toContain("md:pb-6");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("defines the bottom-nav height from the safe-area inset on phones only", () => {
    const css = readFileSync(resolve(__dirname, "../../index.css"), "utf8");
    expect(css).toMatch(/--bottom-nav-height:\s*0px/);
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*--bottom-nav-height:\s*calc\(var\(--bottom-nav-bar\) \+ env\(safe-area-inset-bottom\)\)/);
  });

  it("the viewport opts into safe-area insets (viewport-fit=cover) and the PWA manifest is linked", () => {
    const html = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    const manifest = JSON.parse(readFileSync(resolve(__dirname, "../../../public/manifest.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({ name: "StabiFlow", short_name: "StabiFlow", display: "standalone", start_url: expect.stringMatching(/^\/app/) });
    for (const icon of manifest.icons) expect(icon.src).toMatch(/^\/brand\/StabiFlow_/);
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);
  });
});
