import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CampaignBuilder } from "./CampaignBuilder";

const mocks = vi.hoisted(() => ({
  mediaState: { data: [] as Array<Record<string, unknown>>, isLoading: false, isError: false },
  existingCampaign: null as Record<string, unknown> | null,
  workspaceTimezone: "Africa/Johannesburg",
  createCampaignDraft: vi.fn(),
  updateCampaignDraft: vi.fn(),
  publishCampaign: vi.fn(),
  checkCampaignReadiness: vi.fn(),
  syncCampaignReviewStatus: vi.fn(),
}));

const mockAssets = [
  {
    id: "asset-1", title: "hero-shot.jpg", storage_path: "workspace-1/hero-shot.jpg", mime_type: "image/jpeg",
    width_px: 1200, height_px: 900, file_size_bytes: 245000, content_platform_variants: [],
  },
  {
    id: "asset-2", title: "square-shot.png", storage_path: "workspace-1/square-shot.png", mime_type: "image/png",
    width_px: 1080, height_px: 1080, file_size_bytes: 180000, content_platform_variants: [],
  },
];

const mockAdAccount = { id: "acct-1", name: "StabiFlow Insights", ad_account_id: "act_123", currency: "ZAR" };

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "workspace-1" }) }));
vi.mock("@/hooks/useMetaAccountResources", () => ({
  useMetaAdAccounts: () => ({ data: [mockAdAccount], isLoading: false }),
  useMetaFacebookPages: () => ({ data: [] }),
  useMetaInstagramAccounts: () => ({ data: [] }),
  useMetaIntegration: () => ({ data: { id: "integration-1", status: "connected" } }),
}));
vi.mock("@/hooks/useIntegrations", () => ({ useAllWhatsAppNumbers: () => ({ data: [] }) }));
vi.mock("@/hooks/useContentMediaAssets", () => ({ useContentMediaAssets: () => mocks.mediaState }));
vi.mock("@/hooks/useAdCampaign", () => ({ useAdCampaign: () => ({ data: mocks.existingCampaign, isLoading: false }) }));
vi.mock("@/hooks/useWorkspaceTimezone", () => ({ useWorkspaceTimezone: () => mocks.workspaceTimezone }));
vi.mock("@/components/content/MediaPreview", () => ({
  MediaPreview: ({ storagePath, alt, className }: { storagePath: string; alt: string; className?: string }) => (
    <img src={`https://example.com/${storagePath}`} alt={alt} className={className} />
  ),
}));
vi.mock("@/lib/contentMediaAssets", () => ({
  getContentAssetPreviewUrl: vi.fn(async (path: string) => `https://example.com/${path}`),
}));
vi.mock("@/lib/adCampaigns", () => ({
  createCampaignDraft: mocks.createCampaignDraft,
  updateCampaignDraft: mocks.updateCampaignDraft,
  publishCampaign: mocks.publishCampaign,
  checkCampaignReadiness: mocks.checkCampaignReadiness,
  syncCampaignReviewStatus: mocks.syncCampaignReviewStatus,
  newPublishIdempotencyKey: () => "test-idempotency-key",
}));

function renderBuilder() {
  return render(<MemoryRouter><CampaignBuilder /></MemoryRouter>);
}

function chooseSelect(triggerName: RegExp, optionName: RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

function completeThroughCreative() {
  fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Launch Q4" } });
  fireEvent.click(screen.getByRole("button", { name: /^Traffic / }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  chooseSelect(/Meta Ad Account/i, /StabiFlow Insights/i);
  chooseSelect(/^Destination$/i, /^Website$/i);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("option", { name: "Select hero-shot.jpg" }));
  fireEvent.change(screen.getByLabelText("Primary text"), { target: { value: "Book a demo today" } });
  fireEvent.change(screen.getByLabelText(/Headline/i), { target: { value: "Smarter revenue ops" } });
  fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "See your pipeline from ad to deal" } });
  chooseSelect(/Call to action/i, /Shop Now/i);
  fireEvent.change(screen.getByPlaceholderText("https://"), { target: { value: "https://stabiflow.com/demo" } });
}

