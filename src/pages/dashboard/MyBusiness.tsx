import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, CheckCircle2, ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react";
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
import { useAuth } from "@/hooks/useAuth";
import {
  COUNTRY_IDENTIFIER_SCHEMES, computeCompleteness, fetchBusinessIdentity, identifierSchemeLabel, updateBusinessIdentity,
  setBusinessSectionPreference, type BusinessIdentity, type BusinessIdentityBundle,
} from "@/lib/businessIdentity";
import type { BrandProfile } from "@/lib/brandProfiles";
import { draftProfile, scanWebsite } from "@/lib/businessStudio";

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
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<BrandProfile | null>(null);
  const [openSection, setOpenSection] = useState<string | null>("company");

  const completeness = useMemo(() => computeCompleteness(bundle), [bundle]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["business-identity", currentWorkspaceId] });

  const identity = bundle.identity;
  const sectionNA = (section: string) => bundle.sectionPreferences.some((p) => p.section === section && p.status === "not_applicable");
  async function toggleNA(section: string, makeNA: boolean) {
    try { await setBusinessSectionPreference(currentWorkspaceId, section, makeNA ? "not_applicable" : "applicable", user?.id ?? null); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not update section"); }
  }
  const naButton = (section: string, label: string) => canEdit ? <Button size="sm" variant="ghost" onClick={() => toggleNA(section, !sectionNA(section))}>{sectionNA(section) ? "Mark as applicable" : label}</Button> : null;
  useEffect(() => { setForm(toForm(identity)); }, [identity]);
  const provenance = (identity.field_provenance ?? {}) as Record<string, { source?: string }>;
  const set = (k: keyof IdentityForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function createAiDraft() {
    setDrafting(true);
    try {
      let websiteSuggestions = 0;
      if (identity.website) {
        const scan = await scanWebsite(currentWorkspaceId, identity.website);
        websiteSuggestions = scan.proposalsCreated;
      }
      const draft = await draftProfile(currentWorkspaceId);
      const total = websiteSuggestions + draft.suggestions;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["fact-proposals", currentWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["business-identity", currentWorkspaceId] }),
      ]);
      if (total > 0) {
        toast.success(`${total} suggestion${total === 1 ? "" : "s"} ready to review`);
      } else {
        toast.info("Your website and business details are already covered. There are no new suggestions to review.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete your profile with AI");
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

  const missing = completeness.items.filter((i) => !i.done);
  const sectionButton = (id: string, title: string, description: string, complete: boolean, content: ReactNode) => {
    const open = openSection === id;
    return (
      <Card className="overflow-hidden border-border/70 shadow-sm">
        <button type="button" className="flex w-full items-center gap-3 p-5 text-left" onClick={() => setOpenSection(open ? null : id)} aria-expanded={open}>
          {complete ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <div className="h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground/30" />}
          <div className="min-w-0 flex-1">
            <div className="font-medium">{title}</div>
            <div className="text-sm text-muted-foreground">{description}</div>
          </div>
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">{complete ? "Complete" : "Needs attention"}</span>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>
        {open && <CardContent className="border-t bg-muted/5 pt-5">{content}</CardContent>}
      </Card>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">My Business</h1>
        <p className="text-sm text-muted-foreground">Keep your business facts in one place. StabiFlow uses these details for your profile, documents and marketing.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Profile setup</div>
              <div className="text-sm text-muted-foreground">{completeness.items.length - missing.length} of {completeness.items.length} essentials complete</div>
            </div>
            <span className="text-lg font-semibold">{completeness.score}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={completeness.score} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-all" style={{ width: `${completeness.score}%` }} />
          </div>
          {missing.length > 0 && <Button size="sm" onClick={() => { const next = missing[0]?.section; setOpenSection(next === "company" ? "company" : next === "about" ? "about" : next === "branding" ? "brand" : next === "contacts" || next === "locations" ? "contact" : next === "offerings" ? "services" : next === "social" ? "social" : next === "team" ? "team" : "work"); }}>Continue setup</Button>}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="border-b bg-muted/15 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> Complete with AI</CardTitle>
            <CardDescription className="mt-1">StabiFlow scans your website for industry, contact details, locations, services, social links and other supported facts, then drafts the About wording. Review everything before it is added.</CardDescription>
          </div>
          {canEdit && <Button variant="outline" className="mt-3 shrink-0 gap-2 sm:mt-0" onClick={createAiDraft} disabled={drafting}>
            {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Complete with AI
          </Button>}
        </CardHeader>
        <CardContent className="pt-5">
          <ProposalReview workspaceId={currentWorkspaceId} canEdit={canEdit} emptyText="No suggestions need your review right now. Complete with AI to scan your website and prepare any missing profile details." />
        </CardContent>
      </Card>

      <div className="space-y-3">
        {sectionButton("company", "Company", "Name, industry, website and business basics", !!form.legal_name && !!form.industry, (
          <div className="grid gap-4 sm:grid-cols-2">
            {text("Trading name", "trading_name")}
            {text("Registered (legal) name", "legal_name", { placeholder: "e.g. Acme (Pty) Ltd" })}
            {text("Industry", "industry")}
            {text("Website", "website", { type: "url", placeholder: "https://" })}
            {text("Year founded", "founded_year", { type: "number" })}
            <div className="space-y-1"><Label htmlFor="bi-employees">Team size</Label><Select value={form.employee_count_range} onValueChange={(v) => setForm((f) => ({ ...f, employee_count_range: v }))} disabled={!canEdit}><SelectTrigger id="bi-employees"><SelectValue placeholder="Choose..." /></SelectTrigger><SelectContent>{EMPLOYEE_RANGES.map((r) => <SelectItem key={r} value={r}>{r} {r === "1" ? "person" : "people"}</SelectItem>)}</SelectContent></Select></div>
            {text("Country (2-letter code)", "country_code")}
            {canEdit && <div className="sm:col-span-2 flex justify-end"><Button onClick={saveIdentity} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save company</Button></div>}
          </div>
        ))}

        {sectionButton("about", "About", "Tagline, description, mission, vision and values", !!form.long_description && !!form.core_values, (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">{text("Tagline", "tagline")}</div>
            {area("Short description", "short_description", "One or two sentences")}
            {area("About the business", "long_description")}
            {area("Mission", "mission")}
            {area("Vision", "vision")}
            <div className="sm:col-span-2">{text("Core values (comma separated)", "core_values")}</div>
            {canEdit && <div className="sm:col-span-2 flex justify-end"><Button onClick={saveIdentity} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save about</Button></div>}
          </div>
        ))}

        {sectionButton("brand", "Brand", "Logo and colours used across StabiFlow", !!identity.brand_profile_id, (
          <div className="space-y-3">
            {user && <BrandProfileSelector workspaceId={currentWorkspaceId} workspaceName={identity.trading_name ?? profile?.full_name ?? "My business"} userId={user.id} selectedProfileId={identity.brand_profile_id} onSelect={setSelectedBrand} />}
            {canEdit && selectedBrand && selectedBrand.id !== identity.brand_profile_id && selectedBrand.workspaceId === currentWorkspaceId && <Button size="sm" variant="outline" onClick={useBrandForProfile}>Use "{selectedBrand.name}" for my business profile</Button>}
            {identity.brand_profile_id && <p className="text-xs text-muted-foreground">Brand linked to this business.</p>}
          </div>
        ))}

        {sectionButton("contact", "Contact & locations", "Email, phone, WhatsApp and business locations", bundle.contacts.length > 0 && (bundle.locations.length > 0 || sectionNA("location")), (
          <div className="space-y-4">
            <FactListSection {...listProps} title="Contact details" table="business_contacts" rows={bundle.contacts as never} fields={contactFields} defaults={{ kind: "email", is_public: true }} summarize={(r) => `${String(r.kind)}: ${String(r.value)}${r.label ? ` (${String(r.label)})` : ""}${r.is_primary ? " · main" : ""}`} />
            <div className="flex justify-end">{naButton("location", "No public/physical location")}</div><FactListSection {...listProps} title="Locations" table="business_locations" rows={bundle.locations as never} fields={[{ name: "label", label: "Label", placeholder: "e.g. Head office or Online" },{ name: "address_line1", label: "Address" },{ name: "address_line2", label: "Address line 2" },{ name: "city", label: "City" },{ name: "region", label: "Province / region" },{ name: "postal_code", label: "Postal code" },{ name: "is_primary", label: "Main location", type: "checkbox" },{ name: "is_public", label: "Show on my public profile", type: "checkbox" }]} defaults={{ is_public: true }} summarize={(r) => [r.label, r.address_line1, r.city, r.region].filter(Boolean).join(", ")} />
          </div>
        ))}

        {sectionButton("services", "Services & products", "What your business offers", bundle.offerings.length >= 3, (
          <FactListSection {...listProps} title="Services and products" description="Add at least three for a strong profile." table="business_offerings" rows={bundle.offerings as never} fields={[{ name: "kind", label: "Type", type: "select", required: true, options: [{ value: "service", label: "Service" }, { value: "product", label: "Product" }] },{ name: "name", label: "Name", required: true },{ name: "price_text", label: "Price (optional)", placeholder: "e.g. From R1 500" },{ name: "description", label: "Description", type: "textarea" },{ name: "is_featured", label: "Feature this", type: "checkbox" }]} defaults={{ kind: "service" }} summarize={(r) => `${String(r.name)}${r.price_text ? ` · ${String(r.price_text)}` : ""}`} />
        ))}

        {sectionButton("social", "Social media", "Links customers can use to find you", bundle.socialLinks.length > 0 || sectionNA("social"), (
          <><div className="flex justify-end">{naButton("social", "We don't use social media")}</div><FactListSection {...listProps} title="Social media" table="business_social_links" rows={bundle.socialLinks as never} fields={[{ name: "platform", label: "Platform", type: "select", required: true, options: [{ value: "facebook", label: "Facebook" },{ value: "instagram", label: "Instagram" },{ value: "linkedin", label: "LinkedIn" },{ value: "x", label: "X" },{ value: "tiktok", label: "TikTok" },{ value: "youtube", label: "YouTube" },{ value: "other", label: "Other" }] },{ name: "url", label: "Link", type: "url", required: true, placeholder: "https://" }]} summarize={(r) => `${String(r.platform)}: ${String(r.url)}`} /></>
        ))}

        {sectionButton("team", "Team", "People behind your business", bundle.team.length > 0 || sectionNA("team"), (
          <><div className="flex justify-end">{naButton("team", "Don't show team members")}</div><FactListSection {...listProps} title="Team" table="business_team_members" rows={bundle.team as never} fields={[{ name: "full_name", label: "Full name", required: true },{ name: "role_title", label: "Role" },{ name: "bio", label: "Short bio", type: "textarea" },{ name: "is_public", label: "Show on my public profile", type: "checkbox" }]} defaults={{ is_public: true }} summarize={(r) => `${String(r.full_name)}${r.role_title ? ` · ${String(r.role_title)}` : ""}`} /></>
        ))}

        {sectionButton("work", "Work & credentials", "Projects, certifications and registration numbers", bundle.projects.length > 0 || bundle.certifications.length > 0 || bundle.identifiers.length > 0 || sectionNA("projects") || sectionNA("credentials"), (
          <div className="space-y-4">
            <div className="flex flex-wrap justify-end gap-2">{naButton("projects", "No projects to showcase")}{naButton("credentials", "No certifications/registrations")}</div>
            <FactListSection {...listProps} title="Projects" table="business_projects" rows={bundle.projects as never} fields={[{ name: "title", label: "Project", required: true },{ name: "client_name", label: "Client" },{ name: "location", label: "Location" },{ name: "completed_year", label: "Year completed", type: "number" },{ name: "description", label: "Description", type: "textarea" },{ name: "is_public", label: "Show on my public profile", type: "checkbox" }]} defaults={{ is_public: true }} summarize={(r) => `${String(r.title)}${r.client_name ? ` for ${String(r.client_name)}` : ""}`} />
            <FactListSection {...listProps} title="Certifications and accreditations" table="business_certifications" rows={bundle.certifications as never} fields={[{ name: "name", label: "Name", required: true },{ name: "issuer", label: "Issued by" },{ name: "credential_id", label: "Certificate number" },{ name: "issued_on", label: "Issued on", type: "date" },{ name: "expires_on", label: "Expires on", type: "date" },{ name: "is_public", label: "Show on my public profile", type: "checkbox" }]} defaults={{ is_public: true }} summarize={(r) => String(r.name)} />
            <FactListSection {...listProps} title="Registration numbers" description="Private unless you choose to show them." table="business_identifiers" rows={bundle.identifiers as never} sortable={false} fields={[{ name: "scheme", label: "Type", type: "select", required: true, options: (COUNTRY_IDENTIFIER_SCHEMES[identity.country_code] ?? []).map((s) => ({ value: s.scheme, label: s.label })) },{ name: "value", label: "Number", required: true },{ name: "is_public", label: "Show on my public profile", type: "checkbox" }]} defaults={{ country_code: identity.country_code, is_public: false }} summarize={(r) => `${identifierSchemeLabel(String(r.country_code), String(r.scheme))}: ${String(r.value)}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
