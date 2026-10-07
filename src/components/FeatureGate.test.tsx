import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeatureGate } from "@/components/FeatureGate";
import type { FeatureFlagKey } from "@/lib/featureFlags";

const enabled = new Set<FeatureFlagKey>();
vi.mock("@/hooks/useFeatureFlags", () => ({ useFeatureFlags: () => ({ isEnabled: (k: FeatureFlagKey) => enabled.has(k), isLoading: false, hasAdvancedModules: false }) }));

afterEach(() => { cleanup(); enabled.clear(); });

const renderGate = (flag: FeatureFlagKey) => render(<MemoryRouter><FeatureGate flag={flag}><p>module content</p></FeatureGate></MemoryRouter>);

describe("FeatureGate lock screen", () => {
  it.each([
    ["module.leads", "Leads are part of the Business and Growth plans"],
    ["module.content", "Content is part of the Business and Growth plans"],
    ["module.campaigns", "Campaigns are part of the Growth plan"],
    ["module.whatsapp", "Messages are part of the Growth plan"],
    ["module.automations", "Automations are part of the Growth plan"],
  ] as const)("%s says what is locked, which plan includes it and where to upgrade", (flag, title) => {
    renderGate(flag);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(/Upgrade in Billing & plans/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/app/billing");
    expect(screen.queryByText("module content")).not.toBeInTheDocument();
  });

  it("renders the module when its flag is on", () => {
    enabled.add("module.leads");
    renderGate("module.leads");
    expect(screen.getByText("module content")).toBeInTheDocument();
  });
});
