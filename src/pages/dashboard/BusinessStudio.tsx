import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Download, Globe, Loader2, Lock, PenLine, Sparkles, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ProposalReview } from "@/components/business/ProposalReview";
import { ProfilePreview } from "@/components/business/ProfilePreview";
import { useAuth } from "@/hooks/useAuth";
import { computeCompleteness, fetchBusinessIdentity, updateBusinessIdentity } from "@/lib/businessIdentity";
import { fetchCatalog, formatMoney, startCheckout } from "@/lib/billing";
import {
  BusinessStudioError, extractFromText, fetchPendingProposals, fetchPreview, generateDocument, improveWording, scanWebsite, type ScanResult,
} from "@/lib/businessStudio";

const STEPS = ["Start", "Review", "Fill the gaps", "Wording", "Design", "Preview & download"] as const;

export default function BusinessStudio() {
  const { currentWorkspaceId: ws, currentMembership, hasPermission } = useAuth();
  const canEdit = currentMembership?.role === "owner" || currentMembership?.role === "admin";
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [tone, setTone] = useState("professional");
  const [templateKey, setTemplateKey] = useState("classic");
  const [studioDraft, setStudioDraft] = useState<Record<string, string>>({});

  const identity = useQuery({ queryKey: ["business-identity", ws], queryFn: () => fetchBusinessIdentity(ws as string), enabled: !!ws });
  const pending = useQuery({ queryKey: ["fact-proposals", ws], queryFn: () => fetchPendingProposals(ws as string), enabled: !!ws });
  const preview = useQuery({ queryKey: ["bs-preview", ws, step], queryFn: () => fetchPreview(ws as string), enabled: !!ws && step >= 4 });
  const catalog = useQuery({ queryKey: ["billing-catalog"], queryFn: fetchCatalog, enabled: step >= 5, staleTime: 5 * 60_000 });

  const completeness = useMemo(() => (identity.data ? computeCompleteness(identity.data) : null), [identity.data]);
  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["fact-proposals", ws] });
    qc.invalidateQueries({ queryKey: ["business-identity", ws] });
  };
  const handleError = (e: Error) => {
    toast.error(e.message);
    if (e instanceof BusinessStudioError && e.code === "limit_reached") toast.info("See Billing for plans with more allowance.");
  };
  const draftValue = (key: string, fallback: unknown) => studioDraft[key] ?? (typeof fallback === "string" ? fallback : "");
  const saveStudioDetails = useMutation({
    mutationFn: async () => {
      if (!identity.data) throw new Error("Business details are still loading.");
      await updateBusinessIdentity(identity.data.identity, {
        legal_name: draftValue("legal_name", identity.data.identity.legal_name) || null,
        industry: draftValue("industry", identity.data.identity.industry) || null,
        website: draftValue("website", identity.data.identity.website) || null,
        short_description: draftValue("short_description", identity.data.identity.short_description) || null,
        long_description: draftValue("long_description", identity.data.identity.long_description) || null,
        mission: draftValue("mission", identity.data.identity.mission) || null,
        vision: draftValue("vision", identity.data.identity.vision) || null,
      });
    },
    onSuccess: () => { setStudioDraft({}); refreshAll(); qc.invalidateQueries({ queryKey: ["bs-preview", ws] }); toast.success("Business details updated"); },
    onError: handleError,
  });

  const scanMutation = useMutation({
    mutationFn: () => scanWebsite(ws as string, url),
    onSuccess: (r) => {
      setScan(r);
      refreshAll();
      setStep(1);
    },
    onError: handleError,
  });
  const pasteMutation = useMutation({
    mutationFn: () => extractFromText(ws as string, pasted),
    onSuccess: (r) => {
      toast.success(`${r.proposalsCreated} details found in your profile text`);
      refreshAll();
      setStep(1);
    },
    onError: handleError,
  });
  const wordingMutation = useMutation({
    mutationFn: () => improveWording(ws as string, tone),
    onSuccess: (r) => {
      toast.success(r.suggestions ? `${r.suggestions} suggestion${r.suggestions === 1 ? "" : "s"} ready to review` : "Your wording already reads well - no changes suggested");
      refreshAll();
    },
    onError: handleError,
  });
  const docMutation = useMutation({
    mutationFn: () => generateDocument(ws as string, templateKey),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["business-documents", ws] });
      toast.success(r.document.watermarked ? "Preview PDF saved to Documents" : "Your company profile is ready");
      if (r.url) window.open(r.url, "_blank", "noopener");
    },
    onError: handleError,
  });
  const buy = useMutation({
    mutationFn: (priceId: string) => startCheckout(ws as string, priceId),
    onSuccess: (r) => window.location.assign(r.authorization_url),
    onError: handleError,
  });

  if (!ws) return null;
  const pendingReview = (pending.data ?? []).filter((p) => p.origin === "website_scan" || p.origin === "document_upload");
  const templates = preview.data?.templates ?? [];
  const teaserStudio = preview.data?.accessMode === "teaser";
  const template = templates.find((t) => t.key === templateKey) ?? templates[0];
  const templateLocked = !!template?.is_premium && !preview.data?.canUsePremium;
  const oneOff = (catalog.data ?? []).find((p) => p.plan_kind === "one_off");
  const oneOffPrice = oneOff?.prices.find((p) => p.billing_interval === "once");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="rounded-3xl border border-sky-100/80 bg-gradient-to-br from-white via-white to-sky-50/65 p-5 shadow-[0_18px_60px_-44px_hsl(213_70%_40%/0.28)] sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Profile builder</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Business Studio</h1>
        <p className="text-sm text-muted-foreground">Turn your website into a professional company profile. You check every fact before it's used.</p>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={`rounded-full border px-3 py-1 ${i === step ? "border-primary bg-primary text-primary-foreground" : i < step ? "border-primary/40" : "text-muted-foreground"}`}
            >
              {i < step && <Check className="mr-1 inline h-3 w-3" />}
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      {!canEdit && <p className="text-sm text-muted-foreground">Only workspace owners and admins can build the company profile. You can view the preview.</p>}

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How would you like to start?</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="website">
              <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="website"><Globe className="mr-1 h-4 w-4" /> From my website</TabsTrigger>
                <TabsTrigger value="scratch"><PenLine className="mr-1 h-4 w-4" /> Start from scratch</TabsTrigger>
                <TabsTrigger value="upload"><Upload className="mr-1 h-4 w-4" /> Existing profile</TabsTrigger>
              </TabsList>
              <TabsContent value="website" className="space-y-3 pt-4">
                <Label htmlFor="bs-url">Your website address</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input id="bs-url" inputMode="url" placeholder="www.yourbusiness.co.za" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.trim() && canEdit && scanMutation.mutate()} />
                  <Button onClick={() => scanMutation.mutate()} disabled={!url.trim() || !canEdit || scanMutation.isPending}>
                    {scanMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4" />}
                    {scanMutation.isPending ? "Reading your website..." : "Scan my website"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">We read a few public pages (like About, Services and Contact). This can take up to a minute. Nothing is published or changed without your approval.</p>
              </TabsContent>
              <TabsContent value="scratch" className="space-y-3 pt-4">
                <p className="text-sm">No website? Fill in your business details yourself - we'll guide you through what a strong profile needs.</p>
                <Button variant="outline" onClick={() => setStep(2)}>Enter my business details</Button>
                <Button variant="ghost" onClick={() => setStep(2)}>Skip to what's missing <ArrowRight className="ml-1 h-4 w-4" /></Button>
              </TabsContent>
              <TabsContent value="upload" className="space-y-3 pt-4">
                <Label htmlFor="bs-paste">Paste the text of your existing company profile</Label>
                <Textarea id="bs-paste" rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Copy the text from your current profile (Word or PDF) and paste it here." />
                <Button onClick={() => pasteMutation.mutate()} disabled={pasted.trim().length < 80 || !canEdit || pasteMutation.isPending}>
                  {pasteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Read my profile
                </Button>
                <p className="text-xs text-muted-foreground">Uses 1 AI credit. Every detail we find is quoted from your text for you to check.</p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{scan?.summary.name ? "We found this business" : "Check what we found"}</CardTitle>
            {scan && (
              <CardDescription>
                {scan.summary.name && <span className="block text-lg font-semibold text-foreground">{scan.summary.name}</span>}
                {scan.summary.description && <span className="block">{scan.summary.description}</span>}
                <span className="block text-xs">{scan.pagesFetched} page{scan.pagesFetched === 1 ? "" : "s"} read from {scan.finalUrl}</span>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Accept what's right, correct what's nearly right, and reject anything that isn't about your business.</p>
            <ProposalReview workspaceId={ws} canEdit={canEdit} origins={["website_scan", "document_upload"]} emptyText="Nothing new to review - everything we found is already in your business details." />
            <div className="flex justify-end">
              <Button onClick={() => setStep(2)}>
                {pendingReview.length ? `Continue (${pendingReview.length} left to review)` : "Continue"} <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && completeness && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your profile is {completeness.score}% complete</CardTitle>
            <CardDescription>Add what's missing for a stronger profile. We never make these up for you.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={completeness.score} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-primary" style={{ width: `${completeness.score}%` }} />
            </div>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {completeness.items.map((i) => (
                <li key={i.key} className="flex items-center gap-2">
                  {i.done ? <Check className="h-4 w-4 text-emerald-600" aria-label="Done" /> : <span className="h-4 w-4 rounded-full border" aria-label="Missing" />}
                  <span className={i.done ? "text-muted-foreground" : ""}>{i.label}</span>
                </li>
              ))}
            </ul>
            {identity.data && (
              <div className="space-y-4 rounded-lg border p-4">
                <div>
                  <p className="font-medium">Complete the essentials here</p>
                  <p className="text-xs text-muted-foreground">These are the same business facts used everywhere in StabiFlow. Saving keeps you in Business Studio.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1"><Label>Registered (legal) name</Label><Input value={draftValue("legal_name", identity.data.identity.legal_name)} onChange={(e) => setStudioDraft((d) => ({...d, legal_name:e.target.value}))} /></div>
                  <div className="space-y-1"><Label>Industry</Label><Input value={draftValue("industry", identity.data.identity.industry)} onChange={(e) => setStudioDraft((d) => ({...d, industry:e.target.value}))} /></div>
                  <div className="space-y-1 sm:col-span-2"><Label>Website</Label><Input value={draftValue("website", identity.data.identity.website)} onChange={(e) => setStudioDraft((d) => ({...d, website:e.target.value}))} /></div>
                  <div className="space-y-1 sm:col-span-2"><Label>Short description</Label><Textarea rows={2} value={draftValue("short_description", identity.data.identity.short_description)} onChange={(e) => setStudioDraft((d) => ({...d, short_description:e.target.value}))} /></div>
                  <div className="space-y-1 sm:col-span-2"><Label>About the business</Label><Textarea rows={4} value={draftValue("long_description", identity.data.identity.long_description)} onChange={(e) => setStudioDraft((d) => ({...d, long_description:e.target.value}))} /></div>
                  <div className="space-y-1"><Label>Mission</Label><Textarea rows={3} value={draftValue("mission", identity.data.identity.mission)} onChange={(e) => setStudioDraft((d) => ({...d, mission:e.target.value}))} /></div>
                  <div className="space-y-1"><Label>Vision</Label><Textarea rows={3} value={draftValue("vision", identity.data.identity.vision)} onChange={(e) => setStudioDraft((d) => ({...d, vision:e.target.value}))} /></div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="outline" asChild><Link to="/app/business?return=studio&section=contacts">More details</Link></Button>
                  <Button onClick={() => saveStudioDetails.mutate()} disabled={!canEdit || saveStudioDetails.isPending}>{saveStudioDetails.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save & stay in Studio</Button>
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => setStep(3)}>Continue <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> Improve the wording (optional)</CardTitle>
            <CardDescription>AI polishes your own description, tagline, mission and vision. It won't add facts - you approve every change.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="bs-tone">Tone</Label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger id="bs-tone" className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="confident">Confident</SelectItem>
                    <SelectItem value="formal">Formal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => wordingMutation.mutate()} disabled={!canEdit || wordingMutation.isPending}>
                {wordingMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Suggest better wording
              </Button>
              <span className="text-xs text-muted-foreground">Uses 1 AI credit</span>
            </div>
            <ProposalReview workspaceId={ws} canEdit={canEdit} origins={["ai_wording"]} emptyText="No wording suggestions waiting." />
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
              <Button onClick={() => setStep(4)}>Choose a design <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Choose a design</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
            <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Profile design">
              {templates.map((t) => {
                const locked = t.is_premium && !preview.data?.canUsePremium;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="radio"
                    aria-checked={templateKey === t.key}
                    onClick={() => setTemplateKey(t.key)}
                    className={`rounded-md border p-3 text-left ${templateKey === t.key ? "border-primary ring-2 ring-primary/30" : ""}`}
                  >
                    <p className="flex items-center gap-2 font-medium">
                      {t.name} {locked && <Badge variant="outline"><Lock className="mr-1 h-3 w-3" /> Paid</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
              <Button onClick={() => setStep(5)}>Preview <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <div className="space-y-4">
          {preview.data && template && (
            <ProfilePreview content={preview.data.content} layout={template.config.layout ?? "band"} serif={template.config.headingFont === "serif"} watermark={!preview.data.canExportPdf} />
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Get your company profile</CardTitle>
              <CardDescription>
                {preview.data?.canExportPdf ? "Your professional profile is ready to generate as a clean PDF." : "This protected preview shows how your profile can look. Purchase the Professional Profile or choose a subscription to create the clean PDF."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {templateLocked ? (
                <p className="text-sm text-muted-foreground">The {template?.name} design is included after purchasing the Professional Profile or with an eligible subscription.</p>
              ) : preview.data?.canExportPdf ? (
                <Button onClick={() => docMutation.mutate()} disabled={!canEdit || docMutation.isPending}>
                  {docMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Create my PDF
                </Button>
              ) : teaserStudio ? (
                <p className="text-sm text-muted-foreground">Preview only - the clean PDF is generated securely after purchase and is never sent to the browser beforehand.</p>
              ) : null}
              {!preview.data?.canExportPdf && oneOffPrice && (
                <Button variant="default" onClick={() => buy.mutate(oneOffPrice.id)} disabled={!hasPermission("manage_billing") || buy.isPending}>
                  Buy professional profile - {formatMoney(oneOffPrice.amount_minor, oneOffPrice.currency)}
                </Button>
              )}
              {!preview.data?.canExportPdf && (
                <Button asChild variant="outline"><Link to="/app/billing">See subscriptions</Link></Button>
              )}
              <Button asChild variant="ghost"><Link to="/app/documents">My documents</Link></Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
