import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { FactListSection, type FactField } from "@/components/business/FactListSection";
import { ProvenanceBadge } from "@/components/business/ProvenanceBadge";
import { BrandProfileSelector } from "@/components/creative-studio/BrandProfileSelector";
import { ProposalReview } from "@/components/business/ProposalReview";
import { WebsiteMonitorCard } from "@/components/business/WebsiteMonitorCard";
import { useAuth } from "@/hooks/useAuth";
import {
  COUNTRY_IDENTIFIER_SCHEMES, computeCompleteness, fetchBusinessIdentity, identifierSchemeLabel, updateBusinessIdentity,
  type BusinessIdentity, type BusinessIdentityBundle,
} from "@/lib/businessIdentity";
import type { BrandProfile } from "@/lib/brandProfiles";
import { draftProfile } from "@/lib/businessStudio";

const EMPLOYEE_RANGES = ["1", "2-10", "11-50", "51-200", "201-500", "501-1000", "1000+"];

type IdentityForm = {
  legal_name: string;
  trading_name: string;
  country_code: string;
  industry: string;
  website: string;
  founded_year: string;
  employee_count_range: string;
  tagline: string;
  short_description: string;
  long_description: string;
  mission: string;
  vision: string;
  core_values: string;
};

function toForm(i: BusinessIdentity): IdentityForm {
  return {
    legal_name: i.legal_name ?? "",
    trading_name: i.trading_name ?? "",
    country_code: i.country_code ?? "ZA",
    industry: i.industry ?? "",
    website: i.website ?? "",
    founded_year: i.founded_year ? String(i.founded_year) : "",
    employee_count_range: i.employee_count_range ?? "",
    tagline: i.tagline ?? "",
    short_description: i.short_description ?? "",
    long_description: i.long_description ?? "",
    mission: i.mission ?? "",
    vision: i.vision ?? "",
    core_values: (i.core_values ?? []).join(", "),
  };
}

const nullIfEmpty = (s: string) => (s.trim() === "" ? null : s.trim());

// My Business - the customer's view/editor of the canonical Business
// Identity. Every fact shows its provenance; Business Studio (website scan
// -> profile) writes into exactly this record after the customer confirms.
export default function MyBusiness() {
  const { currentWorkspaceId } = useAuth();
  const query = useQuery({
    queryKey: ["business-identity", currentWorkspaceId],
    queryFn: () => fetchBusinessIdentity(currentWorkspaceId as string),
    enabled: !!currentWorkspaceId,
  });

  if (!currentWorkspaceId) return null;
  if (query.isLoading) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (query.error || !query.data) {
    return <EmptyState icon={Building2} title="Could not load your business" description="Please refresh the page to try again." />;
  }
  // Keyed by identity id: the form initialises from the loaded record once
  // and is never overwritten by a background refetch mid-edit.
  return <MyBusinessEditor key={query.data.identity.id} workspaceId={currentWorkspaceId} bundle={query.data} />;
}

