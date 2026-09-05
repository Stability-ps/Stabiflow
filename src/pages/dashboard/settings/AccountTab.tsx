import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { updateOwnProfile } from "@/lib/accountProfile";
import { useOwnLegalAcceptances } from "@/hooks/useLegalAcceptances";

const LEGAL_DOCUMENT_LABELS: Record<string, string> = {
  privacy_policy: "Privacy Policy",
  terms_of_service: "Terms of Service",
};

function formatAcceptedDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

function initials(name: string | null | undefined, email: string | null | undefined) {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}

export function AccountTab() {
  const { user, profile, refreshMemberships, signOut } = useAuth();
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: acceptances } = useOwnLegalAcceptances(user?.id);

  useEffect(() => {
    setFullName(profile?.full_name || "");
  }, [profile]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await updateOwnProfile(user.id, { full_name: fullName });
      await refreshMemberships(); // profile is refetched alongside memberships in loadProfileAndMemberships
      toast.success("Profile updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your account</CardTitle>
          <CardDescription>These details are yours across every workspace you belong to.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="text-lg">{initials(profile?.full_name, user?.email)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">{user?.email}</p>
              <p className="text-xs text-muted-foreground">Signed in</p>
            </div>
          </div>

          <div className="space-y-1.5 max-w-sm">
            <Label htmlFor="full-name">Full name</Label>
            <Input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Jane Dlamini" />
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save changes"}</Button>
            <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Legal</CardTitle>
          <CardDescription>How StabiFlow handles data, and your rights.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-4">
            <Link to="/legal/privacy" target="_blank" rel="noreferrer" className="underline">Privacy Policy</Link>
            <Link to="/legal/terms" target="_blank" rel="noreferrer" className="underline">Terms of Service</Link>
            <Link to="/legal/data-deletion" target="_blank" rel="noreferrer" className="underline">Data Deletion</Link>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Legal agreements</p>
            <div className="space-y-1">
              {(["privacy_policy", "terms_of_service"] as const).map((docType) => {
                const accepted = acceptances?.find((a) => a.document_type === docType);
                return (
                  <p key={docType} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{LEGAL_DOCUMENT_LABELS[docType]}:</span>{" "}
                    {accepted
                      ? `Accepted ${formatAcceptedDate(accepted.accepted_at)} · Version ${accepted.document_version}`
                      : "No recorded acceptance"}
                  </p>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
