// Campaign Detail UX regression suite (Campaigns production UX work).
// Proves: the page mounts for a valid id; lifecycle/readiness badge is
// derived from ACTUAL readiness (never a stale stored "ready");
// unpublished campaigns get Edit / Duplicate / Delete-draft actions while
// published ones do not; readiness issues carry a correction deep-link
// into the editor; Duplicate/Delete never touch Meta.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CampaignDetail } from "./CampaignDetail";

const { navigateMock, mocks } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  mocks: {
    campaign: null as Record<string, unknown> | null,
    checkCampaignReadiness: vi.fn(),
    syncCampaignReviewStatus: vi.fn(),
    duplicateCampaignDraft: vi.fn(),
    deleteCampaignDraft: vi.fn(),
    publishCampaign: vi.fn(),
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "workspace-1", hasPermission: () => true }) }));
vi.mock("@/hooks/useWorkspaceCurrency", () => ({ useWorkspaceCurrency: () => "ZAR" }));
vi.mock("@/hooks/useWorkspaceTimezone", () => ({ useWorkspaceTimezone: () => "Africa/Johannesburg" }));
vi.mock("@/hooks/useIntegrations", () => ({ useAllWhatsAppNumbers: () => ({ data: [] }) }));
vi.mock("@/hooks/useAdCampaignMetrics", () => ({ useAdCampaignMetrics: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/useAnalytics", () => ({ useSingleCampaignPerformance: () => ({ data: null }) }));
vi.mock("@/hooks/useAdCampaign", () => ({
  useAdCampaign: () => ({ data: mocks.campaign, isLoading: false }),
  useCampaignActivity: () => ({ data: [] }),
}));
vi.mock("@/components/content/MediaPreview", () => ({
  MediaPreview: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock("@/lib/adCampaigns", async () => {
  const actual = await vi.importActual<typeof import("@/lib/adCampaigns")>("@/lib/adCampaigns");
  return {
    ...actual,
    checkCampaignReadiness: mocks.checkCampaignReadiness,
    syncCampaignReviewStatus: mocks.syncCampaignReviewStatus,
    duplicateCampaignDraft: mocks.duplicateCampaignDraft,
    deleteCampaignDraft: mocks.deleteCampaignDraft,
    publishCampaign: mocks.publishCampaign,
    pauseCampaign: vi.fn(),
    resumeCampaign: vi.fn(),
    refreshCampaignMetrics: vi.fn(),
    newPublishIdempotencyKey: () => "k",
  };
});

const CREATIVE = {
  primary_text: "Dive into summer", headline: "Big Splash", description: "Poolside deals", cta: "SHOP_NOW",
  destination_url: "https://stabiflow.com/splash", whatsapp_number_id: null, media_asset_id: "asset-1",
  content_media_assets: { storage_path: "workspace-1/splash.jpg", title: "splash.jpg" },
};

function makeCampaign(over: Record<string, unknown> = {}) {
  return {
    id: "campaign-1", name: "Splash", objective: "OUTCOME_TRAFFIC", status: "draft", external_campaign_id: null,
    budget_type: "daily", daily_budget_minor_units: 10000, lifetime_budget_minor_units: null,
    currency: "ZAR", start_at: "2099-06-01T00:00:00.000Z", end_at: null, ad_account_id: "acct-1",
    audience: { age_min: 18, age_max: 65, genders: "all", geo_countries: ["ZA"] },
    destination_type: "website", last_readiness_check: null,
    created_at: "2026-05-01T09:00:00.000Z", updated_at: "2026-05-02T09:00:00.000Z", last_publish_error: null,
    workspace_meta_ad_accounts: { name: "StabiFlow Insights", ad_account_id: "act_123" },
    workspace_facebook_pages: { page_name: "Splash FB" }, workspace_instagram_accounts: { username: "splash" },
    ad_creatives: CREATIVE,
    ...over,
  };
}

function renderDetail() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><CampaignDetail campaignId="campaign-1" /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  mocks.checkCampaignReadiness.mockReset().mockResolvedValue({ ok: true, ready: true, issues: [] });
  mocks.syncCampaignReviewStatus.mockReset().mockResolvedValue(undefined);
  mocks.duplicateCampaignDraft.mockReset().mockResolvedValue({ campaignId: "campaign-2" });
  mocks.deleteCampaignDraft.mockReset().mockResolvedValue(undefined);
  mocks.publishCampaign.mockReset().mockResolvedValue({ ok: true });
  mocks.campaign = makeCampaign();
});
afterEach(cleanup);

describe("CampaignDetail - mounts and renders", () => {
  it("mounts for a valid campaign id and shows the name", () => {
    renderDetail();
    expect(screen.getByRole("heading", { name: "Splash" })).toBeInTheDocument();
  });

  it("Creative tab renders the media preview and every copy field", async () => {
    renderDetail();
    // Radix Tabs activate on mousedown/focus, not a bare click, in jsdom.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Creative" }), { button: 0 });
    expect(await screen.findByRole("img", { name: "splash.jpg" })).toBeInTheDocument();
    expect(screen.getByText("Big Splash")).toBeInTheDocument();
    expect(screen.getByText(/Dive into summer/)).toBeInTheDocument();
    expect(screen.getByText(/Poolside deals/)).toBeInTheDocument();
    expect(screen.getByText("SHOP_NOW")).toBeInTheDocument();
    expect(screen.getByText("https://stabiflow.com/splash")).toBeInTheDocument();
  });
});

describe("CampaignDetail - lifecycle/readiness badge is derived, never a stale stored status", () => {
  it("passing readiness -> 'Ready to publish'", async () => {
    mocks.checkCampaignReadiness.mockResolvedValue({ ok: true, ready: true, issues: [] });
    renderDetail();
    expect(await screen.findAllByText("Ready to publish")).not.toHaveLength(0);
  });

  it("failing readiness -> 'Needs attention' even though the stored status is 'ready'", async () => {
    mocks.campaign = makeCampaign({ status: "ready" });
    mocks.checkCampaignReadiness.mockResolvedValue({
      ok: true, ready: false,
      issues: [{ code: "invalid_budget", message: "start date must not be in the past", severity: "error" }],
    });
    renderDetail();
    expect(await screen.findAllByText("Needs attention")).not.toHaveLength(0);
    expect(screen.queryByText("Ready to publish")).not.toBeInTheDocument();
  });

  it("a stale start-date readiness issue shows an 'Edit schedule' correction that deep-links into the editor at Budget & Schedule / startAt", async () => {
    mocks.checkCampaignReadiness.mockResolvedValue({
      ok: true, ready: false,
      issues: [{ code: "invalid_budget", message: "start date must not be in the past", severity: "error" }],
    });
    renderDetail();
    const link = await screen.findByRole("link", { name: "Edit schedule" });
    expect(link).toHaveAttribute("href", "/app/campaigns/campaign-1/edit?step=Budget+%26+Schedule&focus=startAt");
  });
});

describe("CampaignDetail - schedule UX", () => {
  it("flags a start date that has already passed and offers Edit schedule", () => {
    mocks.campaign = makeCampaign({ start_at: "2020-01-01T00:00:00.000Z" });
    renderDetail();
    expect(screen.getByText("Start date has passed")).toBeInTheDocument();
  });

  it("does not flag a future start date", () => {
    renderDetail(); // start_at 2099
    expect(screen.queryByText("Start date has passed")).not.toBeInTheDocument();
  });
});

describe("CampaignDetail - actions are lifecycle-appropriate", () => {
  it("an unpublished draft exposes Edit campaign, and it routes to the canonical editor", () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: /Edit campaign/i }));
    expect(navigateMock).toHaveBeenCalledWith("/app/campaigns/campaign-1/edit");
  });

  it("a published (active, has Meta id) campaign does NOT expose Edit campaign or Delete draft", () => {
    mocks.campaign = makeCampaign({ status: "active", external_campaign_id: "23848xxxx" });
    renderDetail();
    expect(screen.queryByRole("button", { name: /Edit campaign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete draft/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Duplicate campaign/i })).toBeInTheDocument(); // duplicate is always allowed
  });

  it("Delete draft requires an explicit, name-identified confirmation and calls the draft-only delete (never a Meta delete/publish)", async () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: /Delete draft/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: /Delete draft .*Splash/ })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete draft" }));
    await waitFor(() => expect(mocks.deleteCampaignDraft).toHaveBeenCalledWith("campaign-1"));
    expect(mocks.publishCampaign).not.toHaveBeenCalled();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/app/campaigns"));
  });

  it("Duplicate creates a new local draft and routes to it, without publishing", async () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: /Duplicate campaign/i }));
    await waitFor(() => expect(mocks.duplicateCampaignDraft).toHaveBeenCalledWith("campaign-1"));
    expect(mocks.publishCampaign).not.toHaveBeenCalled();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/app/campaigns/campaign-2/edit"));
  });
});
