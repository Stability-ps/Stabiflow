import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceProfile } from "@/hooks/useWorkspaceProfile";
import { workspaceRoleRank } from "@/lib/workspaceRoles";
import { slugify } from "@/lib/slug";
import {
  getWorkspaceLogoUrl, HEX_COLOR_RE, isCompleteHexColor, isWorkspaceSlugAvailable, normalizeHexColor, updateWorkspaceIdentity, updateWorkspaceProfile, uploadWorkspaceLogo,
} from "@/lib/workspaceProfile";
import { deleteWorkspace, exportWorkspaceData } from "@/lib/workspaceLifecycle";

// One colour field = one form value, exposed through two synchronized
// controls (native colour picker + free-typed hex text). `invalid` is
// computed by the parent (single source of truth, also gates Save); this
// component only owns WHEN to show that error (not on every keystroke -
// only after the field has been blurred at least once) and the picker's
// "last known good colour" so a temporarily incomplete typed value (e.g.
// "#80") never has to feed <input type="color">, which requires a valid
// colour at all times.
function BrandColorField({
  id,
  label,
  value,
  onChange,
  disabled,
  placeholder,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder: string;
  invalid: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const [lastValidColor, setLastValidColor] = useState("#000000");
  const normalized = value.trim() ? normalizeHexColor(value) : null;
  const complete = isCompleteHexColor(value);
  useEffect(() => {
    if (complete && normalized) setLastValidColor(normalized);
  }, [complete, normalized]);
  const pickerValue = complete && normalized ? normalized : lastValidColor;
  const showError = touched && invalid;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={disabled}
          aria-label={`${label} picker`}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-md border p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={showError}
        />
      </div>
      {showError && <p className="text-xs text-destructive">Use a hex colour like {placeholder}.</p>}
    </div>
  );
}

