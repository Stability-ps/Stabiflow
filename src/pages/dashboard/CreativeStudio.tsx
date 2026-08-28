import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Palette, Sparkles, Copy, Megaphone, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { MediaPreview } from "@/components/content/MediaPreview";
import { useAuth } from "@/hooks/useAuth";
import { useContentMediaAssets } from "@/hooks/useContentMediaAssets";
import { generateCreativeCopy, type CreativeVariant } from "@/lib/creativeStudio";

const TONE_OPTIONS = ["Professional", "Friendly", "Playful", "Bold", "Trustworthy"];

// Creative Studio V1 (post-launch UI polish). Generates ad copy
// variations via a single-shot OpenAI call (creative-studio-generate) -
// read+recommend only, same discipline as Flow AI: nothing here ever
// mutates workspace data on its own. Using a variation elsewhere is
// always an explicit user action:
//  - "Copy" just copies text to the clipboard.
//  - "Use in new campaign" reuses the EXISTING prefill mechanism
//    MediaLibraryGrid's "Promote as Campaign" button already uses
//    (navigate("/campaigns/new", { state: { prefill: ... } })) - no new
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
  const [variants, setVariants] = useState<CreativeVariant[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  async function handleGenerate() {
    if (!currentWorkspaceId || !businessContext.trim()) return;
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
    navigate("/campaigns/new", {
      state: { prefill: { sourceContentMediaAssetId: selectedAssetId || undefined, primaryText: variant.primaryText } },
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Creative Studio</h1>
        <p className="text-sm text-muted-foreground">AI-assisted copy, headlines, and creative variations for your campaigns.</p>
      </div>

      {!canGenerate ? (
        <EmptyState icon={Palette} title="You don't have access to Creative Studio" description="Ask a workspace admin for content creation access." className="min-h-[40vh]" />
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Describe what you're advertising</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">What is the product or service?</label>
                <Textarea
                  placeholder="e.g. A weekend baking course for beginners, hosted in Cape Town"
                  value={businessContext}
                  onChange={(e) => setBusinessContext(e.target.value)}
                  rows={3}
                  maxLength={1000}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">Target audience (optional)</label>
                  <Input placeholder="e.g. Young professionals in their 20s-30s" value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={300} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Tone (optional)</label>
                  <Select value={tone} onValueChange={setTone}>
                    <SelectTrigger><SelectValue placeholder="Any tone" /></SelectTrigger>
                    <SelectContent>
                      {TONE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {mediaAssets && mediaAssets.length > 0 && (
                <div>
                  <label className="mb-1 block text-sm font-medium">Attach a Media Library asset (optional)</label>
                  <div className="flex flex-wrap gap-2">
                    {mediaAssets.slice(0, 8).map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => setSelectedAssetId(selectedAssetId === asset.id ? null : asset.id)}
                        className={`h-14 w-14 overflow-hidden rounded-md border-2 ${selectedAssetId === asset.id ? "border-primary" : "border-transparent"}`}
                        title={asset.title}
                      >
                        <MediaPreview storagePath={asset.storage_path} alt={asset.title} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <Button onClick={handleGenerate} disabled={!businessContext.trim() || isGenerating}>
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
        </>
      )}
    </div>
  );
}
