import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Check, Download, Image as ImageIcon, Loader2, Megaphone, RefreshCw, Sparkles, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MediaPreview } from "@/components/content/MediaPreview";
import { supabase } from "@/integrations/supabase/client";
import { getContentAssetPreviewUrl } from "@/lib/contentMediaAssets";
import {
  AD_LAYOUTS,
  AD_LAYOUT_LABELS,
  AD_SIZES,
  AD_SIZE_LABELS,
  blobToBase64,
  computeAdLayout,
  loadDrawableImage,
  renderAd,
  type AdLayoutKind,
  type AdSizeKind,
} from "@/lib/adRenderer";
import {
  generateBatchVisuals,
  generateVisualConcepts,
  planBatchRender,
  storeRenderedCreative,
  type CreativeBrandKit,
  type CreativeStudioAd,
  type CreativeStudioConcept,
  type CreativeVariant,
} from "@/lib/creativeStudio";

type MediaAsset = { id: string; title: string; storage_path: string; width_px: number; height_px: number };

type Props = {
  workspaceId: string;
  businessContext: string;
  audience: string;
  tone: string;
  sourceAssetId: string | null;
  copyVariants: CreativeVariant[];
  mediaAssets: MediaAsset[];
  canPromoteToCampaign: boolean;
};

const STATUS_VARIANT: Record<CreativeStudioAd["status"], "default" | "secondary" | "destructive" | "outline"> = {
  rendering: "secondary",
  ready: "default",
  approved: "default",
  rejected: "destructive",
  failed: "destructive",
};

