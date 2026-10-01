import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Palette, Sparkles, Copy, Megaphone, Loader2, ImageIcon, X, ChevronDown, ChevronUp, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/EmptyState";
import { MediaPreview } from "@/components/content/MediaPreview";
import { BatchAdStudio } from "@/components/creative-studio/BatchAdStudio";
import { BrandProfileSelector } from "@/components/creative-studio/BrandProfileSelector";
import { useAuth } from "@/hooks/useAuth";
import { useContentMediaAssets } from "@/hooks/useContentMediaAssets";
import { supabase } from "@/integrations/supabase/client";
import { AD_SIZES, AD_SIZE_LABELS, type AdSizeKind } from "@/lib/adRenderer";
import {
  generateCreativeCopy,
  DEFAULT_REFERENCE_PREFERENCES,
  type AssetPurpose,
  type ContactFieldKey,
  type CreativeVariant,
  type ReferencePreferences,
} from "@/lib/creativeStudio";
import type { BrandProfile } from "@/lib/brandProfiles";
import { CONTENT_ASSET_ROLE_LABELS, type ContentAssetRole } from "@/lib/contentMediaAssets";

const TONE_OPTIONS = ["Professional", "Friendly", "Playful", "Bold", "Trustworthy"];
const CONCEPT_COUNT_OPTIONS = [1, 3, 6];
const DEFAULT_FORMATS: AdSizeKind[] = ["1080x1080", "1080x1350"];

const CONTACT_FIELD_OPTIONS: { value: ContactFieldKey; label: string }[] = [
  { value: "phone", label: "Phone" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "website", label: "Website" },
  { value: "email", label: "Email" },
  { value: "address", label: "Address" },
];
const DEFAULT_CONTACT_FIELDS: ContactFieldKey[] = ["phone", "whatsapp", "website"];

const ASSET_PURPOSE_OPTIONS: { value: AssetPurpose; label: string }[] = [
  { value: "reference_creative", label: "Use as reference creative" },
  { value: "product_image", label: "Use as product image" },
  { value: "background", label: "Use as background/source image" },
];

// A classified Media Library asset_role suggests a matching purpose, but
// never forces it - the user can always pick a different purpose, and an
// unclassified asset (asset_role null) still offers every option.
function suggestedPurpose(role: ContentAssetRole | null | undefined): AssetPurpose | null {
  if (role === "reference_creative" || role === "product_image" || role === "background") return role;
  return null;
}

type RecentBatch = { id: string; business_context: string; status: string; created_at: string };

