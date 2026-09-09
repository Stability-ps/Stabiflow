import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { BrandColorField } from "@/components/creative-studio/BrandColorField";
import { supabase } from "@/integrations/supabase/client";
import { HEX_COLOR_RE, normalizeHexColor } from "@/lib/workspaceProfile";
import { uploadContentMediaAsset, updateContentMediaAssetRole, getContentAssetPreviewUrl } from "@/lib/contentMediaAssets";
import { createBrandProfile, updateBrandProfile, type BrandProfile } from "@/lib/brandProfiles";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  userId: string;
  /** null = creating a new profile. */
  profile: BrandProfile | null;
  onSaved: (profile: BrandProfile) => void;
};

function useColorState(initial: string) {
  const [value, setValue] = useState(initial);
  const normalized = value.trim() ? normalizeHexColor(value) : null;
  const invalid = !!value.trim() && !(normalized && HEX_COLOR_RE.test(normalized));
  return { value, setValue, normalized, invalid };
}

// The single Brand Profile editor - the authoritative brand-management
// surface for the whole product (instruction #24: Creative Studio owns
// editing, Settings -> Workspace only links here). Handles both create
// and edit; colour fields reuse the exact shipped picker+hex UX via
// BrandColorField.
export function BrandProfileEditor({ open, onOpenChange, workspaceId, userId, profile, onSaved }: Props) {
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [defaultCta, setDefaultCta] = useState("");
  const [footerDisclaimer, setFooterDisclaimer] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [logoMediaAssetId, setLogoMediaAssetId] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const primary = useColorState("");
  const secondary = useColorState("");
  const accent = useColorState("");
  const ctaText = useColorState("");

  useEffect(() => {
    if (!open) return;
    setLogoPreviewUrl(null);
    if (profile) {
      setName(profile.name);
      setCompanyName(profile.companyName);
      setContactPhone(profile.contactPhone || "");
      setWhatsappNumber(profile.whatsappNumber || "");
      setContactEmail(profile.contactEmail || "");
      setWebsite(profile.website || "");
      setAddress(profile.address || "");
      setDefaultCta(profile.defaultCta || "");
      setFooterDisclaimer(profile.footerDisclaimer || "");
      setIsDefault(profile.isDefault);
      setLogoMediaAssetId(profile.logoMediaAssetId);
      primary.setValue(profile.primaryColor || "");
      secondary.setValue(profile.secondaryColor || "");
      accent.setValue(profile.accentColor || "");
      ctaText.setValue(profile.ctaTextColor || "");
    } else {
      setName("");
      setCompanyName("");
      setContactPhone("");
      setWhatsappNumber("");
      setContactEmail("");
      setWebsite("");
      setAddress("");
      setDefaultCta("");
      setFooterDisclaimer("");
      setIsDefault(false);
      setLogoMediaAssetId(null);
      primary.setValue("");
      secondary.setValue("");
      accent.setValue("");
      ctaText.setValue("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile]);

  // Resolves a preview URL when opening the editor for a profile that
  // already has a saved logo. The upload handler below sets
  // logoPreviewUrl directly for a freshly-picked file, so this only
  // needs to run for the "editing an existing profile" case.
  useEffect(() => {
    if (!open || !profile?.logoMediaAssetId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("content_media_assets").select("storage_path").eq("id", profile.logoMediaAssetId as string).maybeSingle();
      if (cancelled || !data) return;
      const url = await getContentAssetPreviewUrl((data as { storage_path: string }).storage_path, 300);
      if (!cancelled) setLogoPreviewUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, profile]);

  const invalid = primary.invalid || secondary.invalid || accent.invalid || ctaText.invalid;

  async function handleLogoFile(file: File) {
    setUploadingLogo(true);
    try {
      const result = await uploadContentMediaAsset({ workspaceId, file, title: `${companyName || name || "Brand"} logo`, createdBy: userId });
      const asset = result.kind === "duplicate" ? result.existing : result.asset;
      const assetId = asset.id as string;
      await updateContentMediaAssetRole(assetId, "logo");
      setLogoMediaAssetId(assetId);
      const previewUrl = await getContentAssetPreviewUrl(asset.storage_path as string, 300);
      setLogoPreviewUrl(previewUrl);
      toast.success(result.kind === "duplicate" ? "Using your existing matching logo" : "Logo uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload logo");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleSave() {
    if (!name.trim() || !companyName.trim()) {
      toast.error("Give this brand a name and company name.");
      return;
    }
    if (invalid) {
      toast.error("Colours must be a valid hex code, e.g. #1F2937.");
      return;
    }
    setSaving(true);
    try {
      const input = {
        name: name.trim(),
        companyName: companyName.trim(),
        logoMediaAssetId,
        primaryColor: primary.normalized,
        secondaryColor: secondary.normalized,
        accentColor: accent.normalized,
        ctaTextColor: ctaText.normalized,
        contactPhone: contactPhone.trim() || null,
        whatsappNumber: whatsappNumber.trim() || null,
        contactEmail: contactEmail.trim() || null,
        website: website.trim() || null,
        address: address.trim() || null,
        defaultCta: defaultCta.trim() || null,
        footerDisclaimer: footerDisclaimer.trim() || null,
        isDefault,
      };
      const saved = profile ? await updateBrandProfile(profile.id, workspaceId, input) : await createBrandProfile(workspaceId, input);
      toast.success(profile ? "Brand updated" : "Brand created");
      onSaved(saved);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save brand");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{profile ? "Edit brand" : "New brand"}</DialogTitle>
          <DialogDescription>Used to populate and render adverts in Creative Studio - logo, colours and contact details.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bp-name">Brand name (internal label)</Label>
              <Input id="bp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car Smart Fix" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-company">Company name</Label>
              <Input id="bp-company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Car Smart Fix (Pty) Ltd" maxLength={200} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Logo</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border bg-muted">
                {logoPreviewUrl ? <img src={logoPreviewUrl} alt="Logo preview" className="h-full w-full object-contain" /> : <span className="text-xs text-muted-foreground">None</span>}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleLogoFile(e.target.files[0])}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadingLogo}>
                {uploadingLogo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {uploadingLogo ? "Uploading..." : logoMediaAssetId ? "Replace logo" : "Upload logo"}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <BrandColorField id="bp-primary" label="Primary colour" value={primary.value} onChange={primary.setValue} disabled={false} placeholder="#1F2937" invalid={primary.invalid} />
            <BrandColorField id="bp-secondary" label="Secondary colour" value={secondary.value} onChange={secondary.setValue} disabled={false} placeholder="#64748B" invalid={secondary.invalid} />
            <BrandColorField id="bp-accent" label="Accent colour" value={accent.value} onChange={accent.setValue} disabled={false} placeholder="#2563EB" invalid={accent.invalid} />
            <BrandColorField id="bp-cta-text" label="CTA text colour" value={ctaText.value} onChange={ctaText.setValue} disabled={false} placeholder="#FFFFFF" invalid={ctaText.invalid} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bp-phone">Phone</Label>
              <Input id="bp-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+27 82 000 0000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-whatsapp">WhatsApp</Label>
              <Input id="bp-whatsapp" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="+27 82 000 0000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-email">Email</Label>
              <Input id="bp-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="hello@acme.co.za" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-website">Website</Label>
              <Input id="bp-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://acme.co.za" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bp-address">Address (optional)</Label>
            <Input id="bp-address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bp-cta">Default CTA</Label>
            <Input id="bp-cta" value={defaultCta} onChange={(e) => setDefaultCta(e.target.value)} maxLength={40} placeholder="e.g. Get a free quote" />
            <p className="text-xs text-muted-foreground">Fallback only - a campaign's own CTA always takes priority over this.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bp-disclaimer">Footer / disclaimer (optional)</Label>
            <Textarea id="bp-disclaimer" value={footerDisclaimer} onChange={(e) => setFooterDisclaimer(e.target.value)} maxLength={300} rows={2} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(v === true)} />
            Make this the default brand for this workspace
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || invalid}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving..." : "Save brand"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
