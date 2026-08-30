import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";
import { DESTINATION_TYPE_LABELS, OBJECTIVE_OPTIONS, getObjectiveOption, type DestinationType, type SupportedObjective } from "@/lib/adObjectives";
import { decimalToMinorUnits, minorUnitsToDecimalString } from "@/lib/adMoney";
import { isEditableCampaign } from "@/lib/campaignLifecycle";
import { localDateTimeToUtc, utcToLocalDateTimeParts, type StartMode } from "@/lib/campaignSchedule";
import {
  checkCampaignReadiness, createCampaignDraft, newPublishIdempotencyKey, publishCampaign,
  syncCampaignReviewStatus, updateCampaignDraft, type AudienceBasics, type ReadinessIssue,
} from "@/lib/adCampaigns";
import { presentReadinessIssue } from "@/lib/readinessIssuePresentation";
import {
  CAMPAIGN_BUILDER_STEPS as STEPS,
  issuesForStep,
  validateCampaignBuilder,
  type CampaignBuilderStep,
} from "@/components/campaigns/campaignBuilderValidation";
import { CAMPAIGN_BUILDER_FIELD_ELEMENT_IDS } from "@/components/campaigns/campaignBuilderFieldFocus";


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
  const [searchParams] = useSearchParams();
  const workspaceTimezone = useWorkspaceTimezone(currentWorkspaceId);
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
  // Scheduling: "Start now" (default - users must never be forced to wait
  // until tomorrow) or a workspace-timezone date + time.
  const [startMode, setStartMode] = useState<StartMode>("now");
  const [startAt, setStartAt] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endAt, setEndAt] = useState("");
  const [endTime, setEndTime] = useState("23:59");
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
  const [pendingFocusFieldId, setPendingFocusFieldId] = useState<string | null>(null);
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
    // Hydrate once for any still-unpublished campaign - draft, or a stale
    // 'ready' the old builder flipped optimistically (no Meta id).
    if (!isEditableCampaign({ status: existing.status, external_campaign_id: existing.external_campaign_id })) return;
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
    // Rehydrate the schedule: stored UTC instant -> workspace-local date +
    // time. A null start_at means the campaign was set to "Start now".
    if (existing.start_at) {
      setStartMode("scheduled");
      const startParts = utcToLocalDateTimeParts(existing.start_at, workspaceTimezone);
      setStartAt(startParts.date);
      setStartTime(startParts.time);
    } else {
      setStartMode("now");
    }
    if (existing.end_at) {
      const endParts = utcToLocalDateTimeParts(existing.end_at, workspaceTimezone);
      setEndAt(endParts.date);
      setEndTime(endParts.time);
    } else {
      setEndAt("");
    }
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
  }, [existing, isEdit, workspaceTimezone]);

  // Deep-link support: Campaign Detail's readiness "Edit <section>" links
  // open /app/campaigns/:id/edit?step=<Step>&focus=<fieldKey>. Jump to the
  // step and queue focusing the exact field once it has mounted - reusing
  // the SAME field-focus machinery as the in-builder readiness buttons.
  const requestedStep = searchParams.get("step");
  const requestedFocus = searchParams.get("focus");
  const appliedDeepLinkRef = useRef(false);
  useEffect(() => {
    if (appliedDeepLinkRef.current) return;
    if (!requestedStep) return;
    if (isEdit && !existing) return; // wait for hydration so we don't fight it
    const targetIndex = STEPS.indexOf(requestedStep as CampaignBuilderStep);
    if (targetIndex < 0) return;
    appliedDeepLinkRef.current = true;
    setStepIndex(targetIndex);
    if (requestedFocus) {
      // A start/end field can only be focused when the schedule is in
      // "scheduled" mode - reveal it if the deep link points there.
      if (requestedFocus === "startAt" || requestedFocus === "startTime" || requestedFocus === "endAt") {
        setStartMode("scheduled");
      }
      setPendingFocusFieldId(CAMPAIGN_BUILDER_FIELD_ELEMENT_IDS[requestedFocus] ?? null);
    }
  }, [requestedStep, requestedFocus, isEdit, existing]);

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

  // A slow ticking "now" so the "scheduled start must be in the future"
  // check re-evaluates while the builder sits open. The server re-checks
  // authoritatively at publish time regardless.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

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
    startMode,
    startAt,
    startTime,
    endAt,
    endTime,
    timezone: workspaceTimezone,
    now,
    mediaAssetId,
    mediaAssetIsUsable: !!selectedMediaAsset,
    primaryText,
    cta,
    allowedCtas: objectiveOption?.allowedCtas.map((option) => option.value) || [],
    destinationUrl,
    whatsappNumberId,
    whatsappNumberIsUsable: activeWhatsappNumbers.some((number) => number.id === whatsappNumberId),
  }), [
    adAccountId, ageMax, ageMin, budgetDecimal, budgetType, cta, destinationType, destinationUrl, endAt, endTime,
    facebookPageId, geoCountryList, igAccounts, instagramAccountId, integration?.id, mediaAssetId, name, now, objective,
    objectiveOption?.allowedCtas, pages, primaryText, selectedAdAccount, selectedMediaAsset, startAt, startMode, startTime,
    whatsappNumberId, workspaceTimezone, activeWhatsappNumbers,
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
      // "Start now" -> start_at = null (the campaign publishes immediately;
      // Meta's ad set is created with no start_time). Otherwise the user's
      // workspace-local date + time is converted to the correct UTC instant.
      const startInstant = startMode === "now" ? null : localDateTimeToUtc(startAt, startTime, workspaceTimezone);
      const endInstant = endAt ? localDateTimeToUtc(endAt, endTime || "23:59", workspaceTimezone) : null;
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
        start_at: startInstant ? startInstant.toISOString() : null,
        end_at: endInstant ? endInstant.toISOString() : null,
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
      const result = await checkCampaignReadiness(savedCampaignId);
      setIssues(result.issues);
      // Reconcile the stored review status with the ACTUAL result:
      // promote to 'ready' only when readiness passes, demote a stale
      // 'ready' back to 'draft' otherwise. Never flips optimistically.
      await syncCampaignReviewStatus(savedCampaignId, result.ready);
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

  // Field-level focus for a readiness issue's "Edit <Step>" action - runs
  // after navigating to the target step, once that step's fields have
  // actually mounted.
  useEffect(() => {
    if (!pendingFocusFieldId) return;
    const raf = requestAnimationFrame(() => {
      const element = document.getElementById(pendingFocusFieldId);
      element?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      element?.focus();
      setPendingFocusFieldId(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [stepIndex, pendingFocusFieldId]);

  const goToReadinessIssue = (issue: ReadinessIssue) => {
    const presentation = presentReadinessIssue(issue);
    if (!presentation.step) return;
    setStepIndex(STEPS.indexOf(presentation.step));
    if (presentation.field === "startAt" || presentation.field === "endAt") {
      setStartMode("scheduled"); // reveal the date/time fields so they can be focused
    }
    const fieldId = presentation.field ? CAMPAIGN_BUILDER_FIELD_ELEMENT_IDS[presentation.field] : undefined;
    setPendingFocusFieldId(fieldId ?? null);
  };

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
  if (isEdit && existing && !isEditableCampaign({ status: existing.status, external_campaign_id: existing.external_campaign_id })) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        This campaign has been published to Meta ({existing.status}) and can't be edited here. Published campaigns support pause/resume only - see the campaign's detail page.
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
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>

            <div className="space-y-2">
              <Label>Start</Label>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="When should this campaign start?">
                <button
                  type="button"
                  aria-pressed={startMode === "now"}
                  onClick={() => setStartMode("now")}
                  className={`rounded-lg border p-3 text-left text-sm transition-colors ${startMode === "now" ? "border-primary bg-primary/5 font-medium" : "hover:bg-accent/40"}`}
                >
                  Start now
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">Publish immediately once readiness passes</span>
                </button>
                <button
                  type="button"
                  aria-pressed={startMode === "scheduled"}
                  onClick={() => setStartMode("scheduled")}
                  className={`rounded-lg border p-3 text-left text-sm transition-colors ${startMode === "scheduled" ? "border-primary bg-primary/5 font-medium" : "hover:bg-accent/40"}`}
                >
                  Schedule for later
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">Pick a date &amp; time, including later today</span>
                </button>
              </div>
              {startMode === "scheduled" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="campaign-start-date">Start date</Label>
                    <Input id="campaign-start-date" type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} aria-invalid={!!fieldIssue("startAt")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="campaign-start-time">Start time</Label>
                    <Input id="campaign-start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-invalid={!!fieldIssue("startAt")} />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">Times are in <span className="font-medium">{workspaceTimezone}</span> (your workspace timezone).</p>
                </div>
              )}
              <FieldError message={fieldIssue("startAt")?.message} />
            </div>

            <div className="space-y-2">
              <Label>End {budgetType === "lifetime" ? "(required for a lifetime budget)" : "(optional)"}</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="campaign-end-date" className="text-xs text-muted-foreground">End date</Label>
                  <Input id="campaign-end-date" type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} aria-invalid={!!fieldIssue("endAt")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="campaign-end-time" className="text-xs text-muted-foreground">End time</Label>
                  <Input id="campaign-end-time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={!endAt} aria-invalid={!!fieldIssue("endAt")} />
                </div>
              </div>
              <FieldError message={fieldIssue("endAt")?.message} />
            </div>
          </CardContent>
        </Card>
      )}

      {step === "Creative" && (
        <Card>
          <CardHeader><CardTitle>Creative</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div id="campaign-media-picker" className="space-y-1.5">
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
                  <Label htmlFor="campaign-destination-url">Destination URL</Label>
                  <Input id="campaign-destination-url" value={destinationUrl} onChange={(e) => setDestinationUrl(e.target.value)} placeholder="https://" aria-invalid={!!fieldIssue("destinationUrl")} />
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
              <div><dt className="text-muted-foreground">Schedule</dt><dd>{startMode === "now" ? "Start now" : `${startAt} ${startTime} (${workspaceTimezone})`}{endAt ? ` - ends ${endAt} ${endTime}` : " - ongoing"}</dd></div>
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
                  <ul className="space-y-2">
                    {issues.map((issue, i) => {
                      const presentation = presentReadinessIssue(issue);
                      return (
                        <li key={i} className={`flex flex-wrap items-start justify-between gap-2 rounded-md border p-2 text-sm ${issue.severity === "error" ? "border-red-200 text-red-700 dark:border-red-900 dark:text-red-400" : "border-amber-200 text-amber-700 dark:border-amber-900 dark:text-amber-400"}`}>
                          <span className="flex items-start gap-2">
                            {issue.severity === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                            {presentation.message}
                          </span>
                          {presentation.step && (
                            <Button type="button" variant="outline" size="sm" onClick={() => goToReadinessIssue(issue)}>
                              Edit {presentation.step}
                            </Button>
                          )}
                        </li>
                      );
                    })}
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
                      <Button variant="outline" size="sm" onClick={() => navigate(`/app/campaigns/${savedCampaignId}`)}>View campaign</Button>
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
