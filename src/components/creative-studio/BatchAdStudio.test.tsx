import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BatchAdStudio } from "./BatchAdStudio";
import { DEFAULT_REFERENCE_PREFERENCES, type ContactFieldKey } from "@/lib/creativeStudio";
import type { AdSizeKind } from "@/lib/adRenderer";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/content/MediaPreview", () => ({ MediaPreview: ({ alt }: { alt: string }) => <img alt={alt} /> }));
const reopenFixture = vi.hoisted(() => ({
  batch: null as Record<string, unknown> | null,
  concepts: [] as Record<string, unknown>[],
  creatives: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.update = () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) });
      chain.order = () =>
        Promise.resolve({
          data: table === "creative_studio_concepts" ? reopenFixture.concepts : table === "creative_studio_creatives" ? reopenFixture.creatives : [],
          error: null,
        });
      chain.maybeSingle = () => Promise.resolve({ data: table === "creative_studio_batches" ? reopenFixture.batch : null, error: null });
      return chain;
    },
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  },
}));

const adRendererMock = vi.hoisted(() => ({
  AD_LAYOUTS: ["split", "full_bleed", "bold_statement", "professional_card"],
  AD_LAYOUT_LABELS: { split: "Split", full_bleed: "Full bleed", bold_statement: "Bold statement", professional_card: "Professional card" },
  AD_SIZES: ["1080x1080", "1080x1350", "1080x1920"],
  AD_SIZE_LABELS: { "1080x1080": "Square", "1080x1350": "Portrait", "1080x1920": "Story" },
  blobToBase64: vi.fn().mockResolvedValue("base64data"),
  computeAdLayout: vi.fn().mockReturnValue({ elements: [], overflow: false }),
  loadDrawableImage: vi.fn().mockResolvedValue(null),
  renderAd: vi.fn().mockResolvedValue({ blob: new Blob(), overflow: false }),
  resolveCta: (cta: string, fallback: string | null) => cta || fallback || "Learn more",
}));
vi.mock("@/lib/adRenderer", () => adRendererMock);

const creativeStudioMock = vi.hoisted(() => ({
  generateVisualConcepts: vi.fn(),
  generateBatchVisuals: vi.fn(),
  planBatchRender: vi.fn(),
  storeRenderedCreative: vi.fn(),
}));
vi.mock("@/lib/creativeStudio", async () => {
  const actual = await vi.importActual<typeof import("@/lib/creativeStudio")>("@/lib/creativeStudio");
  return { ...actual, ...creativeStudioMock };
});