export function BatchAdStudio({
  workspaceId,
  businessContext,
  audience,
  tone,
  sourceAssetId,
  copyVariants,
  mediaAssets,
  canPromoteToCampaign,
}: Props) {
  const navigate = useNavigate();

  const [batchId, setBatchId] = useState<string | null>(null);
  const [concepts, setConcepts] = useState<CreativeStudioConcept[]>([]);
  const [creatives, setCreatives] = useState<CreativeStudioAd[]>([]);
  const [brand, setBrand] = useState<CreativeBrandKit | null>(null);
  const [visualUrls, setVisualUrls] = useState<Record<string, string | null>>({});

  const [layouts, setLayouts] = useState<AdLayoutKind[]>(["split", "full_bleed"]);
  const [sizes, setSizes] = useState<AdSizeKind[]>(["1080x1080", "1080x1350"]);

  const [busy, setBusy] = useState<null | "concepts" | "visuals" | "render">(null);
  const [renderProgress, setRenderProgress] = useState<{ done: number; total: number } | null>(null);
  const [editing, setEditing] = useState<Record<string, Partial<CreativeStudioAd>>>({});
  const logoImg = useRef<HTMLImageElement | null>(null);

  const readyConceptCount = concepts.filter((c) => c.visual_status === "ready").length;
  const failedConceptCount = concepts.filter((c) => c.visual_status === "failed").length;

  const upsertCreative = useCallback((row: CreativeStudioAd) => {
    setCreatives((prev) => {
      const idx = prev.findIndex((c) => c.id === row.id);
      if (idx === -1) return [...prev, row];
      const next = prev.slice();
      next[idx] = row;
      return next;
    });
  }, []);

  // -- Stage 2: concepts -----------------------------------------------------
  async function handleGenerateConcepts() {
    if (!businessContext.trim()) {
      toast.error("Add a product/service description above first.");
      return;
    }
    setBusy("concepts");
    try {
      const res = await generateVisualConcepts({
        workspaceId,
        businessContext: businessContext.trim(),
        audience: audience.trim() || undefined,
        tone: tone || undefined,
        sourceMediaAssetId: sourceAssetId,
        conceptCount: 4,
        copyVariants,
      });
      setBatchId(res.batch.id);
      setConcepts(res.concepts);
      setCreatives([]);
      toast.success(`${res.concepts.length} visual concepts ready`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate concepts");
    } finally {
      setBusy(null);
    }
  }

  async function setConceptVisualSource(concept: CreativeStudioConcept, source: "ai" | "media_library", assetId?: string) {
    const patch =
      source === "media_library"
        ? { visual_source: "media_library" as const, visual_media_asset_id: assetId ?? null, visual_status: "pending" as const, visual_error: null }
        : { visual_source: "ai" as const, visual_status: "pending" as const, visual_error: null };
    const { data, error } = await supabase
      .from("creative_studio_concepts")
      .update(patch)
      .eq("id", concept.id)
      .select("*")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Could not update the concept");
      return;
    }
    setConcepts((prev) => prev.map((c) => (c.id === concept.id ? (data as CreativeStudioConcept) : c)));
  }

  // -- Stage 3: visuals ----------------------------------------------------
  async function handleGenerateVisuals(conceptIds?: string[], retry = false) {
    if (!batchId) return;
    setBusy("visuals");
    try {
      const res = await generateBatchVisuals({ workspaceId, batchId, conceptIds, retry });
      setConcepts((prev) =>
        prev.map((c) => {
          const hit = res.concepts.find((r) => r.id === c.id);
          return hit ? { ...c, visual_status: hit.visual_status, visual_error: hit.visual_error } : c;
        }),
      );
      const { ready, failed, total } = res.summary;
      if (failed > 0) toast.warning(`${ready} of ${total} visuals generated — ${failed} failed`);
      else toast.success(`${ready} of ${total} visuals generated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Visual generation failed");
    } finally {
      setBusy(null);
    }
  }

  // -- Stage 6: render ---------------------------------------------------
  const renderOneCreative = useCallback(
    async (creative: CreativeStudioAd, brandKit: CreativeBrandKit, conceptVisualUrls: Record<string, string | null>, conceptList: CreativeStudioConcept[]) => {
      const concept = conceptList.find((c) => c.id === creative.concept_id);
      const bgUrl = conceptVisualUrls[creative.concept_id] ?? null;
      try {
        const [background, logo] = await Promise.all([
          bgUrl ? loadDrawableImage(bgUrl) : Promise.resolve(null),
          brandKit.logoUrl
            ? (logoImg.current ? Promise.resolve(logoImg.current) : loadDrawableImage(brandKit.logoUrl).then((img) => ((logoImg.current = img), img)))
            : Promise.resolve(null),
        ]);
        const plan = computeAdLayout({
          layout: creative.layout as AdLayoutKind,
          size: creative.size as AdSizeKind,
          headline: creative.headline,
          body: creative.body_text,
          cta: creative.cta,
          brandName: brandKit.name || "",
          contact: creative.contact_text ?? (brandKit.contactPhone || brandKit.contactEmail || null),
          price: creative.price_text ?? null,
          disclaimer: creative.disclaimer_text ?? brandKit.footerDisclaimer ?? null,
          hasLogo: !!logo,
          hasBackground: !!background,
          brand: {
            primary: brandKit.primary || "#1f2937",
            accent: brandKit.accent || "#2563eb",
            ctaText: brandKit.ctaText,
          },
        });
        const result = await renderAd(plan, { background, logo });
        const pngBase64 = await blobToBase64(result.blob);
        const stored = await storeRenderedCreative({
          workspaceId,
          creativeId: creative.id,
          pngBase64,
          overflowWarning: result.overflow,
        });
        upsertCreative(stored.creative);
        if (concept && result.overflow) {
          toast.warning(`"${concept.concept_name}" ${creative.size}: headline is tight — flagged, not truncated.`);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Render failed";
        await supabase.from("creative_studio_creatives").update({ status: "failed", render_error: message.slice(0, 500) }).eq("id", creative.id);
        setCreatives((prev) => prev.map((c) => (c.id === creative.id ? { ...c, status: "failed", render_error: message } : c)));
      }
    },
    [upsertCreative, workspaceId],
  );

  async function handleGenerateCreatives() {
    if (!batchId) return;
    if (layouts.length === 0 || sizes.length === 0) {
      toast.error("Pick at least one layout and one size.");
      return;
    }
    setBusy("render");
    try {
      const plan = await planBatchRender({ workspaceId, batchId, layouts, sizes });
      setBrand(plan.brand);
      setVisualUrls(plan.conceptVisualUrls);
      setCreatives(plan.creatives);
      const pending = plan.creatives.filter((c) => c.status === "rendering" || c.status === "failed");
      setRenderProgress({ done: 0, total: pending.length });
      for (let i = 0; i < pending.length; i++) {
        await renderOneCreative(pending[i], plan.brand, plan.conceptVisualUrls, concepts);
        setRenderProgress({ done: i + 1, total: pending.length });
      }
      toast.success(`${pending.length} creatives rendered`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not render creatives");
    } finally {
      setBusy(null);
      setRenderProgress(null);
    }
  }

  // -- Gallery actions -------------------------------------------------
  async function review(creative: CreativeStudioAd, status: "approved" | "rejected") {
    const { data: userRes } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("creative_studio_creatives")
      .update({ status, reviewed_by: userRes.user?.id ?? null, reviewed_at: new Date().toISOString() })
      .eq("id", creative.id)
      .select("*")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Could not update");
      return;
    }
    upsertCreative(data as CreativeStudioAd);
  }

  async function saveEdit(creative: CreativeStudioAd) {
    const patch = editing[creative.id];
    if (!patch || !brand) return;
    const merged: CreativeStudioAd = { ...creative, ...patch };
    setBusy("render");
    try {
      const concept = concepts.find((c) => c.id === creative.concept_id);
      const bgUrl = visualUrls[creative.concept_id] ?? null;
      const [background, logo] = await Promise.all([
        bgUrl ? loadDrawableImage(bgUrl) : Promise.resolve(null),
        brand.logoUrl ? (logoImg.current ? Promise.resolve(logoImg.current) : loadDrawableImage(brand.logoUrl)) : Promise.resolve(null),
      ]);
      const plan = computeAdLayout({
        layout: merged.layout as AdLayoutKind,
        size: merged.size as AdSizeKind,
        headline: merged.headline,
        body: merged.body_text,
        cta: merged.cta,
        brandName: brand.name || "",
        contact: merged.contact_text ?? null,
        price: merged.price_text ?? null,
        disclaimer: merged.disclaimer_text ?? brand.footerDisclaimer ?? null,
        hasLogo: !!logo,
        hasBackground: !!background,
        brand: { primary: brand.primary || "#1f2937", accent: brand.accent || "#2563eb", ctaText: brand.ctaText },
      });
      const result = await renderAd(plan, { background, logo });
      const pngBase64 = await blobToBase64(result.blob);
      const stored = await storeRenderedCreative({
        workspaceId,
        creativeId: creative.id,
        pngBase64,
        overflowWarning: result.overflow,
        copy: {
          headline: merged.headline,
          body_text: merged.body_text,
          cta: merged.cta,
          contact_text: merged.contact_text ?? null,
          price_text: merged.price_text ?? null,
          disclaimer_text: merged.disclaimer_text ?? null,
        },
      });
      upsertCreative(stored.creative);
      setEditing((prev) => {
        const next = { ...prev };
        delete next[creative.id];
        return next;
      });
      toast.success("Re-rendered with updated copy (no new image generated)");
      if (concept && result.overflow) toast.warning("Headline is tight at this size — flagged, not truncated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-render failed");
    } finally {
      setBusy(null);
    }
  }

  async function regenerateVisual(creative: CreativeStudioAd) {
    if (!batchId) return;
    setBusy("visuals");
    try {
      await generateBatchVisuals({ workspaceId, batchId, conceptIds: [creative.concept_id], retry: true });
      toast.success("New background generated — re-rendering affected creatives");
      const plan = await planBatchRender({ workspaceId, batchId, layouts, sizes, conceptIds: [creative.concept_id] });
      setVisualUrls((prev) => ({ ...prev, ...plan.conceptVisualUrls }));
      setBrand(plan.brand);
      const affected = plan.creatives.filter((c) => c.concept_id === creative.concept_id);
      for (const row of affected) await renderOneCreative(row, plan.brand, plan.conceptVisualUrls, concepts);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not regenerate visual");
    } finally {
      setBusy(null);
    }
  }

  async function download(creative: CreativeStudioAd) {
    if (!creative.storage_path) return;
    const url = await getContentAssetPreviewUrl(creative.storage_path, 600);
    if (!url) {
      toast.error("Could not create a download link");
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = `${creative.headline.slice(0, 40).replace(/\s+/g, "-")}-${creative.size}.png`;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
  }

  function sendToCampaign(creative: CreativeStudioAd) {
    if (!creative.rendered_media_asset_id) return;
    navigate("/app/campaigns/new", {
      state: { prefill: { sourceContentMediaAssetId: creative.rendered_media_asset_id, primaryText: creative.body_text } },
    });
  }

  const conceptById = useMemo(() => new Map(concepts.map((c) => [c.id, c])), [concepts]);

  return (
    <div className="space-y-6">
      {/* Stage 2 -------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate visual concepts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Turn the brief{copyVariants.length > 0 ? " and the copy above" : ""} into structured concepts — each becomes one AI background image, then StabiFlow renders the finished adverts with your exact text and brand kit.
          </p>
          <Button onClick={handleGenerateConcepts} disabled={busy !== null}>
            {busy === "concepts" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            {concepts.length > 0 ? "Regenerate concepts" : "Generate visual concepts"}
          </Button>

          {concepts.length > 0 && (
            <div className="space-y-3">
              {concepts.map((c) => (
                <div key={c.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.concept_name}</span>
                    <Badge variant="outline">{c.layout_style ?? "split"}</Badge>
                    <Badge
                      variant={c.visual_status === "ready" ? "default" : c.visual_status === "failed" ? "destructive" : "secondary"}
                    >
                      {c.visual_status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm font-semibold">{c.headline}</p>
                  <p className="text-sm text-muted-foreground">{c.supporting_text}</p>
                  <p className="mt-1 text-xs font-medium text-primary">{c.cta}</p>
                  <p className="mt-2 text-xs text-muted-foreground"><span className="font-medium">Visual prompt:</span> {c.visual_prompt}</p>
                  {c.visual_error && <p className="mt-1 text-xs text-destructive">{c.visual_error}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Select
                      value={c.visual_source}
                      onValueChange={(v) => setConceptVisualSource(c, v as "ai" | "media_library")}
                    >
                      <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ai">Generate new AI visual</SelectItem>
                        <SelectItem value="media_library">Use a Media Library image</SelectItem>
                      </SelectContent>
                    </Select>
                    {c.visual_source === "media_library" && (
                      <Select
                        value={c.visual_media_asset_id ?? ""}
                        onValueChange={(assetId) => setConceptVisualSource(c, "media_library", assetId)}
                      >
                        <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Pick an image" /></SelectTrigger>
                        <SelectContent>
                          {mediaAssets.slice(0, 20).map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {c.visual_status === "failed" && (
                      <Button size="sm" variant="outline" onClick={() => handleGenerateVisuals([c.id], true)} disabled={busy !== null}>
                        <RefreshCw className="mr-1 h-3 w-3" /> Retry
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stage 3-5 --------------------------------------------------- */}
      {concepts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate backgrounds &amp; choose formats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => handleGenerateVisuals()} disabled={busy !== null}>
                {busy === "visuals" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
                Generate backgrounds
              </Button>
              <span className="text-sm text-muted-foreground">
                {readyConceptCount} of {concepts.length} ready{failedConceptCount > 0 ? ` · ${failedConceptCount} failed` : ""}
              </span>
              {failedConceptCount > 0 && (
                <Button size="sm" variant="outline" onClick={() => handleGenerateVisuals(concepts.filter((c) => c.visual_status === "failed").map((c) => c.id), true)} disabled={busy !== null}>
                  <RefreshCw className="mr-1 h-3 w-3" /> Retry failed only
                </Button>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium">Layouts</p>
                <div className="space-y-2">
                  {AD_LAYOUTS.map((l) => (
                    <label key={l} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={layouts.includes(l)}
                        onCheckedChange={(v) => setLayouts((prev) => (v ? [...prev, l] : prev.filter((x) => x !== l)))}
                      />
                      {AD_LAYOUT_LABELS[l]}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Sizes</p>
                <div className="space-y-2">
                  {AD_SIZES.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={sizes.includes(s)}
                        onCheckedChange={(v) => setSizes((prev) => (v ? [...prev, s] : prev.filter((x) => x !== s)))}
                      />
                      {s} · {AD_SIZE_LABELS[s]}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={handleGenerateCreatives} disabled={busy !== null || readyConceptCount === 0}>
                {busy === "render" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Generate creatives
              </Button>
              <span className="text-xs text-muted-foreground">
                {readyConceptCount} × {layouts.length} layouts × {sizes.length} sizes = {readyConceptCount * layouts.length * sizes.length} ads · {readyConceptCount} image calls
              </span>
            </div>
            {renderProgress && (
              <p className="text-xs text-muted-foreground">Rendering {renderProgress.done}/{renderProgress.total}…</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stage 7: gallery -------------------------------------------- */}
      {creatives.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold">Review gallery ({creatives.length})</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creatives.map((cr) => {
              const concept = conceptById.get(cr.concept_id);
              const edit = editing[cr.id];
              return (
                <Card key={cr.id} className="overflow-hidden">
                  <div className="aspect-square w-full bg-muted">
                    {cr.storage_path ? (
                      <MediaPreview storagePath={cr.storage_path} alt={cr.headline} className="h-full w-full object-contain" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        {cr.status === "failed" ? "Render failed" : "Rendering…"}
                      </div>
                    )}
                  </div>
                  <CardContent className="space-y-2 pt-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{cr.size}</Badge>
                      <Badge variant="outline">{AD_LAYOUT_LABELS[cr.layout as AdLayoutKind]?.split(" ")[0] ?? cr.layout}</Badge>
                      <Badge variant={STATUS_VARIANT[cr.status]}>{cr.status}</Badge>
                      {cr.overflow_warning && <Badge variant="destructive">tight fit</Badge>}
                    </div>
                    <p className="text-sm font-semibold">{cr.headline}</p>
                    <p className="text-xs text-muted-foreground">{concept?.concept_name}</p>
                    {cr.render_error && <p className="text-xs text-destructive">{cr.render_error}</p>}

                    {edit ? (
                      <div className="space-y-2 rounded-md border p-2">
                        <Input value={edit.headline ?? cr.headline} onChange={(e) => setEditing((p) => ({ ...p, [cr.id]: { ...p[cr.id], headline: e.target.value } }))} placeholder="Headline" />
                        <Textarea rows={2} value={edit.body_text ?? cr.body_text} onChange={(e) => setEditing((p) => ({ ...p, [cr.id]: { ...p[cr.id], body_text: e.target.value } }))} placeholder="Body" />
                        <Input value={edit.cta ?? cr.cta} onChange={(e) => setEditing((p) => ({ ...p, [cr.id]: { ...p[cr.id], cta: e.target.value } }))} placeholder="CTA" />
                        <Input value={edit.contact_text ?? cr.contact_text ?? ""} onChange={(e) => setEditing((p) => ({ ...p, [cr.id]: { ...p[cr.id], contact_text: e.target.value } }))} placeholder="Contact (optional)" />
                        <Input value={edit.price_text ?? cr.price_text ?? ""} onChange={(e) => setEditing((p) => ({ ...p, [cr.id]: { ...p[cr.id], price_text: e.target.value } }))} placeholder="Price (optional)" />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => saveEdit(cr)} disabled={busy !== null}>Save &amp; re-render</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing((p) => { const n = { ...p }; delete n[cr.id]; return n; })}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <Button size="sm" variant="outline" onClick={() => review(cr, "approved")} disabled={cr.status === "rendering"}>
                          <Check className="mr-1 h-3 w-3" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => review(cr, "rejected")} disabled={cr.status === "rendering"}>
                          <X className="mr-1 h-3 w-3" /> Reject
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing((p) => ({ ...p, [cr.id]: {} }))}>Edit copy</Button>
                        <Button size="sm" variant="outline" onClick={() => regenerateVisual(cr)} disabled={busy !== null}>
                          <RefreshCw className="mr-1 h-3 w-3" /> Regenerate visual
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => download(cr)} disabled={!cr.storage_path}>
                          <Download className="mr-1 h-3 w-3" /> Download
                        </Button>
                        {canPromoteToCampaign && (
                          <Button size="sm" variant="outline" onClick={() => sendToCampaign(cr)} disabled={cr.status !== "approved" || !cr.rendered_media_asset_id}>
                            <Megaphone className="mr-1 h-3 w-3" /> Use in Campaign
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