export function WorkspaceTab() {
  const { currentWorkspaceId, currentMembership, refreshMemberships } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading } = useWorkspaceProfile(currentWorkspaceId);
  const canEdit = workspaceRoleRank(currentMembership?.role) >= workspaceRoleRank("admin");
  const isOwner = workspaceRoleRank(currentMembership?.role) >= workspaceRoleRank("owner");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [checkingSlug, setCheckingSlug] = useState(false);
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [timezone, setTimezone] = useState("");
  const [currency, setCurrency] = useState("");
  const [industry, setIndustry] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [defaultCta, setDefaultCta] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slugCheckToken = useRef(0);
  // Guards which workspace's data local form state was last hydrated from.
  // The database is authoritative and a fresh MOUNT must always re-hydrate
  // (this ref starts undefined on every new component instance, so the
  // effect below still runs on the very next `data`) - but WITHOUT this
  // guard, `useQuery`'s default staleTime:0 triggers a background refetch
  // on every mount, and its resolution (a NEW `data` object reference for
  // the SAME workspace) would re-run this effect and silently clobber
  // whatever the user is mid-typing with the last-saved server value.
  const hydratedWorkspaceId = useRef<string | null>(null);

  useEffect(() => {
    if (!data) return;
    if (hydratedWorkspaceId.current === data.workspace.id) return;
    hydratedWorkspaceId.current = data.workspace.id;
    setName(data.workspace.name);
    setSlug(data.workspace.slug);
    setDescription(data.settings.business_description || "");
    setWebsite(data.settings.website || "");
    setTimezone(data.settings.timezone);
    setCurrency(data.settings.currency);
    setIndustry(data.settings.industry || "");
    setContactEmail(data.settings.contact_email || "");
    setContactPhone(data.settings.contact_phone || "");
    setPrimaryColor(data.settings.brand_primary_color || "");
    setSecondaryColor(data.settings.secondary_brand_color || "");
    setAccentColor(data.settings.brand_accent_color || "");
    setDefaultCta(data.settings.default_ad_cta || "");
  }, [data]);

  // Deliberately a SEPARATE, unguarded effect: unlike the typed form
  // fields above, logo_path is never hand-edited, so there is nothing to
  // "clobber" - it must always reflect the latest data.settings.logo_path
  // (e.g. right after "Change logo" -> invalidateQueries -> a fresh
  // data.settings.logo_path). The cleanup ignores a stale resolution if
  // logo_path changes again before a previous lookup resolves.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    getWorkspaceLogoUrl(data.settings.logo_path).then((url) => {
      if (!cancelled) setLogoUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const handleSlugChange = (value: string) => {
    const next = slugify(value);
    setSlug(next);
    setSlugAvailable(null);
    if (!next || !currentWorkspaceId || next === data?.workspace.slug) return;
    const token = ++slugCheckToken.current;
    setCheckingSlug(true);
    isWorkspaceSlugAvailable(next, currentWorkspaceId)
      .then((available) => {
        if (slugCheckToken.current === token) setSlugAvailable(available);
      })
      .finally(() => {
        if (slugCheckToken.current === token) setCheckingSlug(false);
      });
  };

  const handleLogoUpload = async (file: File) => {
    if (!currentWorkspaceId) return;
    setUploadingLogo(true);
    try {
      await uploadWorkspaceLogo(currentWorkspaceId, file);
      await queryClient.invalidateQueries({ queryKey: ["workspace-profile", currentWorkspaceId] });
      toast.success("Logo updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload logo");
    } finally {
      setUploadingLogo(false);
    }
  };

  const primaryColorNorm = primaryColor.trim() ? normalizeHexColor(primaryColor) : null;
  const secondaryColorNorm = secondaryColor.trim() ? normalizeHexColor(secondaryColor) : null;
  const accentColorNorm = accentColor.trim() ? normalizeHexColor(accentColor) : null;
  const primaryColorInvalid = !!primaryColor.trim() && !(primaryColorNorm && HEX_COLOR_RE.test(primaryColorNorm));
  const secondaryColorInvalid = !!secondaryColor.trim() && !(secondaryColorNorm && HEX_COLOR_RE.test(secondaryColorNorm));
  const accentColorInvalid = !!accentColor.trim() && !(accentColorNorm && HEX_COLOR_RE.test(accentColorNorm));
  const brandKitInvalid = primaryColorInvalid || secondaryColorInvalid || accentColorInvalid;

  const handleSave = async () => {
    if (!currentWorkspaceId || !name.trim() || !slug) return;
    if (slugAvailable === false) {
      toast.error("Choose a different URL - that one is already taken.");
      return;
    }
    if (brandKitInvalid) {
      toast.error("Brand Kit colours must be a valid hex code, e.g. #1F2937.");
      return;
    }
    setSaving(true);
    try {
      await updateWorkspaceIdentity(currentWorkspaceId, { name: name.trim(), slug });
      await updateWorkspaceProfile(currentWorkspaceId, {
        business_description: description.trim() || null,
        website: website.trim() || null,
        timezone,
        currency: currency.toUpperCase(),
        industry: industry.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
        brand_primary_color: primaryColorNorm,
        secondary_brand_color: secondaryColorNorm,
        brand_accent_color: accentColorNorm,
        default_ad_cta: defaultCta.trim() || null,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace-profile", currentWorkspaceId] }),
        refreshMemberships(), // workspace name shown in the switcher/sidebar comes from memberships
      ]);
      toast.success("Workspace updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save workspace");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!currentWorkspaceId || !data) return;
    setExporting(true);
    try {
      await exportWorkspaceData(currentWorkspaceId, data.workspace.slug);
      toast.success("Export downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to export workspace data");
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!currentWorkspaceId) return;
    setDeleting(true);
    try {
      await deleteWorkspace(currentWorkspaceId, deleteConfirmText.trim());
      setDeleteDialogOpen(false);
      await refreshMemberships(); // picks the next remaining workspace, or null if none are left
      toast.success("Workspace deleted");
      navigate("/", { replace: true }); // RequireWorkspace sends us to /create-workspace if none remain
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete workspace");
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading || !data) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  const deleteConfirmMatches = deleteConfirmText.trim() === data.workspace.name || deleteConfirmText.trim() === data.workspace.slug;

  return (
    <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>Workspace profile</CardTitle>
        <CardDescription>{canEdit ? "Visible to everyone in this workspace." : "Only workspace admins can edit this."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 rounded-lg">
            <AvatarImage src={logoUrl || undefined} alt={name} className="object-contain" />
            <AvatarFallback className="rounded-lg text-lg">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          {canEdit && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadingLogo}>
                {uploadingLogo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {uploadingLogo ? "Uploading..." : "Change logo"}
              </Button>
            </>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-slug">URL slug</Label>
            <Input id="ws-slug" value={slug} onChange={(e) => handleSlugChange(e.target.value)} disabled={!canEdit} />
            <p className="text-xs text-muted-foreground">
              stabiflow.com/{slug || "..."}
              {checkingSlug && " · checking availability..."}
              {slugAvailable === false && <span className="text-destructive"> · already taken</span>}
              {slugAvailable === true && <span className="text-emerald-600"> · available</span>}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ws-description">Business description</Label>
          <Textarea
            id="ws-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEdit}
            maxLength={2000}
            rows={3}
            placeholder="e.g. We help small businesses run WhatsApp-first marketing campaigns."
          />
          <p className="text-xs text-muted-foreground">May be used to give StabiFlow's AI features more context about your business.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ws-website">Website</Label>
            <Input id="ws-website" value={website} onChange={(e) => setWebsite(e.target.value)} disabled={!canEdit} placeholder="https://acme.co.za" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-industry">Industry</Label>
            <Input id="ws-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={!canEdit} placeholder="e.g. Marketing Agency" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-timezone">Timezone</Label>
            <Input id="ws-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!canEdit} placeholder="Africa/Johannesburg" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-currency">Currency</Label>
            <Input id="ws-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} disabled={!canEdit} maxLength={3} placeholder="ZAR" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-contact-email">Contact email</Label>
            <Input id="ws-contact-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} disabled={!canEdit} placeholder="hello@acme.co.za" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-contact-phone">Contact phone</Label>
            <Input id="ws-contact-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} disabled={!canEdit} placeholder="+27 82 000 0000" />
          </div>
        </div>

        {canEdit && (
          <Button onClick={handleSave} disabled={saving || !name.trim() || !slug || checkingSlug || brandKitInvalid}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        )}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Brand Kit</CardTitle>
        <CardDescription>Used by Creative Studio to render adverts - logo, name and contact details come from the profile above.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4 rounded-lg border border-dashed p-3">
          <Avatar className="h-10 w-10 rounded-lg">
            <AvatarImage src={logoUrl || undefined} alt={name} className="object-contain" />
            <AvatarFallback className="rounded-lg text-sm">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{name || "Untitled workspace"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[website, contactEmail || contactPhone].filter(Boolean).join(" · ") || "No website or contact details set yet"}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <BrandColorField id="ws-brand-primary" label="Primary colour" value={primaryColor} onChange={setPrimaryColor} disabled={!canEdit} placeholder="#1F2937" invalid={primaryColorInvalid} />
          <BrandColorField id="ws-brand-secondary" label="Secondary colour" value={secondaryColor} onChange={setSecondaryColor} disabled={!canEdit} placeholder="#64748B" invalid={secondaryColorInvalid} />
          <BrandColorField id="ws-brand-accent" label="Accent colour" value={accentColor} onChange={setAccentColor} disabled={!canEdit} placeholder="#2563EB" invalid={accentColorInvalid} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ws-default-cta">Default CTA</Label>
          <Input id="ws-default-cta" value={defaultCta} onChange={(e) => setDefaultCta(e.target.value)} disabled={!canEdit} maxLength={40} placeholder="e.g. Get a free quote" />
          <p className="text-xs text-muted-foreground">Fallback only - a campaign's own CTA always takes priority over this.</p>
        </div>

        {canEdit && (
          <Button onClick={handleSave} disabled={saving || !name.trim() || !slug || checkingSlug || brandKitInvalid}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        )}
      </CardContent>
    </Card>

    {isOwner && (
      <Card>
        <CardHeader>
          <CardTitle>Data export</CardTitle>
          <CardDescription>Download a ZIP of your workspace profile, members, conversations, leads, opportunities, customers, attribution, revenue, content, campaigns, automations, and AI conversation history as CSV/JSON files. Never includes provider tokens or other secrets.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {exporting ? "Preparing export..." : "Export workspace data"}
          </Button>
        </CardContent>
      </Card>
    )}

    {isOwner && (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this workspace and everything in it - content, campaigns, conversations, leads, pipelines, opportunities,
            customers, attribution, revenue, automations, integrations, and uploaded files. This cannot be undone. Export your data first if you want a copy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>Delete workspace</Button>
        </CardContent>
      </Card>
    )}

    <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => { setDeleteDialogOpen(open); if (!open) setDeleteConfirmText(""); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{data.workspace.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes this workspace's content, campaigns, conversations, leads, pipelines, opportunities, customers,
            attribution, revenue, automations, connected integrations, and uploaded files. This cannot be undone.
            Type the workspace name (<strong>{data.workspace.name}</strong>) or its URL slug (<strong>{data.workspace.slug}</strong>) to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="ws-delete-confirm" className="sr-only">Confirm workspace name or slug</Label>
          <Input id="ws-delete-confirm" value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder={data.workspace.name} autoComplete="off" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleDelete(); }}
            disabled={!deleteConfirmMatches || deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Deleting..." : "Delete workspace permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </div>
  );
}