describe("CampaignBuilder regression coverage", () => {
  beforeEach(() => {
    mocks.mediaState.data = mockAssets;
    mocks.workspaceTimezone = "Africa/Johannesburg";
    mocks.existingCampaign = null;
    mocks.mediaState.isLoading = false;
    mocks.mediaState.isError = false;
    mocks.createCampaignDraft.mockReset().mockResolvedValue({ campaignId: "campaign-1", creativeId: "creative-1" });
    mocks.updateCampaignDraft.mockReset().mockResolvedValue(undefined);
    mocks.publishCampaign.mockReset();
    mocks.checkCampaignReadiness.mockReset().mockResolvedValue({ ok: true, ready: true, issues: [] });
    mocks.syncCampaignReviewStatus.mockReset().mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("blocks forward navigation and shows field-level errors for the current step", () => {
    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "6. Review" }));
    expect(screen.getByRole("heading", { name: /goal of this campaign/i })).toBeInTheDocument();
    expect(screen.getByText("Campaign name is required.")).toBeInTheDocument();
    expect(screen.getByText("Choose the campaign objective.")).toBeInTheDocument();
  });

  it("renders workspace media, supports select, change, and remove", () => {
    renderBuilder();
    completeThroughCreative();
    expect(screen.getByText("hero-shot.jpg")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change media" }));
    fireEvent.click(screen.getByRole("option", { name: "Select square-shot.png" }));
    expect(screen.getByText("square-shot.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Media is required.")).toBeInTheDocument();
  });

  it("shows a useful empty Media Library state", () => {
    mocks.mediaState.data = [];
    renderBuilder();
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Launch Q4" } });
    fireEvent.click(screen.getByRole("button", { name: /^Traffic / }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    chooseSelect(/Meta Ad Account/i, /StabiFlow Insights/i);
    chooseSelect(/^Destination$/i, /^Website$/i);
    fireEvent.click(screen.getByRole("button", { name: "5. Creative" }));
    expect(screen.getByText(/No media in this workspace yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Media Library" })).toBeInTheDocument();
  });

  it("preserves creative state across Review and Back and renders the full review", () => {
    renderBuilder();
    completeThroughCreative();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Launch Q4")).toBeInTheDocument();
    expect(screen.getByText("hero-shot.jpg")).toBeInTheDocument();
    expect(screen.getByText(/Book a demo today/)).toBeInTheDocument();
    expect(screen.getByText(/Smarter revenue ops/)).toBeInTheDocument();
    expect(screen.getByText(/See your pipeline from ad to deal/)).toBeInTheDocument();
    expect(screen.getByText(/CTA:/).parentElement).toHaveTextContent("Shop Now");
    expect(screen.getByText("Nothing is sent to Meta until you explicitly publish.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Primary text")).toHaveValue("Book a demo today");
    expect(screen.getByLabelText(/Headline/i)).toHaveValue("Smarter revenue ops");
    expect(screen.getByRole("combobox", { name: /Call to action/i })).toHaveTextContent("Shop Now");
  });

  it("exposes only the CTA options supported by the selected objective", () => {
    renderBuilder();
    completeThroughCreative();
    fireEvent.click(screen.getByRole("combobox", { name: /Call to action/i }));
    expect(screen.getByRole("option", { name: "Learn More" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Shop Now" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sign Up" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Send WhatsApp Message" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Donate Now" })).not.toBeInTheDocument();
  });

  it("enables Create Draft for a valid campaign and never invokes the Meta publish path", async () => {
    renderBuilder();
    completeThroughCreative();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const createDraftButton = screen.getByRole("button", { name: "Create Draft" });
    expect(createDraftButton).toBeEnabled();
    fireEvent.click(createDraftButton);
    await waitFor(() => expect(mocks.createCampaignDraft).toHaveBeenCalledTimes(1));
    expect(mocks.publishCampaign).not.toHaveBeenCalled();
  });

  it("uses the shared light design token for Primary Text", () => {
    renderBuilder();
    completeThroughCreative();
    expect(screen.getByLabelText("Primary text")).toHaveClass("bg-background", "text-foreground");
    expect(screen.getByLabelText("Primary text")).not.toHaveClass("bg-white/92");
  });
});

// Production UX bug: Publish-step readiness issues carried no way to jump
// to the field that caused them - this covers making each issue
// actionable without weakening/duplicating server-side readiness.
async function createDraftAndReachPublish() {
  completeThroughCreative();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Create Draft" }));
  await waitFor(() => expect(mocks.createCampaignDraft).toHaveBeenCalledTimes(1));
  await screen.findByRole("heading", { name: "Readiness & publish" });
}

describe("CampaignBuilder Publish readiness actionability", () => {
  beforeEach(() => {
    mocks.mediaState.data = mockAssets;
    mocks.workspaceTimezone = "Africa/Johannesburg";
    mocks.existingCampaign = null;
    mocks.mediaState.isLoading = false;
    mocks.mediaState.isError = false;
    mocks.createCampaignDraft.mockReset().mockResolvedValue({ campaignId: "campaign-1", creativeId: "creative-1" });
    mocks.updateCampaignDraft.mockReset().mockResolvedValue(undefined);
    mocks.publishCampaign.mockReset();
    mocks.checkCampaignReadiness.mockReset();
    mocks.syncCampaignReviewStatus.mockReset().mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("REGRESSION: a stale start-date readiness issue shows a clean message and an Edit action, and Publish stays disabled", async () => {
    mocks.checkCampaignReadiness.mockResolvedValue({
      ok: true,
      ready: false,
      issues: [{ code: "invalid_budget", message: "start date must not be in the past", severity: "error" }],
    });
    renderBuilder();
    await createDraftAndReachPublish();

    expect(await screen.findByText("Start date must not be in the past.")).toBeInTheDocument();
    expect(screen.queryByText("start date must not be in the past")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish to Meta" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit Budget & Schedule" })).toBeInTheDocument();
  });

  it("clicking the Edit action navigates to Budget & Schedule, focuses Start date, and preserves builder state", async () => {
    mocks.checkCampaignReadiness.mockResolvedValue({
      ok: true,
      ready: false,
      issues: [{ code: "invalid_budget", message: "start date must not be in the past", severity: "error" }],
    });
    renderBuilder();
    await createDraftAndReachPublish();

    fireEvent.click(await screen.findByRole("button", { name: "Edit Budget & Schedule" }));

    expect(await screen.findByRole("heading", { name: "Budget and schedule" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "campaign-start-date"));

    // builder state (from earlier steps) was not reset by the navigation
    fireEvent.click(screen.getByRole("button", { name: "1. Goal" }));
    expect(screen.getByLabelText("Campaign name")).toHaveValue("Launch Q4");
  });

  it("multiple readiness issues each link to their own correct step", async () => {
    mocks.checkCampaignReadiness.mockResolvedValue({
      ok: true,
      ready: false,
      issues: [
        { code: "invalid_budget", message: "start date must not be in the past", severity: "error" },
        { code: "missing_cta", message: "a call-to-action is required.", severity: "error" },
      ],
    });
    renderBuilder();
    await createDraftAndReachPublish();

    expect(await screen.findByRole("button", { name: "Edit Budget & Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Creative" })).toBeInTheDocument();
  });

  it("Re-check reruns readiness without navigating away or publishing, and a corrected date clears the issue", async () => {
    mocks.checkCampaignReadiness.mockResolvedValueOnce({
      ok: true,
      ready: false,
      issues: [{ code: "invalid_budget", message: "start date must not be in the past", severity: "error" }],
    });
    renderBuilder();
    await createDraftAndReachPublish();
    expect(await screen.findByText("Start date must not be in the past.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Budget & Schedule" }));
    await screen.findByRole("heading", { name: "Budget and schedule" });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "7. Publish" }));
    await screen.findByRole("heading", { name: "Readiness & publish" });

    mocks.checkCampaignReadiness.mockResolvedValueOnce({ ok: true, ready: true, issues: [] });
    fireEvent.click(screen.getByRole("button", { name: "Re-check" }));

    await waitFor(() => expect(mocks.checkCampaignReadiness).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Ready to publish.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish to Meta" })).toBeEnabled();
    expect(mocks.publishCampaign).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Readiness & publish" })).toBeInTheDocument();
  });

  it("a passing readiness check enables Publish to Meta", async () => {
    mocks.checkCampaignReadiness.mockResolvedValue({ ok: true, ready: true, issues: [] });
    renderBuilder();
    await createDraftAndReachPublish();

    expect(await screen.findByText("Ready to publish.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish to Meta" })).toBeEnabled();
  });
});

describe("CampaignBuilder editor deep-link (?step & ?focus from Campaign Detail readiness links)", () => {
  beforeEach(() => {
    mocks.mediaState.data = mockAssets;
    mocks.workspaceTimezone = "Africa/Johannesburg";
    mocks.existingCampaign = null;
    mocks.createCampaignDraft.mockReset().mockResolvedValue({ campaignId: "campaign-1", creativeId: "creative-1" });
    mocks.checkCampaignReadiness.mockReset().mockResolvedValue({ ok: true, ready: true, issues: [] });
    mocks.syncCampaignReviewStatus.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("opens directly at the Budget & Schedule step and focuses the Start date field", async () => {
    render(
      <MemoryRouter initialEntries={["/app/campaigns/new?step=Budget+%26+Schedule&focus=startAt"]}>
        <CampaignBuilder />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Budget and schedule" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "campaign-start-date"));
  });

  it("opens directly at the Creative step for a creative readiness issue", async () => {
    render(
      <MemoryRouter initialEntries={["/app/campaigns/new?step=Creative"]}>
        <CampaignBuilder />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Creative" })).toBeInTheDocument();
  });

  it("MEDIUM-4: ?focus=endAt does NOT flip a Start-now campaign into scheduled mode (the End inputs are always rendered)", async () => {
    render(
      <MemoryRouter initialEntries={["/app/campaigns/new?step=Budget+%26+Schedule&focus=endAt"]}>
        <CampaignBuilder />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Budget and schedule" });
    // Still "Start now" (the default) - the Start date/time inputs are hidden...
    expect(screen.getByRole("button", { name: /Start now/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
    // ...but the End date input is present and focusable.
    expect(screen.getByLabelText("End date")).toBeInTheDocument();
  });

  it("MEDIUM-4: ?focus=startAt still reveals the scheduled Start inputs", async () => {
    render(
      <MemoryRouter initialEntries={["/app/campaigns/new?step=Budget+%26+Schedule&focus=startAt"]}>
        <CampaignBuilder />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Budget and schedule" });
    expect(screen.getByRole("button", { name: /Schedule for later/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
  });
});

describe("CampaignBuilder edit mode - hydrate an existing campaign and update it (never duplicate)", () => {
  const existingDraft = {
    id: "campaign-9", status: "draft", external_campaign_id: null, name: "Winter Sale",
    objective: "OUTCOME_TRAFFIC", ad_account_id: "acct-1", facebook_page_id: null, instagram_account_id: null,
    destination_type: "website", audience: { age_min: 25, age_max: 45, genders: "all", geo_countries: ["ZA"] },
    budget_type: "daily", daily_budget_minor_units: 25000, lifetime_budget_minor_units: null,
    start_at: "2099-07-01T00:00:00.000Z", end_at: null, draft_creative_id: "creative-9",
    ad_creatives: {
      media_asset_id: "asset-1", headline: "Cosy deals", primary_text: "Warm up your winter",
      description: null, cta: "SHOP_NOW", destination_url: "https://stabiflow.com/winter", whatsapp_number_id: null,
    },
  };

  beforeEach(() => {
    mocks.mediaState.data = mockAssets;
    mocks.workspaceTimezone = "Africa/Johannesburg";
    mocks.existingCampaign = { ...existingDraft };
    mocks.createCampaignDraft.mockReset().mockResolvedValue({ campaignId: "campaign-9", creativeId: "creative-9" });
    mocks.updateCampaignDraft.mockReset().mockResolvedValue(undefined);
    mocks.checkCampaignReadiness.mockReset().mockResolvedValue({ ok: true, ready: true, issues: [] });
    mocks.syncCampaignReviewStatus.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  function renderEditor() {
    return render(<MemoryRouter initialEntries={["/app/campaigns/campaign-9/edit"]}><CampaignBuilder campaignId="campaign-9" /></MemoryRouter>);
  }

  it("hydrates the existing campaign's fields into the builder", async () => {
    renderEditor();
    expect(await screen.findByLabelText("Campaign name")).toHaveValue("Winter Sale");
    fireEvent.click(screen.getByRole("button", { name: "5. Creative" }));
    expect(await screen.findByLabelText("Primary text")).toHaveValue("Warm up your winter");
    expect(screen.getByLabelText(/Headline/i)).toHaveValue("Cosy deals");
  });

  it("saving updates the existing campaign (updateCampaignDraft) and never calls createCampaignDraft", async () => {
    renderEditor();
    await screen.findByDisplayValue("Winter Sale");
    fireEvent.click(screen.getByRole("button", { name: "6. Review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.updateCampaignDraft).toHaveBeenCalledTimes(1));
    expect(mocks.updateCampaignDraft.mock.calls[0][0]).toBe("campaign-9");
    expect(mocks.createCampaignDraft).not.toHaveBeenCalled();
  });

  it("a still-unpublished campaign stored as 'ready' (no Meta id) is still editable here", async () => {
    mocks.existingCampaign = { ...existingDraft, status: "ready" };
    renderEditor();
    expect(await screen.findByLabelText("Campaign name")).toHaveValue("Winter Sale");
  });

  it("MEDIUM-5: a later workspaceTimezone value does not re-hydrate and wipe in-progress edits", async () => {
    mocks.workspaceTimezone = "Africa/Johannesburg";
    const { rerender } = renderEditor();
    const nameInput = await screen.findByLabelText("Campaign name");
    expect(nameInput).toHaveValue("Winter Sale");

    // user renames the campaign...
    fireEvent.change(nameInput, { target: { value: "Winter Sale 2027" } });
    expect(nameInput).toHaveValue("Winter Sale 2027");

    // ...then the timezone query resolves to a different value and the tree re-renders.
    mocks.workspaceTimezone = "America/New_York";
    rerender(<MemoryRouter initialEntries={["/app/campaigns/campaign-9/edit"]}><CampaignBuilder campaignId="campaign-9" /></MemoryRouter>);

    // hydration must NOT have run a second time.
    expect(screen.getByLabelText("Campaign name")).toHaveValue("Winter Sale 2027");
  });
});
