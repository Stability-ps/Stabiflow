import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MediaPreview } from "@/components/content/MediaPreview";
import { useAuth } from "@/hooks/useAuth";
import { useMetaAdAccounts, useMetaFacebookPages, useMetaInstagramAccounts, useMetaIntegration } from "@/hooks/useMetaAccountResources";
import { useAllWhatsAppNumbers } from "@/hooks/useIntegrations";
import { useContentMediaAssets } from "@/hooks/useContentMediaAssets";
import { useAdCampaign } from "@/hooks/useAdCampaign";
import { DESTINATION_TYPE_LABELS, OBJECTIVE_OPTIONS, getObjectiveOption, type DestinationType, type SupportedObjective } from "@/lib/adObjectives";
import { decimalToMinorUnits, minorUnitsToDecimalString } from "@/lib/adMoney";
import {
  checkCampaignReadiness, createCampaignDraft, markCampaignReadyForReview, newPublishIdempotencyKey, publishCampaign,
  updateCampaignDraft, type AudienceBasics, type ReadinessIssue,
} from "@/lib/adCampaigns";
import {
  CAMPAIGN_BUILDER_STEPS as STEPS,
  issuesForStep,
  validateCampaignBuilder,
  type CampaignBuilderStep,
} from "@/components/campaigns/campaignBuilderValidation";

export type CampaignBuilderPrefill = {
  sourceContentMediaAssetId?: string;
  primaryText?: string;
};

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive" role="alert">{message}</p> : null;
}