// Creative Studio: fill everything in once, click "Generate Ads", receive
// complete finished adverts (instruction #2). The multi-stage pipeline
// (copy -> concepts -> AI backgrounds -> deterministic render) still runs
// underneath - BatchAdStudio orchestrates it behind one button - but the
// normal user never has to think about those stages individually.
export default function CreativeStudio() {
  const { currentWorkspaceId, currentMembership, user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const canGenerate = hasPermission("content.create");
  const canPromoteToCampaign = hasPermission("campaign.create");
  const { data: mediaAssets } = useContentMediaAssets(currentWorkspaceId);

  const [productService, setProductService] = useState("");
  const [offerMessage, setOfferMessage] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState<string>("");
  const [headline, setHeadline] = useState("");
  const [supportingText, setSupportingText] = useState("");
  const [cta, setCta] = useState("");
  const [visualDirection, setVisualDirection] = useState("");
  const [conceptCount, setConceptCount] = useState(3);
  const [formats, setFormats] = useState<AdSizeKind[]>(DEFAULT_FORMATS);
  const [contactFieldsSelected, setContactFieldsSelected] = useState<ContactFieldKey[]>(DEFAULT_CONTACT_FIELDS);
  const [selectedBrand, setSelectedBrand] = useState<BrandProfile | null>(null);

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [assetPurpose, setAssetPurpose] = useState<AssetPurpose | null>(null);
  const [referencePreferences, setReferencePreferences] = useState<ReferencePreferences>(DEFAULT_REFERENCE_PREFERENCES);
  const selectedAsset = mediaAssets?.find((asset) => asset.id === selectedAssetId) ?? null;

  const [advancedCopyOpen, setAdvancedCopyOpen] = useState(false);
  const [variants, setVariants] = useState<CreativeVariant[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [recentBatches, setRecentBatches] = useState<RecentBatch[]>([]);
  const [reopenBatchId, setReopenBatchId] = useState<string | null>(null);

  const businessContext = [productService.trim(), offerMessage.trim() ? `Offer/message: ${offerMessage.trim()}` : ""].filter(Boolean).join(". ");
  const missingBusinessContext = !productService.trim();

  useEffect(() => {
    if (!currentWorkspaceId) return;
    let cancelled = false;
    supabase
      .from("creative_studio_batches")
      .select("id, business_context, status, created_at")
      .eq("workspace_id", currentWorkspaceId)
      .order("created_at", { ascending: false })
      .limit(8)
      .then(({ data }) => {
        if (!cancelled) setRecentBatches((data ?? []) as RecentBatch[]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId]);

  function selectAsset(assetId: string | null) {
    setSelectedAssetId(assetId);
    setReferencePreferences(DEFAULT_REFERENCE_PREFERENCES);
    if (!assetId) {
      setAssetPurpose(null);
      return;
    }
    const asset = mediaAssets?.find((a) => a.id === assetId);
    setAssetPurpose(suggestedPurpose((asset as { asset_role?: ContentAssetRole | null } | undefined)?.asset_role ?? null));
  }

  async function handleGenerateCopyOnly() {
    if (!currentWorkspaceId || missingBusinessContext) return;
    setIsGenerating(true);
    setVariants(null);
    try {
      const result = await generateCreativeCopy({
        workspaceId: currentWorkspaceId,
        businessContext: businessContext.trim(),
        audience: audience.trim() || undefined,
        tone: tone || undefined,
        variantCount: 3,
      });
      setVariants(result.variants);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to generate copy");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleCopy(variant: CreativeVariant) {
    const text = `${variant.headline}\n\n${variant.primaryText}\n\n${variant.description}\n\n${variant.cta}`;
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  }

  function handleUseInCampaign(variant: CreativeVariant) {
    navigate("/app/campaigns/new", {
      state: { prefill: { sourceContentMediaAssetId: selectedAssetId || undefined, primaryText: variant.primaryText } },
    });
  }

  const totalAds = conceptCount * Math.max(formats.length, 1);

  return (
    <div className="mobile-touch space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Creative Studio</h1>
        <p className="text-sm text-muted-foreground">Fill everything in once, click Generate Ads, and get complete finished adverts.</p>
      </div>

      {!canGenerate ? (
        <EmptyState icon={Palette} title="You don't have access to Creative Studio" description="Ask a workspace admin for content creation access." className="min-h-[40vh]" />
      ) : (
        <>
          {recentBatches.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <History className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Recent:</span>
              {recentBatches.map((b) => (
                <Button key={b.id} type="button" size="sm" variant="outline" className="h-7" onClick={() => setReopenBatchId(b.id)}>
                  {b.business_context.slice(0, 40)}
                  {b.business_context.length > 40 ? "…" : ""}
                </Button>
              ))}
            </div>
          )}

          {currentWorkspaceId && user && (
            <BrandProfileSelector
              workspaceId={currentWorkspaceId}
              workspaceName={currentMembership?.workspace.name ?? ""}
              userId={user.id}
              selectedProfileId={selectedBrand?.id ?? null}
              onSelect={setSelectedBrand}
            />
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">What are you advertising?</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label htmlFor="creative-product-service" className="mb-1 block text-sm font-medium">Product/service <span aria-hidden="true">*</span></label>
                <Textarea
                  id="creative-product-service"
                  placeholder="e.g. A weekend baking course for beginners, hosted in Cape Town"
                  value={productService}
                  onChange={(e) => setProductService(e.target.value)}
                  rows={2}
                  maxLength={700}
                  aria-describedby={missingBusinessContext ? "creative-product-service-help" : undefined}
                  aria-invalid={missingBusinessContext}
                />
                {missingBusinessContext && <p id="creative-product-service-help" className="mt-1.5 text-xs text-muted-foreground">Describe the product or service before generating ads.</p>}
              </div>
              <div>
                <label htmlFor="creative-offer" className="mb-1 block text-sm font-medium">Main offer/message (optional)</label>
                <Textarea id="creative-offer" placeholder="e.g. 20% off for first-time bookings this month" value={offerMessage} onChange={(e) => setOfferMessage(e.target.value)} rows={2} maxLength={300} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="creative-audience" className="mb-1 block text-sm font-medium">Target audience (optional)</label>
                  <Input id="creative-audience" placeholder="e.g. Young professionals in their 20s-30s" value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={300} />
                </div>
                <div>
                  <label htmlFor="creative-tone" className="mb-1 block text-sm font-medium">Tone (optional)</label>
                  <Select value={tone} onValueChange={setTone}>
                    <SelectTrigger id="creative-tone"><SelectValue placeholder="Any tone" /></SelectTrigger>
                    <SelectContent>
                      {TONE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="creative-headline" className="mb-1 block text-sm font-medium">Headline (optional — leave blank for AI)</label>
                  <Input id="creative-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={120} placeholder="Leave blank to let AI write it" />
                </div>
                <div>
                  <label htmlFor="creative-cta" className="mb-1 block text-sm font-medium">CTA (optional — defaults from brand)</label>
                  <Input id="creative-cta" value={cta} onChange={(e) => setCta(e.target.value)} maxLength={40} placeholder={selectedBrand?.defaultCta || "e.g. Book now"} />
                </div>
              </div>
              <div>
                <label htmlFor="creative-supporting" className="mb-1 block text-sm font-medium">Supporting text (optional — leave blank for AI)</label>
                <Textarea id="creative-supporting" value={supportingText} onChange={(e) => setSupportingText(e.target.value)} rows={2} maxLength={400} placeholder="Leave blank to let AI write it" />
              </div>
              <div>
                <label htmlFor="creative-visual-direction" className="mb-1 block text-sm font-medium">Visual direction (optional)</label>
                <Textarea
                  id="creative-visual-direction"
                  value={visualDirection}
                  onChange={(e) => setVisualDirection(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder='e.g. "A worried South African business owner reviewing a SARS notice in a modern office, professional and reassuring"'
                />
              </div>

              {mediaAssets && mediaAssets.length > 0 ? (
                <div>
                  <label className="mb-1 block text-sm font-medium">Reference / source image (optional)</label>
                  {selectedAsset && (
                    <div className="mb-3 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                      <MediaPreview storagePath={selectedAsset.storage_path} alt={selectedAsset.title} className="h-20 w-20 shrink-0 rounded-md object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-primary">Selected media</p>
                        <p className="truncate text-sm font-medium" title={selectedAsset.title}>{selectedAsset.title}</p>
                        <p className="text-xs text-muted-foreground">{selectedAsset.width_px}×{selectedAsset.height_px}px</p>
                      </div>
                      <Button type="button" size="sm" variant="ghost" onClick={() => selectAsset(null)} aria-label={`Remove ${selectedAsset.title}`}>
                        <X className="mr-1 h-4 w-4" /> Remove
                      </Button>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                    {mediaAssets.slice(0, 8).map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => selectAsset(selectedAssetId === asset.id ? null : asset.id)}
                        className={`overflow-hidden rounded-lg border-2 p-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${selectedAssetId === asset.id ? "border-primary bg-primary/5" : "border-border"}`}
                        title={asset.title}
                        aria-pressed={selectedAssetId === asset.id}
                        aria-label={`${selectedAssetId === asset.id ? "Selected" : "Select"} ${asset.title}`}
                      >
                        <MediaPreview storagePath={asset.storage_path} alt="" className="aspect-square w-full rounded object-cover" />
                        <span className="block truncate px-1 py-1 text-xs">{asset.title}</span>
                      </button>
                    ))}
                  </div>

                  {selectedAsset && (
                    <div className="mt-3 space-y-3 rounded-lg border p-3">
                      <div>
                        <Label htmlFor="creative-asset-purpose" className="mb-1 block text-sm font-medium">How should StabiFlow use this image?</Label>
                        <Select value={assetPurpose ?? ""} onValueChange={(v) => { setAssetPurpose(v as AssetPurpose); setReferencePreferences(DEFAULT_REFERENCE_PREFERENCES); }}>
                          <SelectTrigger id="creative-asset-purpose"><SelectValue placeholder="Choose a purpose" /></SelectTrigger>
                          <SelectContent>
                            {ASSET_PURPOSE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {(selectedAsset as { asset_role?: ContentAssetRole | null }).asset_role && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Media Library classifies this as "{CONTENT_ASSET_ROLE_LABELS[(selectedAsset as { asset_role: ContentAssetRole }).asset_role]}" - a suggestion only, pick any purpose above.
                          </p>
                        )}
                      </div>

                      {assetPurpose === "reference_creative" && (
                        <div>
                          <p className="mb-2 text-sm font-medium">How should StabiFlow use this reference?</p>
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm">
                              <Checkbox checked={referencePreferences.keep_colours} onCheckedChange={(v) => setReferencePreferences((p) => ({ ...p, keep_colours: v === true, fresh_layout: false }))} />
                              Keep similar colours
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <Checkbox checked={referencePreferences.keep_layout} onCheckedChange={(v) => setReferencePreferences((p) => ({ ...p, keep_layout: v === true, fresh_layout: false }))} />
                              Keep similar layout
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <Checkbox checked={referencePreferences.keep_imagery} onCheckedChange={(v) => setReferencePreferences((p) => ({ ...p, keep_imagery: v === true, fresh_layout: false }))} />
                              Keep similar imagery
                            </label>
                            <label className="flex items-center gap-2 text-sm border-t pt-2 mt-2">
                              <Checkbox
                                checked={referencePreferences.fresh_layout}
                                onCheckedChange={(v) =>
                                  setReferencePreferences(
                                    v === true
                                      ? { keep_colours: false, keep_layout: false, keep_imagery: false, fresh_layout: true }
                                      : { ...referencePreferences, fresh_layout: false },
                                  )
                                }
                              />
                              Fresh layout using my branding
                            </label>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            StabiFlow generates a genuinely new advert inspired by this one's style - it never reuses its exact artwork, text, prices or contact details.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : mediaAssets ? (
                <div className="rounded-lg border border-dashed p-4">
                  <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <ImageIcon className="mt-0.5 h-5 w-5 text-muted-foreground" />
                      <div><p className="text-sm font-medium">Your Media Library is empty</p><p className="text-xs text-muted-foreground">Upload media once and reuse it here, in Content, and in Campaigns.</p></div>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => navigate("/app/content/media-library")}>Open Media Library</Button>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="mb-1 block text-sm font-medium">Number of concepts</Label>
                  <Select value={String(conceptCount)} onValueChange={(v) => setConceptCount(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONCEPT_COUNT_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1 block text-sm font-medium">Formats</Label>
                  <div className="space-y-1.5">
                    {AD_SIZES.map((s) => (
                      <label key={s} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={formats.includes(s)}
                          onCheckedChange={(v) => setFormats((prev) => (v ? [...prev, s] : prev.filter((x) => x !== s)))}
                        />
                        {AD_SIZE_LABELS[s]}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <Label className="mb-1 block text-sm font-medium">Contact details to show</Label>
                <div className="flex flex-wrap gap-3">
                  {CONTACT_FIELD_OPTIONS.map((f) => (
                    <label key={f.value} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={contactFieldsSelected.includes(f.value)}
                        onCheckedChange={(v) => setContactFieldsSelected((prev) => (v ? [...prev, f.value] : prev.filter((x) => x !== f.value)))}
                      />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {conceptCount} concept{conceptCount === 1 ? "" : "s"} × {Math.max(formats.length, 1)} format{formats.length === 1 ? "" : "s"} = {totalAds} finished ad{totalAds === 1 ? "" : "s"}
              </p>

              <div>
                <Button type="button" variant="ghost" size="sm" className="h-auto min-h-9 whitespace-normal text-left" onClick={() => setAdvancedCopyOpen((v) => !v)}>
                  {advancedCopyOpen ? <ChevronUp className="mr-1.5 h-3.5 w-3.5" /> : <ChevronDown className="mr-1.5 h-3.5 w-3.5" />}
                  {advancedCopyOpen ? "Hide" : "Show"} standalone copy ideas (advanced)
                </Button>
              </div>
              {advancedCopyOpen && (
                <div className="space-y-3 rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Generates copy ideas only (no ads) - useful for brainstorming before you fill in headline/CTA above.</p>
                  <Button variant="outline" onClick={handleGenerateCopyOnly} disabled={missingBusinessContext || isGenerating}>
                    {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Generate copy ideas
                  </Button>
                  {variants && variants.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {variants.map((variant, i) => (
                        <Card key={i}>
                          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Variation {i + 1}</CardTitle></CardHeader>
                          <CardContent className="space-y-2">
                            <p className="font-semibold">{variant.headline}</p>
                            <p className="text-sm">{variant.primaryText}</p>
                            <p className="text-xs text-muted-foreground">{variant.description}</p>
                            <p className="text-xs font-medium text-primary">{variant.cta}</p>
                            <div className="flex gap-2 pt-2">
                              <Button size="sm" variant="outline" onClick={() => handleCopy(variant)}>
                                <Copy className="mr-1 h-3 w-3" /> Copy
                              </Button>
                              {canPromoteToCampaign && (
                                <Button size="sm" variant="outline" onClick={() => handleUseInCampaign(variant)}>
                                  <Megaphone className="mr-1 h-3 w-3" /> Use in new campaign
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {currentWorkspaceId && user && (
            <BatchAdStudio
              workspaceId={currentWorkspaceId}
              businessContext={businessContext}
              audience={audience}
              tone={tone}
              sourceAssetId={selectedAssetId}
              assetPurpose={assetPurpose}
              referencePreferences={referencePreferences}
              copyVariants={variants ?? []}
              mediaAssets={(mediaAssets ?? []).map((a) => ({
                id: a.id,
                title: a.title,
                storage_path: a.storage_path,
                width_px: a.width_px,
                height_px: a.height_px,
              }))}
              canPromoteToCampaign={canPromoteToCampaign}
              brandProfileId={selectedBrand?.id ?? null}
              visualDirection={visualDirection}
              userCopy={{ headline, body: supportingText, cta }}
              contactFields={contactFieldsSelected}
              conceptCount={conceptCount}
              formats={formats}
              reopenBatchId={reopenBatchId}
            />
          )}
        </>
      )}
    </div>
  );
}
