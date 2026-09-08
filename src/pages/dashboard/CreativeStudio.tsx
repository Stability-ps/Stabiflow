import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Palette, Sparkles, Copy, Megaphone, Loader2, ImageIcon, X } from "lucide-react";
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
import { useAuth } from "@/hooks/useAuth";
import { useContentMediaAssets } from "@/hooks/useContentMediaAssets";
import {
  generateCreativeCopy,
  DEFAULT_REFERENCE_PREFERENCES,
  type AssetPurpose,
  type CreativeVariant,
  type ReferencePreferences,
} from "@/lib/creativeStudio";
import { CONTENT_ASSET_ROLE_LABELS, type ContentAssetRole } from "@/lib/contentMediaAssets";

const TONE_OPTIONS = ["Professional", "Friendly", "Playful", "Bold", "Trustworthy"];

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

// Creative Studio V1 (post-launch UI polish). Generates ad copy
// variations via a single-shot OpenAI call (creative-studio-generate) -
// read+recommend only, same discipline as Flow AI: nothing here ever
// mutates workspace data on its own. Using a variation elsewhere is
// always an explicit user action:
//  - "Copy" just copies text to the clipboard.
//  - "Use in new campaign" reuses the EXISTING prefill mechanism
//    MediaLibraryGrid's "Promote as Campaign" button already uses
//    (navigate("/app/campaigns/new", { state: { prefill: ... } })) - no new
//    campaign-creation wiring was added for this feature.
export default function CreativeStudio() {
  const { currentWorkspaceId, hasPermission } = useAuth();
  const navigate = useNavigate();
  const canGenerate = hasPermission("content.create");
  const canPromoteToCampaign = hasPermission("campaign.create");
  const { data: mediaAssets } = useContentMediaAssets(currentWorkspaceId);

  const [businessContext, setBusinessContext] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState<string>("");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [assetPurpose, setAssetPurpose] = useState<AssetPurpose | null>(null);
  const [referencePreferences, setReferencePreferences] = useState<ReferencePreferences>(DEFAULT_REFERENCE_PREFERENCES);
  const [variants, setVariants] = useState<CreativeVariant[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const selectedAsset = mediaAssets?.find((asset) => asset.id === selectedAssetId) ?? null;
  const missingBusinessContext = !businessContext.trim();

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

  async function handleGenerate() {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Creative Studio</h1>
        <p className="text-sm text-muted-foreground">AI-assisted copy and headlines, then batch-rendered image adverts in every Meta format.</p>
      </div>

      {!canGenerate ? (
        <EmptyState icon={Palette} title="You don't have access to Creative Studio" description="Ask a workspace admin for content creation access." className="min-h-[40vh]" />
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Describe what you're advertising</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label htmlFor="creative-business-context" className="mb-1 block text-sm font-medium">What is the product or service? <span aria-hidden="true">*</span></label>
                <Textarea
                  id="creative-business-context"
                  placeholder="e.g. A weekend baking course for beginners, hosted in Cape Town"
                  value={businessContext}
                  onChange={(e) => setBusinessContext(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  aria-describedby={missingBusinessContext ? "creative-business-context-help" : undefined}
                  aria-invalid={missingBusinessContext}
                />
                {missingBusinessContext && <p id="creative-business-context-help" className="mt-1.5 text-xs text-muted-foreground">Describe the product or service before generating copy.</p>}
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
              {mediaAssets && mediaAssets.length > 0 ? (
                <div>
                  <label className="mb-1 block text-sm font-medium">Attach a Media Library asset (optional)</label>
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
              <Button onClick={handleGenerate} disabled={missingBusinessContext || isGenerating} aria-describedby={missingBusinessContext ? "creative-business-context-help" : undefined}>
                {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Generate copy
              </Button>
            </CardContent>
          </Card>

          {variants && variants.length === 0 && (
            <EmptyState icon={Sparkles} title="No variations generated" description="Try adding more detail about what you're advertising." className="min-h-[20vh]" />
          )}

          {variants && variants.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

          {!variants && !isGenerating && (
            <EmptyState
              icon={Sparkles}
              title="Ready when you are"
              description="Describe your product or service above and generate a few starting points - headlines, primary text, descriptions, and a call-to-action, ready to copy or use in a new campaign."
              className="min-h-[20vh]"
            />
          )}

          {currentWorkspaceId && (
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
            />
          )}
        </>
      )}
    </div>
  );
}
