import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CampaignBuilder } from "./CampaignBuilder";

const mocks = vi.hoisted(() => ({
  mediaState: { data: [] as Array<Record<string, unknown>>, isLoading: false, isError: false },
  createCampaignDraft: vi.fn(),
  updateCampaignDraft: vi.fn(),
  publishCampaign: vi.fn(),
  checkCampaignReadiness: vi.fn(),
  markCampaignReadyForReview: vi.fn(),
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
vi.mock("@/hooks/useAdCampaign", () => ({ useAdCampaign: () => ({ data: null, isLoading: false }) }));
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
  markCampaignReadyForReview: mocks.markCampaignReadyForReview,
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
    mocks.mediaState.isLoading = false;
    mocks.mediaState.isError = false;
    mocks.createCampaignDraft.mockReset().mockResolvedValue({ campaignId: "campaign-1", creativeId: "creative-1" });
    mocks.updateCampaignDraft.mockReset().mockResolvedValue(undefined);
    mocks.publishCampaign.mockReset();
    mocks.checkCampaignReadiness.mockReset().mockResolvedValue({ ok: true, ready: true, issues: [] });
    mocks.markCampaignReadyForReview.mockReset().mockResolvedValue(undefined);
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
    mocks.mediaState.isLoading = false;
    mocks.mediaState.isError = false;
    mocks.createCampaignDraft.mockReset().mockResolvedValue({ campaignId: "campaign-1", creativeId: "creative-1" });
    mocks.updateCampaignDraft.mockReset().mockResolvedValue(undefined);
    mocks.publishCampaign.mockReset();
    mocks.checkCampaignReadiness.mockReset();
    mocks.markCampaignReadyForReview.mockReset().mockResolvedValue(undefined);
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
