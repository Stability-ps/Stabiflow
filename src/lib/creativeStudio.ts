import { supabase } from "@/integrations/supabase/client";

export type CreativeVariant = {
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
};

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  // Mirrors the same message/error-code preference used across
  // adCampaigns.ts/contentFunctions.ts/inbox.ts - workspaceSuspendedBody
  // and similar structured error bodies put the human text in `message`.
  if (error) {
    const parsed = data as { error?: string; message?: string } | null;
    const message = parsed?.message || parsed?.error || error.message || `${name} failed`;
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    const typed = data as { error: string; message?: string };
    throw new Error(typed.message || typed.error);
  }
  return data as T;
}

export function generateCreativeCopy(input: {
  workspaceId: string;
  businessContext: string;
  audience?: string;
  tone?: string;
  variantCount: number;
}) {
  return invoke<{ ok: true; variants: CreativeVariant[] }>("creative-studio-generate", {
    workspace_id: input.workspaceId,
    business_context: input.businessContext,
    audience: input.audience || undefined,
    tone: input.tone || undefined,
    variant_count: input.variantCount,
  });
}

// --------------------------------------------------------------------------
// Batch image ads - stages 2 (concepts) / 3 (visuals) / 6 (render).
// Each maps 1:1 to an edge function; the client never talks to an AI
// provider directly. Row shapes are the DB rows, kept loose here (the
// generated Supabase types are the strict source when querying directly).
// --------------------------------------------------------------------------

export type CreativeBatchStatus = "draft" | "generating" | "ready" | "partial" | "failed";
export type CreativeVisualStatus = "pending" | "generating" | "ready" | "failed";
export type CreativeAdStatus = "rendering" | "ready" | "approved" | "rejected" | "failed";

export type CreativeStudioBatch = {
  id: string;
  workspace_id: string;
  status: CreativeBatchStatus;
  business_context: string;
  audience: string | null;
  tone: string | null;
  source_media_asset_id: string | null;
  layouts: string[];
  sizes: string[];
  error_detail: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreativeStudioConcept = {
  id: string;
  batch_id: string;
  workspace_id: string;
  sort_order: number;
  concept_name: string;
  headline: string;
  supporting_text: string;
  cta: string;
  visual_prompt: string;
  layout_style: string | null;
  visual_notes: string | null;
  visual_source: "ai" | "media_library";
  visual_status: CreativeVisualStatus;
  visual_error: string | null;
  visual_media_asset_id: string | null;
  visual_job_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CreativeStudioAd = {
  id: string;
  batch_id: string;
  concept_id: string;
  workspace_id: string;
  layout: string;
  size: string;
  width_px: number;
  height_px: number;
  headline: string;
  body_text: string;
  cta: string;
  contact_text: string | null;
  price_text: string | null;
  disclaimer_text: string | null;
  status: CreativeAdStatus;
  render_error: string | null;
  overflow_warning: boolean;
  rendered_media_asset_id: string | null;
  storage_path: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreativeBrandKit = {
  name: string;
  primary: string | null;
  accent: string | null;
  ctaText: string | null;
  footerDisclaimer: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  logoUrl: string | null;
};

export function generateVisualConcepts(input: {
  workspaceId: string;
  businessContext: string;
  audience?: string;
  tone?: string;
  sourceMediaAssetId?: string | null;
  conceptCount: number;
  copyVariants?: CreativeVariant[];
}) {
  return invoke<{ ok: true; batch: CreativeStudioBatch; concepts: CreativeStudioConcept[] }>("creative-studio-concepts", {
    workspace_id: input.workspaceId,
    business_context: input.businessContext,
    audience: input.audience || undefined,
    tone: input.tone || undefined,
    source_media_asset_id: input.sourceMediaAssetId || undefined,
    concept_count: input.conceptCount,
    copy_variants: input.copyVariants && input.copyVariants.length > 0 ? input.copyVariants : undefined,
  });
}

export function generateBatchVisuals(input: {
  workspaceId: string;
  batchId: string;
  conceptIds?: string[];
  retry?: boolean;
}) {
  return invoke<{
    ok: true;
    batch: { id: string; status: CreativeBatchStatus };
    concepts: { id: string; visual_status: CreativeVisualStatus; visual_error: string | null }[];
    summary: { ready: number; failed: number; total: number };
  }>("creative-studio-visuals", {
    workspace_id: input.workspaceId,
    batch_id: input.batchId,
    concept_ids: input.conceptIds && input.conceptIds.length > 0 ? input.conceptIds : undefined,
    retry: input.retry === true ? true : undefined,
  });
}

export function planBatchRender(input: {
  workspaceId: string;
  batchId: string;
  layouts: string[];
  sizes: string[];
  conceptIds?: string[];
}) {
  return invoke<{
    ok: true;
    creatives: CreativeStudioAd[];
    brand: CreativeBrandKit;
    conceptVisualUrls: Record<string, string | null>;
  }>("creative-studio-render", {
    workspace_id: input.workspaceId,
    action: "plan",
    batch_id: input.batchId,
    layouts: input.layouts,
    sizes: input.sizes,
    concept_ids: input.conceptIds && input.conceptIds.length > 0 ? input.conceptIds : undefined,
  });
}

export function storeRenderedCreative(input: {
  workspaceId: string;
  creativeId: string;
  pngBase64: string;
  overflowWarning: boolean;
  copy?: {
    headline?: string;
    body_text?: string;
    cta?: string;
    contact_text?: string | null;
    price_text?: string | null;
    disclaimer_text?: string | null;
  };
}) {
  return invoke<{ ok: true; creative: CreativeStudioAd; batch: { id: string; status: CreativeBatchStatus } }>("creative-studio-render", {
    workspace_id: input.workspaceId,
    action: "store",
    creative_id: input.creativeId,
    png_base64: input.pngBase64,
    overflow_warning: input.overflowWarning,
    copy: input.copy,
  });
}