function MyBusinessEditor({ workspaceId: currentWorkspaceId, bundle }: { workspaceId: string; bundle: BusinessIdentityBundle }) {
  const { currentMembership, user, profile } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = currentMembership?.role === "owner" || currentMembership?.role === "admin";
  const [form, setForm] = useState<IdentityForm>(() => toForm(bundle.identity));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<BrandProfile | null>(null);

  const completeness = useMemo(() => computeCompleteness(bundle), [bundle]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["business-identity", currentWorkspaceId] });

  const identity = bundle.identity;
  const provenance = (identity.field_provenance ?? {}) as Record<string, { source?: string }>;
  useEffect(() => {
    if (!dirty) setForm(toForm(bundle.identity));
  }, [bundle.identity.updated_at, dirty]);

  const set = (k: keyof IdentityForm) => (e: { target: { value: string } }) => {
    setDirty(true);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  async function createAiDraft() {
    setDrafting(true);
    try {
      const result = await draftProfile(currentWorkspaceId);
      if (result.suggestions > 0) {
        toast.success(`${result.suggestions} AI draft suggestion${result.suggestions === 1 ? "" : "s"} ready to review`);
        await queryClient.invalidateQueries({ queryKey: ["fact-proposals", currentWorkspaceId] });
      } else {
        toast.info("No new draft was needed from the information currently available.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not prepare AI draft");
    } finally {
      setDrafting(false);
    }
  }

  async function saveIdentity() {
    const year = form.founded_year.trim() ? Number(form.founded_year) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1800 || year > 2100)) {
      toast.error("Founded year must be a year between 1800 and 2100");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateBusinessIdentity(identity, {
        legal_name: nullIfEmpty(form.legal_name),
        trading_name: nullIfEmpty(form.trading_name),
        country_code: form.country_code || "ZA",
        industry: nullIfEmpty(form.industry),
        website: nullIfEmpty(form.website),
        founded_year: year,
        employee_count_range: nullIfEmpty(form.employee_count_range),
        tagline: nullIfEmpty(form.tagline),
        short_description: nullIfEmpty(form.short_description),
        long_description: nullIfEmpty(form.long_description),
        mission: nullIfEmpty(form.mission),
        vision: nullIfEmpty(form.vision),
        core_values: form.core_values.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 20),
      });
      setForm(toForm(updated));
      setDirty(false);
      toast.success("Business details saved");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function useBrandForProfile() {
    if (!selectedBrand) return;
    try {
      await updateBusinessIdentity(identity, { brand_profile_id: selectedBrand.id });
      toast.success("Brand linked to your business profile");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not link brand");
    }
  }

  const listProps = { workspaceId: currentWorkspaceId, userId: user?.id ?? null, canEdit, onChanged: refresh };
  const text = (label: string, name: keyof IdentityForm, opts: { placeholder?: string; type?: string } = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`bi-${name}`}>{label}</Label>
      <Input id={`bi-${name}`} type={opts.type ?? "text"} value={form[name]} onChange={set(name)} placeholder={opts.placeholder} disabled={!canEdit} />
      {provenance[name]?.source && provenance[name].source !== "user" && <ProvenanceBadge source={provenance[name].source} status="unverified" />}
    </div>
  );
  const area = (label: string, name: keyof IdentityForm, placeholder?: string) => (
    <div className="space-y-1 sm:col-span-2">
      <Label htmlFor={`bi-${name}`}>{label}</Label>
      <Textarea id={`bi-${name}`} value={form[name]} onChange={set(name)} placeholder={placeholder} disabled={!canEdit} />
      {provenance[name]?.source && provenance[name].source !== "user" && <ProvenanceBadge source={provenance[name].source} status="unverified" />}
    </div>
  );

  const contactFields: FactField[] = [
    { name: "kind", label: "Type", type: "select", required: true, options: [
      { value: "email", label: "Email" }, { value: "phone", label: "Phone" }, { value: "whatsapp", label: "WhatsApp" },
      { value: "fax", label: "Fax" }, { value: "other", label: "Other" },
    ] },
    { name: "value", label: "Value", required: true },
    { name: "label", label: "Label", placeholder: "e.g. Sales" },
    { name: "is_primary", label: "Main contact of this type", type: "checkbox" },
    { name: "is_public", label: "Show on my public profile", type: "checkbox" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My Business</h1>
        <p className="text-sm text-muted-foreground">The verified facts about your business. Your company profile and documents are built from this.</p>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Profile completeness</span>
            <span aria-label="Completeness percentage">{completeness.score}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={completeness.score} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-all" style={{ width: `${completeness.score}%` }} />
          </div>
          {completeness.items.some((i) => !i.done) && (
            <p className="text-xs text-muted-foreground">
              Still missing: {completeness.items.filter((i) => !i.done).map((i) => i.label).join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="border-b bg-muted/15 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> Review your AI-prepared profile</CardTitle>
            <CardDescription className="mt-1">Website facts stay factual. AI can draft the wording around them, and nothing is added to your profile until you approve it.</CardDescription>
          </div>
          {canEdit && (
            <Button variant="outline" className="mt-3 shrink-0 gap-2 sm:mt-0" onClick={createAiDraft} disabled={drafting}>
              {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Prepare AI draft
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-5">
          <ProposalReview workspaceId={currentWorkspaceId} canEdit={canEdit} emptyText="No suggestions waiting. Use Prepare AI draft to let StabiFlow draft the narrative parts from your business information." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company</CardTitle>
          <CardDescription>Your registered and trading identity.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {text("Trading name", "trading_name")}
          {text("Registered (legal) name", "legal_name", { placeholder: "e.g. Acme (Pty) Ltd" })}
          {text("Industry", "industry")}
          {text("Website", "website", { type: "url", placeholder: "https://" })}
          {text("Year founded", "founded_year", { type: "number" })}
          <div className="space-y-1">
            <Label htmlFor="bi-employees">Team size</Label>
            <Select value={form.employee_count_range} onValueChange={(v) => { setDirty(true); setForm((f) => ({ ...f, employee_count_range: v })); }} disabled={!canEdit}>
              <SelectTrigger id="bi-employees">
                <SelectValue placeholder="Choose..." />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYEE_RANGES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r} {r === "1" ? "person" : "people"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {text("Country (2-letter code)", "country_code")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
          <CardDescription>How you describe your business. Only include what is true - nothing here is invented for you.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{text("Tagline", "tagline")}</div>
          {area("Short description", "short_description", "One or two sentences")}
          {area("About the business", "long_description")}
          {area("Mission", "mission")}
          {area("Vision", "vision")}
          <div className="sm:col-span-2">{text("Core values (comma separated)", "core_values")}</div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={saveIdentity} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save business details
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branding</CardTitle>
          <CardDescription>Logo and colours used on your company profile and adverts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {user && (
            <BrandProfileSelector
              workspaceId={currentWorkspaceId}
              workspaceName={identity.trading_name ?? profile?.full_name ?? "My business"}
              userId={user.id}
              selectedProfileId={identity.brand_profile_id}
              onSelect={setSelectedBrand}
            />
          )}
          {canEdit && selectedBrand && selectedBrand.id !== identity.brand_profile_id && selectedBrand.workspaceId === currentWorkspaceId && (
            <Button size="sm" variant="outline" onClick={useBrandForProfile}>
              Use "{selectedBrand.name}" for my business profile
            </Button>
          )}
          {identity.brand_profile_id && <p className="text-xs text-muted-foreground">A brand is linked to your business profile.</p>}
        </CardContent>
      </Card>

      <FactListSection
        {...listProps}
        title="Contact details"
        table="business_contacts"
        rows={bundle.contacts as never}
        fields={contactFields}
        defaults={{ kind: "email", is_public: true }}
        summarize={(r) => `${String(r.kind)}: ${String(r.value)}${r.label ? ` (${String(r.label)})` : ""}${r.is_primary ? " · main" : ""}`}
      />

      <FactListSection
        {...listProps}
        title="Locations"
        table="business_locations"
        rows={bundle.locations as never}
        fields={[
          { name: "label", label: "Label", placeholder: "e.g. Head office" },
          { name: "address_line1", label: "Address", required: true },
          { name: "address_line2", label: "Address line 2" },
          { name: "city", label: "City" },
          { name: "region", label: "Province / region" },
          { name: "postal_code", label: "Postal code" },
          { name: "is_primary", label: "Main location", type: "checkbox" },
          { name: "is_public", label: "Show on my public profile", type: "checkbox" },
        ]}
        defaults={{ is_public: true }}
        summarize={(r) => [r.label, r.address_line1, r.city, r.region].filter(Boolean).join(", ")}
      />

      <FactListSection
        {...listProps}
        title="Services and products"
        description="Add at least three for a strong profile."
        table="business_offerings"
        rows={bundle.offerings as never}
        fields={[
          { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "service", label: "Service" }, { value: "product", label: "Product" }] },
          { name: "name", label: "Name", required: true },
          { name: "price_text", label: "Price (optional)", placeholder: "e.g. From R1 500" },
          { name: "description", label: "Description", type: "textarea" },
          { name: "is_featured", label: "Feature this", type: "checkbox" },
        ]}
        defaults={{ kind: "service" }}
        summarize={(r) => `${String(r.name)}${r.price_text ? ` · ${String(r.price_text)}` : ""}`}
      />

      <FactListSection
        {...listProps}
        title="Social media"
        table="business_social_links"
        rows={bundle.socialLinks as never}
        fields={[
          { name: "platform", label: "Platform", type: "select", required: true, options: [
            { value: "facebook", label: "Facebook" }, { value: "instagram", label: "Instagram" }, { value: "linkedin", label: "LinkedIn" },
            { value: "x", label: "X" }, { value: "tiktok", label: "TikTok" }, { value: "youtube", label: "YouTube" },
            { value: "pinterest", label: "Pinterest" }, { value: "google_business", label: "Google Business" }, { value: "other", label: "Other" },
          ] },
          { name: "url", label: "Link", type: "url", required: true, placeholder: "https://" },
        ]}
        summarize={(r) => `${String(r.platform)}: ${String(r.url)}`}
      />

      <FactListSection
        {...listProps}
        title="Team"
        table="business_team_members"
        rows={bundle.team as never}
        fields={[
          { name: "full_name", label: "Full name", required: true },
          { name: "role_title", label: "Role" },
          { name: "bio", label: "Short bio", type: "textarea" },
          { name: "is_public", label: "Show on my public profile", type: "checkbox" },
        ]}
        defaults={{ is_public: true }}
        summarize={(r) => `${String(r.full_name)}${r.role_title ? ` · ${String(r.role_title)}` : ""}`}
      />

      <FactListSection
        {...listProps}
        title="Projects"
        table="business_projects"
        rows={bundle.projects as never}
        fields={[
          { name: "title", label: "Project", required: true },
          { name: "client_name", label: "Client" },
          { name: "location", label: "Location" },
          { name: "completed_year", label: "Year completed", type: "number" },
          { name: "description", label: "Description", type: "textarea" },
          { name: "is_public", label: "Show on my public profile", type: "checkbox" },
        ]}
        defaults={{ is_public: true }}
        summarize={(r) => `${String(r.title)}${r.client_name ? ` for ${String(r.client_name)}` : ""}${r.completed_year ? ` (${String(r.completed_year)})` : ""}`}
      />

      <FactListSection
        {...listProps}
        title="Certifications and accreditations"
        table="business_certifications"
        rows={bundle.certifications as never}
        fields={[
          { name: "name", label: "Name", required: true },
          { name: "issuer", label: "Issued by" },
          { name: "credential_id", label: "Certificate number" },
          { name: "issued_on", label: "Issued on", type: "date" },
          { name: "expires_on", label: "Expires on", type: "date" },
          { name: "is_public", label: "Show on my public profile", type: "checkbox" },
        ]}
        defaults={{ is_public: true }}
        summarize={(r) => `${String(r.name)}${r.issuer ? ` · ${String(r.issuer)}` : ""}${r.expires_on ? ` · expires ${String(r.expires_on)}` : ""}`}
      />

      <WebsiteMonitorCard workspaceId={currentWorkspaceId} defaultUrl={identity.website ?? ""} canEdit={canEdit} />

      <FactListSection
        {...listProps}
        title="Registration numbers"
        description="Private unless you choose to show them."
        table="business_identifiers"
        rows={bundle.identifiers as never}
        fields={[
          { name: "scheme", label: "Type", type: "select", required: true, options: (COUNTRY_IDENTIFIER_SCHEMES[identity.country_code] ?? []).map((s) => ({ value: s.scheme, label: s.label })) },
          { name: "value", label: "Number", required: true },
          { name: "is_public", label: "Show on my public profile", type: "checkbox" },
        ]}
        defaults={{ country_code: identity.country_code, is_public: false }}
        summarize={(r) => `${identifierSchemeLabel(String(r.country_code), String(r.scheme))}: ${String(r.value)}`}
      />
    </div>
  );
}