export function CampaignBuilder({ campaignId, prefill }: { campaignId?: string; prefill?: CampaignBuilderPrefill }) {
  const { currentWorkspaceId } = useAuth();
  const navigate = useNavigate();
  const isEdit = !!campaignId;

  const { data: existing, isLoading: existingLoading } = useAdCampaign(campaignId ?? null);
  const { data: integration } = useMetaIntegration(currentWorkspaceId);
  const { data: adAccounts } = useMetaAdAccounts(currentWorkspaceId);
  const { data: pages } = useMetaFacebookPages(currentWorkspaceId);
  const { data: igAccounts } = useMetaInstagramAccounts(currentWorkspaceId);
  const { data: mediaAssets, isLoading: mediaAssetsLoading, isError: mediaAssetsError } = useContentMediaAssets(currentWorkspaceId);
  const { data: whatsappNumbers } = useAllWhatsAppNumbers(currentWorkspaceId);
  const activeWhatsappNumbers = useMemo(() => (whatsappNumbers || []).filter((number) => number.is_active), [whatsappNumbers]);

  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState<SupportedObjective | "">("");
  const [adAccountId, setAdAccountId] = useState("");
  const [facebookPageId, setFacebookPageId] = useState("");
  const [instagramAccountId, setInstagramAccountId] = useState("");
  const [destinationType, setDestinationType] = useState<DestinationType | "">("");
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [genders, setGenders] = useState<AudienceBasics["genders"]>("all");
  const [geoCountries, setGeoCountries] = useState("ZA");
  const [budgetType, setBudgetType] = useState<"daily" | "lifetime">("daily");
  const [budgetDecimal, setBudgetDecimal] = useState("100.00");
  const [startAt, setStartAt] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [endAt, setEndAt] = useState("");
  const [mediaAssetId, setMediaAssetId] = useState(prefill?.sourceContentMediaAssetId || "");
  const [headline, setHeadline] = useState("");
  const [primaryText, setPrimaryText] = useState(prefill?.primaryText || "");
  const [description, setDescription] = useState("");
  const [cta, setCta] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [whatsappNumberId, setWhatsappNumberId] = useState("");
  const [mediaPickerOpen, setMediaPickerOpen] = useState(!prefill?.sourceContentMediaAssetId);
  const [attemptedSteps, setAttemptedSteps] = useState<Set<CampaignBuilderStep>>(() => new Set());

  const [savedCampaignId, setSavedCampaignId] = useState<string | null>(campaignId ?? null);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<ReadinessIssue[] | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ ok: boolean; outcome?: string; steps?: Array<{ step: string; status: string }>; message?: string } | null>(null);
  const idempotencyKeyRef = useRef<string>(newPublishIdempotencyKey());

  const selectedAdAccount = adAccounts?.find((a) => a.id === adAccountId) || null;
  const objectiveOption = objective ? getObjectiveOption(objective) : undefined;
  const usableMediaAssets = useMemo(
    () => (mediaAssets || []).filter((asset) => asset.mime_type === "image/jpeg" || asset.mime_type === "image/png"),
    [mediaAssets],
  );
  const selectedMediaAsset = usableMediaAssets.find((asset) => asset.id === mediaAssetId) || null;

  useEffect(() => {
    if (!existing || !isEdit) return;
    if (existing.status !== "draft") return; // populated once; edit guard handled by parent page
    setName(existing.name);
    setObjective(existing.objective as SupportedObjective);
    setAdAccountId(existing.ad_account_id);
    setFacebookPageId(existing.facebook_page_id || "");
    setInstagramAccountId(existing.instagram_account_id || "");
    setDestinationType(existing.destination_type as DestinationType);
    const audience = (existing.audience as AudienceBasics) || {};
    setAgeMin(audience.age_min ?? 18);
    setAgeMax(audience.age_max ?? 65);
    setGenders(audience.genders ?? "all");
    setGeoCountries((audience.geo_countries || ["ZA"]).join(","));
    setBudgetType(existing.budget_type as "daily" | "lifetime");
    setBudgetDecimal(minorUnitsToDecimalString(existing.budget_type === "daily" ? existing.daily_budget_minor_units : existing.lifetime_budget_minor_units) || "100.00");
    setStartAt(existing.start_at.slice(0, 10));
    setEndAt(existing.end_at ? existing.end_at.slice(0, 10) : "");
    const creative = existing.ad_creatives as unknown as { media_asset_id: string; headline: string | null; primary_text: string; description: string | null; cta: string; destination_url: string | null; whatsapp_number_id: string | null } | null;
    if (creative) {
      setMediaAssetId(creative.media_asset_id);
      setMediaPickerOpen(false);
      setHeadline(creative.headline || "");
      setPrimaryText(creative.primary_text);
      setDescription(creative.description || "");
      setCta(creative.cta);
      setDestinationUrl(creative.destination_url || "");
      setWhatsappNumberId(creative.whatsapp_number_id || "");
    }
  }, [existing, isEdit]);

  useEffect(() => {
    if (selectedAdAccount && !objectiveOption?.allowedDestinationTypes.includes(destinationType as DestinationType)) {
      setDestinationType(objectiveOption?.allowedDestinationTypes[0] || "");
    }
    if (cta && !objectiveOption?.allowedCtas.some((option) => option.value === cta)) {
      setCta("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objective]);

  const geoCountryList = useMemo(() => geoCountries.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean), [geoCountries]);

  const validationIssues = useMemo(() => validateCampaignBuilder({
    name,
    objective,
    integrationId: integration?.id || null,
    adAccountId,
    adAccountIsUsable: !!selectedAdAccount,
    facebookPageId,
    instagramAccountId,
    pageOrInstagramIsUsable: !!pages?.some((page) => page.id === facebookPageId) || !!igAccounts?.some((account) => account.id === instagramAccountId),
    destinationType,
    ageMin,
    ageMax,
    geoCountries: geoCountryList,
    budgetType,
    budgetDecimal,
    startAt,
    endAt,
    mediaAssetId,
    mediaAssetIsUsable: !!selectedMediaAsset,
    primaryText,
    cta,
    allowedCtas: objectiveOption?.allowedCtas.map((option) => option.value) || [],
    destinationUrl,
    whatsappNumberId,
    whatsappNumberIsUsable: activeWhatsappNumbers.some((number) => number.id === whatsappNumberId),
  }), [
    adAccountId, ageMax, ageMin, budgetDecimal, budgetType, cta, destinationType, destinationUrl, endAt,
    facebookPageId, geoCountryList, igAccounts, instagramAccountId, integration?.id, mediaAssetId, name, objective,
    objectiveOption?.allowedCtas, pages, primaryText, selectedAdAccount, selectedMediaAsset, startAt, whatsappNumberId,
    activeWhatsappNumbers,
  ]);

  const canSaveDraft = validationIssues.length === 0;

  const handleSaveDraft = async () => {
    if (!canSaveDraft) {
      setAttemptedSteps(new Set(STEPS.slice(0, STEPS.indexOf("Review"))));
      toast.error("Complete the missing campaign details before creating the draft.");
      return;
    }
    if (!currentWorkspaceId || !integration || !selectedAdAccount || !objective || !destinationType) return;
    setSaving(true);
    try {
      const minorUnits = decimalToMinorUnits(Number(budgetDecimal));
      const campaignInput = {
        workspace_id: currentWorkspaceId,
        integration_id: integration.id,
        ad_account_id: adAccountId,
        facebook_page_id: facebookPageId || null,
        instagram_account_id: instagramAccountId || null,
        name: name.trim(),
        objective,
        destination_type: destinationType,
        budget_type: budgetType,
        daily_budget_minor_units: budgetType === "daily" ? minorUnits : null,
        lifetime_budget_minor_units: budgetType === "lifetime" ? minorUnits : null,
        currency: selectedAdAccount.currency || "ZAR",
        start_at: new Date(`${startAt}T00:00:00`).toISOString(),
        end_at: endAt ? new Date(`${endAt}T23:59:59`).toISOString() : null,
        audience: { age_min: ageMin, age_max: ageMax, genders, geo_countries: geoCountryList },
        source_content_media_asset_id: prefill?.sourceContentMediaAssetId || null,
      };
      const creativeInput = {
        workspace_id: currentWorkspaceId,
        media_asset_id: mediaAssetId,
        headline: headline.trim() || null,
        primary_text: primaryText.trim(),
        description: description.trim() || null,
        cta,
        destination_url: destinationType === "website" ? destinationUrl.trim() : null,
        whatsapp_number_id: destinationType === "whatsapp" ? whatsappNumberId : null,
      };

      if (savedCampaignId) {
        await updateCampaignDraft(savedCampaignId, campaignInput, existing?.draft_creative_id ?? null, creativeInput);
      } else {
        const result = await createCampaignDraft(campaignInput, creativeInput);
        setSavedCampaignId(result.campaignId);
      }
      toast.success("Draft saved");
      setStepIndex(STEPS.indexOf("Publish"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save draft");
    } finally {
      setSaving(false);
    }
  };

  const runReadinessCheck = async () => {
    if (!savedCampaignId) return;
    setCheckingReadiness(true);
    try {
      await markCampaignReadyForReview(savedCampaignId);
      const result = await checkCampaignReadiness(savedCampaignId);
      setIssues(result.issues);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to check readiness");
    } finally {
      setCheckingReadiness(false);
    }
  };

  useEffect(() => {
    if (stepIndex === STEPS.indexOf("Publish") && savedCampaignId && issues === null) {
      runReadinessCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, savedCampaignId]);

  const ready = issues !== null && issues.every((i) => i.severity !== "error");

  const handlePublish = async () => {
    if (!savedCampaignId) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      const result = await publishCampaign(savedCampaignId, idempotencyKeyRef.current);
      setPublishResult({ ok: result.ok, outcome: result.outcome, steps: result.operation?.steps, message: result.error });
      if (result.ok) toast.success("Campaign published to Meta");
      else if (result.outcome === "partial") toast.warning("Campaign partially published - see details below");
      else toast.error(result.error || "Publish failed");
    } catch (error) {
      setPublishResult({ ok: false, message: error instanceof Error ? error.message : "Publish failed" });
      toast.error(error instanceof Error ? error.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  if (isEdit && existingLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  if (isEdit && existing && existing.status !== "draft") {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        This campaign is no longer a draft ({existing.status}) and can't be edited here. Published campaigns support pause/resume only - see the campaign's detail page.
      </Card>
    );
  }

  const step = STEPS[stepIndex];
  const currentStepIssues = issuesForStep(validationIssues, step);
  const visibleCurrentStepIssues = attemptedSteps.has(step) ? currentStepIssues : [];
  const fieldIssue = (field: string) => visibleCurrentStepIssues.find((issue) => issue.field === field);

  const markStepAttempted = (attemptedStep: CampaignBuilderStep) => {
    setAttemptedSteps((previous) => new Set(previous).add(attemptedStep));
  };

  const handleNext = () => {
    markStepAttempted(step);
    if (currentStepIssues.length > 0) {
      const issue = currentStepIssues[0];
      toast.error(issue.message);
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const handleStepNavigation = (targetIndex: number) => {
    if (targetIndex <= stepIndex) {
      setStepIndex(targetIndex);
      return;
    }

    const lastValidatedIndex = Math.min(targetIndex - 1, STEPS.indexOf("Creative"));
    for (let index = 0; index <= lastValidatedIndex; index += 1) {
      const candidateStep = STEPS[index];
      const candidateIssues = issuesForStep(validationIssues, candidateStep);
      if (candidateIssues.length > 0) {
        markStepAttempted(candidateStep);
        setStepIndex(index);
        toast.error(candidateIssues[0].message);
        return;
      }
    }

    setStepIndex(targetIndex);
  };

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-1 border-b pb-2">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            disabled={s === "Publish" && !savedCampaignId}
            onClick={() => handleStepNavigation(i)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              i === stepIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {i + 1}. {s}
          </button>
        ))}
      </nav>

      {step === "Goal" && (
        <Card>
          <CardHeader><CardTitle>What's the goal of this campaign?</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-name">Campaign name</Label>
              <Input
                id="campaign-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Spring launch"
                aria-invalid={!!fieldIssue("name")}
              />
              <FieldError message={fieldIssue("name")?.message} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {OBJECTIVE_OPTIONS.map((o) => (
                <button
                  key={o.objective}
                  type="button"
                  onClick={() => setObjective(o.objective)}
                  className={`rounded-lg border p-4 text-left transition-colors ${objective === o.objective ? "border-primary bg-primary/5" : "hover:bg-accent/40"}`}
                >
                  <p className="font-medium">{o.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{o.description}</p>
                </button>
              ))}
            </div>
            <FieldError message={fieldIssue("objective")?.message} />
          </CardContent>
        </Card>
      )}

      {step === "Ad Account" && (
        <Card>
          <CardHeader><CardTitle>Which Meta Ad Account and page?</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <FieldError message={fieldIssue("integration")?.message} />
            <div className="space-y-1.5">
              <Label htmlFor="campaign-ad-account">Meta Ad Account</Label>
              <Select value={adAccountId} onValueChange={setAdAccountId}>
                <SelectTrigger id="campaign-ad-account"><SelectValue placeholder="Choose an ad account" /></SelectTrigger>
                <SelectContent>
                  {(adAccounts || []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name || a.ad_account_id} ({a.currency || "?"})</SelectItem>)}
                </SelectContent>
              </Select>
              <FieldError message={fieldIssue("adAccountId")?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-facebook-page">Facebook Page</Label>
              <Select value={facebookPageId} onValueChange={setFacebookPageId}>
                <SelectTrigger id="campaign-facebook-page"><SelectValue placeholder="Choose a Page" /></SelectTrigger>
                <SelectContent>
                  {(pages || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.page_name || p.page_id}</SelectItem>)}
                </SelectContent>
              </Select>
              <FieldError message={fieldIssue("pageOrInstagram")?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-instagram-account">Instagram account (optional)</Label>
              <Select value={instagramAccountId} onValueChange={setInstagramAccountId}>
                <SelectTrigger id="campaign-instagram-account"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {(igAccounts || []).map((a) => <SelectItem key={a.id} value={a.id}>{a.username ? `@${a.username}` : a.ig_business_account_id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {objectiveOption && (
              <div className="space-y-1.5">
                <Label htmlFor="campaign-destination">Destination</Label>
                <Select value={destinationType} onValueChange={(v) => setDestinationType(v as DestinationType)}>
                  <SelectTrigger id="campaign-destination"><SelectValue placeholder="Choose a destination" /></SelectTrigger>
                  <SelectContent>
                    {objectiveOption.allowedDestinationTypes.map((d) => (
                      <SelectItem key={d} value={d}>{DESTINATION_TYPE_LABELS[d]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={fieldIssue("destinationType")?.message} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === "Audience" && (
        <Card>
          <CardHeader><CardTitle>Who should see this ad?</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="audience-age-min">Minimum age</Label>
                <Input id="audience-age-min" type="number" min={13} max={65} value={ageMin} onChange={(e) => setAgeMin(Number(e.target.value))} aria-invalid={!!fieldIssue("ageMin") || !!fieldIssue("ageRange")} />
                <FieldError message={fieldIssue("ageMin")?.message || fieldIssue("ageRange")?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="audience-age-max">Maximum age</Label>
                <Input id="audience-age-max" type="number" min={13} max={65} value={ageMax} onChange={(e) => setAgeMax(Number(e.target.value))} aria-invalid={!!fieldIssue("ageMax") || !!fieldIssue("ageRange")} />
                <FieldError message={fieldIssue("ageMax")?.message || fieldIssue("ageRange")?.message} />
              </div>
              <div className="space-y-1.5">
                <Label>Gender</Label>
                <Select value={genders} onValueChange={(v) => setGenders(v as AudienceBasics["genders"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="audience-countries">Countries (comma-separated ISO codes)</Label>
                <Input id="audience-countries" value={geoCountries} onChange={(e) => setGeoCountries(e.target.value)} placeholder="ZA, NA" aria-invalid={!!fieldIssue("geoCountries")} />
                <FieldError message={fieldIssue("geoCountries")?.message} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "Budget & Schedule" && (
        <Card>
          <CardHeader><CardTitle>Budget and schedule</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-budget-type">Budget type</Label>
              <Select value={budgetType} onValueChange={(v) => setBudgetType(v as "daily" | "lifetime")}>
                <SelectTrigger id="campaign-budget-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily budget</SelectItem>
                  <SelectItem value="lifetime">Lifetime budget</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-budget">{budgetType === "daily" ? "Daily" : "Lifetime"} budget ({selectedAdAccount?.currency || "?"})</Label>
              <Input id="campaign-budget" type="number" min={1} step="0.01" value={budgetDecimal} onChange={(e) => setBudgetDecimal(e.target.value)} aria-invalid={!!fieldIssue("budgetDecimal")} />
              <FieldError message={fieldIssue("budgetDecimal")?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-start-date">Start date</Label>
              <Input id="campaign-start-date" type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} aria-invalid={!!fieldIssue("startAt")} />
              <FieldError message={fieldIssue("startAt")?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-end-date">End date {budgetType === "lifetime" ? "(required)" : "(optional)"}</Label>
              <Input id="campaign-end-date" type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} aria-invalid={!!fieldIssue("endAt")} />
              <FieldError message={fieldIssue("endAt")?.message} />
            </div>
          </CardContent>
        </Card>
      )}

      {step === "Creative" && (
        <Card>
          <CardHeader><CardTitle>Creative</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Media (from your Media Library)</Label>
              {selectedMediaAsset ? (
                <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
                  <MediaPreview storagePath={selectedMediaAsset.storage_path} alt={selectedMediaAsset.title} className="h-16 w-16 shrink-0 rounded-md object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{selectedMediaAsset.title}</p>
                    <p className="text-xs text-muted-foreground">{selectedMediaAsset.mime_type || "Media asset"}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => {
                      setMediaAssetId("");
                      setMediaPickerOpen(true);
                    }}>Remove</Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setMediaPickerOpen((open) => !open)}>
                      {mediaPickerOpen ? "Close library" : "Change media"}
                    </Button>
                  </div>
                </div>
              ) : null}
              {(mediaPickerOpen || !selectedMediaAsset) && (
                <div className="space-y-3">
                  {mediaAssetsLoading ? (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Loading media library">
                      {Array.from({ length: 6 }).map((_, index) => <div key={index} className="aspect-square animate-pulse rounded-md bg-muted" />)}
                    </div>
                  ) : mediaAssetsError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
                      The Media Library could not be loaded. Refresh the page and try again.
                    </div>
                  ) : usableMediaAssets.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                      {(mediaAssets || []).length === 0
                        ? "No media in this workspace yet. Upload a JPEG or PNG image in the Media Library, then return here."
                        : "No supported campaign images are available. Add a JPEG or PNG image in the Media Library, then return here."}
                      <div className="mt-3">
                        <Button type="button" variant="outline" size="sm" onClick={() => navigate("/app/content/media-library")}>Open Media Library</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="listbox" aria-label="Media Library">
                      {usableMediaAssets.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          role="option"
                          aria-selected={mediaAssetId === m.id}
                          onClick={() => {
                            setMediaAssetId(m.id);
                            setMediaPickerOpen(false);
                          }}
                          className={`overflow-hidden rounded-md border-2 transition-colors ${mediaAssetId === m.id ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/60"}`}
                          aria-label={`Select ${m.title}`}
                          title={m.title}
                        >
                          <MediaPreview storagePath={m.storage_path} alt={m.title} className="aspect-square w-full" />
                          <div className="bg-background/90 px-2 py-1 text-[10px] text-muted-foreground truncate">{m.title}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <FieldError message={fieldIssue("mediaAssetId")?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="creative-primary-text">Primary text</Label>
              <Textarea id="creative-primary-text" value={primaryText} onChange={(e) => setPrimaryText(e.target.value)} maxLength={2000} rows={3} placeholder="Write your ad copy..." aria-invalid={!!fieldIssue("primaryText")} />
              <FieldError message={fieldIssue("primaryText")?.message} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="creative-headline">Headline (optional)</Label>
                <Input id="creative-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={255} placeholder="Headline" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="creative-description">Description (optional)</Label>
                <Input id="creative-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} placeholder="Description" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="campaign-cta">Call to action</Label>
                <Select value={cta} onValueChange={setCta}>
                  <SelectTrigger id="campaign-cta"><SelectValue placeholder="Choose a CTA" /></SelectTrigger>
                  <SelectContent>
                    {(objectiveOption?.allowedCtas || []).map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FieldError message={fieldIssue("cta")?.message} />
              </div>
              {destinationType === "website" && (
                <div className="space-y-1.5">
                  <Label>Destination URL</Label>
                  <Input value={destinationUrl} onChange={(e) => setDestinationUrl(e.target.value)} placeholder="https://" aria-invalid={!!fieldIssue("destinationUrl")} />
                  <FieldError message={fieldIssue("destinationUrl")?.message} />
                </div>
              )}
              {destinationType === "whatsapp" && (
                <div className="space-y-1.5">
                  <Label htmlFor="campaign-whatsapp-number">WhatsApp number</Label>
                  <Select value={whatsappNumberId} onValueChange={setWhatsappNumberId}>
                    <SelectTrigger id="campaign-whatsapp-number"><SelectValue placeholder="Choose a WhatsApp number" /></SelectTrigger>
                    <SelectContent>
                      {activeWhatsappNumbers.map((n) => (
                        <SelectItem key={n.id} value={n.id}>{n.display_phone_number || n.phone_number_id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError message={fieldIssue("whatsappNumberId")?.message} />
                  {activeWhatsappNumbers.length === 0 && (
                    <p className="text-xs text-muted-foreground">No active WhatsApp number is connected for this workspace. Connect one in Integrations first.</p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {step === "Review" && (
        <Card>
          <CardHeader><CardTitle>Review</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {validationIssues.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="font-medium">This draft is incomplete.</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {validationIssues.map((issue) => (
                    <li key={issue.code}>
                      <button type="button" className="text-left underline underline-offset-2" onClick={() => {
                        markStepAttempted(issue.step);
                        setStepIndex(Math.max(0, issue.stepIndex));
                      }}>
                        {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Campaign name</dt><dd>{name || "-"}</dd></div>
              <div><dt className="text-muted-foreground">Objective</dt><dd>{objectiveOption?.label || "-"}</dd></div>
              <div><dt className="text-muted-foreground">Ad account</dt><dd>{selectedAdAccount?.name || selectedAdAccount?.ad_account_id || "-"}</dd></div>
              <div><dt className="text-muted-foreground">Destination</dt><dd>{destinationType ? DESTINATION_TYPE_LABELS[destinationType] : "-"}{destinationUrl ? ` — ${destinationUrl}` : ""}</dd></div>
              <div><dt className="text-muted-foreground">Audience</dt><dd>{ageMin}-{ageMax}, {genders}, {geoCountryList.join(", ") || "-"}</dd></div>
              <div><dt className="text-muted-foreground">Budget</dt><dd>{budgetDecimal} {selectedAdAccount?.currency} ({budgetType})</dd></div>
              <div><dt className="text-muted-foreground">Schedule</dt><dd>{startAt} {endAt ? `- ${endAt}` : "- ongoing"}</dd></div>
            </dl>
            {selectedMediaAsset && (
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Selected creative</p>
                <div className="flex items-center gap-3">
                  <MediaPreview storagePath={selectedMediaAsset.storage_path} alt={selectedMediaAsset.title} className="h-16 w-16 shrink-0 rounded-md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{selectedMediaAsset.title}</p>
                    <p className="text-xs text-muted-foreground">{selectedMediaAsset.mime_type || "Media asset"}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Creative summary</p>
              <div className="space-y-2 text-sm">
                <div><span className="font-medium">Primary text:</span> {primaryText || "-"}</div>
                <div><span className="font-medium">Headline:</span> {headline || "-"}</div>
                <div><span className="font-medium">Description:</span> {description || "-"}</div>
                <div><span className="font-medium">CTA:</span> {objectiveOption?.allowedCtas.find((option) => option.value === cta)?.label || cta || "-"}</div>
              </div>
            </div>
            <Button onClick={handleSaveDraft} disabled={!canSaveDraft || saving} className="w-full">
              {saving ? "Saving..." : isEdit || savedCampaignId ? "Save Draft" : "Create Draft"}
            </Button>
            {!canSaveDraft && <p className="text-xs text-muted-foreground">Review the missing items above and return to the relevant step to complete the draft.</p>}
            <p className="text-xs text-muted-foreground">Nothing is sent to Meta until you explicitly publish.</p>
          </CardContent>
        </Card>
      )}

      {step === "Publish" && (
        <Card>
          <CardHeader><CardTitle>Readiness &amp; publish</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!savedCampaignId && <p className="text-sm text-muted-foreground">Save the draft in the Review step first.</p>}
            {savedCampaignId && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Readiness check</p>
                  <Button variant="outline" size="sm" onClick={runReadinessCheck} disabled={checkingReadiness}>
                    {checkingReadiness ? <Loader2 className="h-4 w-4 animate-spin" /> : "Re-check"}
                  </Button>
                </div>
                {issues && issues.length === 0 && (
                  <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Ready to publish.</p>
                )}
                {issues && issues.length > 0 && (
                  <ul className="space-y-1">
                    {issues.map((issue, i) => (
                      <li key={i} className={`flex items-start gap-2 text-sm ${issue.severity === "error" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
                        {issue.severity === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="text-xs text-muted-foreground">
                  Publishing sends this campaign to Meta as PAUSED objects first, then activates it once every object (campaign, ad set, creative, ad) is created successfully.
                  StabiFlow does not promise Meta will approve this ad - review can still reject or pause delivery after publishing.
                </p>
                <Button onClick={handlePublish} disabled={!ready || publishing} className="w-full">
                  {publishing ? "Publishing..." : "Publish to Meta"}
                </Button>

                {publishResult && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className={`text-sm font-medium ${publishResult.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                      {publishResult.ok ? "Published successfully" : publishResult.outcome === "partial" ? "Partially published" : publishResult.message || "Publish failed"}
                    </p>
                    {publishResult.steps && (
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {publishResult.steps.map((s, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <Badge variant={s.status === "success" ? "default" : "destructive"} className="text-[10px]">{s.status}</Badge>
                            {s.step}
                          </li>
                        ))}
                      </ul>
                    )}
                    {savedCampaignId && (
                      <Button variant="outline" size="sm" onClick={() => navigate(`/campaigns/${savedCampaignId}`)}>View campaign</Button>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" disabled={stepIndex === 0} onClick={() => setStepIndex((i) => i - 1)}>Back</Button>
        {stepIndex < STEPS.indexOf("Review") && <Button onClick={handleNext}>Next</Button>}
      </div>
    </div>
  );
}