function makeConcept(id: string, status: "pending" | "ready" | "failed" = "pending") {
  return {
    id,
    batch_id: "batch-1",
    workspace_id: "ws-1",
    sort_order: 0,
    concept_name: `Concept ${id}`,
    headline: "Headline",
    supporting_text: "Body",
    cta: "Go",
    visual_prompt: "a scene. no text, no logos.",
    layout_style: "split",
    visual_notes: null,
    visual_source: "ai" as const,
    visual_status: status,
    visual_error: status === "failed" ? "failed" : null,
    visual_media_asset_id: null,
    visual_job_id: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}

function makeBrand() {
  return {
    name: "Acme",
    primary: "#111111",
    secondary: null,
    accent: "#222222",
    ctaText: null,
    footerDisclaimer: null,
    defaultCta: "Learn more",
    contactEmail: null,
    contactPhone: null,
    whatsapp: null,
    website: null,
    address: null,
    logoUrl: null,
    contactLine: null,
  };
}

function makeCreative(id: string, conceptId: string, layout: string, size: string, status: "rendering" | "ready" = "rendering") {
  return {
    id,
    batch_id: "batch-1",
    concept_id: conceptId,
    workspace_id: "ws-1",
    layout,
    size,
    width_px: 1080,
    height_px: 1080,
    headline: "Headline",
    body_text: "Body",
    cta: "Go",
    contact_text: null,
    price_text: null,
    disclaimer_text: null,
    status,
    render_error: null,
    overflow_warning: false,
    rendered_media_asset_id: null,
    storage_path: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}

const defaultProps = {
  workspaceId: "ws-1",
  businessContext: "A bakery in Cape Town",
  audience: "",
  tone: "",
  sourceAssetId: null,
  assetPurpose: null,
  referencePreferences: DEFAULT_REFERENCE_PREFERENCES,
  copyVariants: [],
  mediaAssets: [],
  canPromoteToCampaign: false,
  brandProfileId: "profile-1",
  visualDirection: "a bright morning scene",
  userCopy: { headline: "My headline", body: "My body", cta: "My CTA" },
  contactFields: ["phone", "whatsapp"] as ContactFieldKey[],
  conceptCount: 6,
  formats: ["1080x1080", "1080x1350", "1080x1920"] as AdSizeKind[],
  reopenBatchId: null as string | null,
};

function renderStudio(overrides: Partial<typeof defaultProps> = {}) {
  return render(
    <MemoryRouter>
      <BatchAdStudio {...defaultProps} {...overrides} />
    </MemoryRouter>,
  );
}

describe("BatchAdStudio - one-click orchestration", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("passes brand profile, visual direction, user copy and contact fields through to concept generation", async () => {
    creativeStudioMock.generateVisualConcepts.mockRejectedValue(new Error("stop"));
    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /generate ads/i }));
    await waitFor(() => expect(creativeStudioMock.generateVisualConcepts).toHaveBeenCalledTimes(1));
    expect(creativeStudioMock.generateVisualConcepts).toHaveBeenCalledWith(
      expect.objectContaining({
        brandProfileId: "profile-1",
        visualDirection: "a bright morning scene",
        userCopy: { headline: "My headline", body: "My body", cta: "My CTA" },
        contactFields: ["phone", "whatsapp"],
        conceptCount: 6,
      }),
    );
  });

  it("6 concepts x 3 formats renders 18 ads from exactly ONE concepts call and ONE visuals call (not 18 image-generation calls)", async () => {
    const concepts = Array.from({ length: 6 }, (_, i) => makeConcept(`c${i}`, "ready"));
    creativeStudioMock.generateVisualConcepts.mockResolvedValue({ ok: true, batch: { id: "batch-1" }, concepts });
    creativeStudioMock.generateBatchVisuals.mockResolvedValue({
      ok: true,
      batch: { id: "batch-1", status: "ready" },
      concepts: concepts.map((c) => ({ id: c.id, visual_status: "ready", visual_error: null })),
      summary: { ready: 6, failed: 0, total: 6 },
    });
    const creatives = concepts.flatMap((c) => ["1080x1080", "1080x1350", "1080x1920"].map((size) => makeCreative(`${c.id}-${size}`, c.id, "professional_card", size)));
    creativeStudioMock.planBatchRender.mockResolvedValue({ ok: true, creatives, brand: makeBrand(), conceptVisualUrls: {} });
    creativeStudioMock.storeRenderedCreative.mockImplementation((input: { creativeId: string }) =>
      Promise.resolve({ ok: true, creative: { ...creatives.find((c) => c.id === input.creativeId), status: "ready" }, batch: { id: "batch-1", status: "ready" } }),
    );

    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /generate ads/i }));

    await waitFor(() => expect(creativeStudioMock.storeRenderedCreative).toHaveBeenCalledTimes(18));
    // Exactly one concept-generation call and one visuals-batch call
    // regardless of how many concepts/formats were requested - the AI
    // call economy invariant (instruction #14).
    expect(creativeStudioMock.generateVisualConcepts).toHaveBeenCalledTimes(1);
    expect(creativeStudioMock.generateBatchVisuals).toHaveBeenCalledTimes(1);
    expect(creativeStudioMock.planBatchRender).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Your ads (18)")).toBeInTheDocument();
  });

  it("a partial visual failure still renders the successful concepts (does not discard the whole batch)", async () => {
    const concepts = [makeConcept("c0", "pending"), makeConcept("c1", "pending")];
    creativeStudioMock.generateVisualConcepts.mockResolvedValue({ ok: true, batch: { id: "batch-1" }, concepts });
    creativeStudioMock.generateBatchVisuals.mockResolvedValue({
      ok: true,
      batch: { id: "batch-1", status: "partial" },
      concepts: [
        { id: "c0", visual_status: "ready", visual_error: null },
        { id: "c1", visual_status: "failed", visual_error: "image provider error" },
      ],
      summary: { ready: 1, failed: 1, total: 2 },
    });
    const creatives = [makeCreative("cr0", "c0", "professional_card", "1080x1080")];
    creativeStudioMock.planBatchRender.mockResolvedValue({ ok: true, creatives, brand: makeBrand(), conceptVisualUrls: {} });
    creativeStudioMock.storeRenderedCreative.mockResolvedValue({ ok: true, creative: { ...creatives[0], status: "ready" }, batch: { id: "batch-1", status: "partial" } });

    renderStudio({ conceptCount: 2, formats: ["1080x1080"] });
    fireEvent.click(screen.getByRole("button", { name: /generate ads/i }));

    await waitFor(() => expect(creativeStudioMock.planBatchRender).toHaveBeenCalledTimes(1));
    // Only the READY concept is sent to the render plan - the failed one
    // is excluded, not silently retried or blocking the batch.
    expect(creativeStudioMock.planBatchRender).toHaveBeenCalledWith(expect.objectContaining({ conceptIds: ["c0"] }));
    await waitFor(() => expect(screen.getByText("Your ads (1)")).toBeInTheDocument());
    // A retry affordance for the failed visual is surfaced.
    expect(await screen.findByRole("button", { name: /retry failed visual/i })).toBeInTheDocument();
  });
});

describe("BatchAdStudio - reopening a saved batch/project (instruction #22)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("restores concepts and creatives from a previously saved batch without generating anything new", async () => {
    const concept = makeConcept("c0", "ready");
    const creative = makeCreative("cr0", "c0", "professional_card", "1080x1080", "ready");
    reopenFixture.batch = { id: "batch-old", layouts: ["professional_card"], sizes: ["1080x1080"] };
    reopenFixture.concepts = [concept];
    reopenFixture.creatives = [creative];
    creativeStudioMock.planBatchRender.mockResolvedValue({ ok: true, creatives: [creative], brand: makeBrand(), conceptVisualUrls: {} });

    renderStudio({ reopenBatchId: "batch-old" });

    await waitFor(() => expect(screen.getByText("Your ads (1)")).toBeInTheDocument());
    // Reopening re-plans (idempotent, for fresh signed URLs) but never
    // triggers a new concept/visual generation call.
    expect(creativeStudioMock.generateVisualConcepts).not.toHaveBeenCalled();
    expect(creativeStudioMock.generateBatchVisuals).not.toHaveBeenCalled();
    expect(creativeStudioMock.storeRenderedCreative).not.toHaveBeenCalled();
  });
});
