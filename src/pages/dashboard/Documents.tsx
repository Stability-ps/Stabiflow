import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Copy, Download, ExternalLink, Eye, FileText, Loader2, MoreHorizontal, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { fetchEntitlements } from "@/lib/billing";
import { fetchBusinessIdentity } from "@/lib/businessIdentity";
import {
  documentDownloadUrl, fetchDocuments, fetchHostedProfile, PUBLIC_PROFILE_PATH, saveHostedProfile, slugify, type BusinessDocument, type HostedProfile,
} from "@/lib/businessStudio";

function HostedProfilePanel({ workspaceId, docs, canEdit, entitled }: { workspaceId: string; docs: BusinessDocument[]; canEdit: boolean; entitled: boolean }) {
  const qc = useQueryClient();
  const hp = useQuery({ queryKey: ["hosted-profile", workspaceId], queryFn: () => fetchHostedProfile(workspaceId) });
  const identity = useQuery({ queryKey: ["business-identity", workspaceId], queryFn: () => fetchBusinessIdentity(workspaceId) });
  if (hp.isLoading || identity.isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
  return (
    <HostedProfileEditor
      key={hp.data?.updated_at ?? "new"}
      workspaceId={workspaceId}
      existing={hp.data ?? null}
      suggestedSlug={slugify(identity.data?.identity.trading_name ?? identity.data?.identity.legal_name ?? "") || "my-business"}
      docs={docs.filter((d) => !d.watermarked)}
      canEdit={canEdit}
      entitled={entitled}
      onSaved={() => qc.invalidateQueries({ queryKey: ["hosted-profile", workspaceId] })}
    />
  );
}

function HostedProfileEditor(props: {
  workspaceId: string; existing: HostedProfile | null; suggestedSlug: string; docs: BusinessDocument[]; canEdit: boolean; entitled: boolean; onSaved: () => void;
}) {
  const { existing } = props;
  const [slug, setSlug] = useState(existing?.slug ?? props.suggestedSlug);
  const [documentId, setDocumentId] = useState(existing?.document_id ?? "none");
  const [showEnquiry, setShowEnquiry] = useState(existing?.show_enquiry ?? true);
  const [qr, setQr] = useState<string | null>(null);
  const publicUrl = `${window.location.origin}${PUBLIC_PROFILE_PATH(existing?.slug ?? slug)}`;

  useEffect(() => {
    if (!existing?.is_published) return;
    QRCode.toDataURL(publicUrl, { margin: 1, width: 240 }).then(setQr).catch(() => setQr(null));
  }, [existing?.is_published, publicUrl]);

  const save = useMutation({
    mutationFn: (publish: boolean) =>
      saveHostedProfile(props.workspaceId, { slug, is_published: publish, document_id: documentId === "none" ? null : documentId, show_enquiry: showEnquiry }, !!existing),
    onSuccess: (_d, publish) => {
      toast.success(publish ? "Your profile is live" : existing?.is_published ? "Profile unpublished" : "Saved");
      props.onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const slugValid = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/.test(slug);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Hosted business profile {existing?.is_published ? <Badge>Live</Badge> : <Badge variant="outline">Not published</Badge>}
        </CardTitle>
        <CardDescription>A web page for your business with your services, credentials, contact details and profile download. Only published when you choose.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!props.entitled && (
          <p className="text-sm">
            Hosted profiles are included with the Business and Growth plans. <Link className="underline" to="/app/billing">See plans</Link>
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="hp-slug">Your link</Label>
            <div className="flex items-center gap-1 text-sm">
              <span className="text-muted-foreground">/b/</span>
              <Input id="hp-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} disabled={!props.canEdit} aria-invalid={!slugValid} />
            </div>
            {!slugValid && <p className="text-xs text-destructive">3-60 lowercase letters, numbers and dashes.</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="hp-doc">Profile document visitors can download</Label>
            <Select value={documentId} onValueChange={setDocumentId} disabled={!props.canEdit}>
              <SelectTrigger id="hp-doc"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {props.docs.map((d) => <SelectItem key={d.id} value={d.id}>{d.title} · {d.template_key.charAt(0).toUpperCase() + d.template_key.slice(1)} · {d.page_count} pages</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Checkbox id="hp-enquiry" checked={showEnquiry} onCheckedChange={(v) => setShowEnquiry(!!v)} disabled={!props.canEdit} />
            <Label htmlFor="hp-enquiry">Show Contact us / WhatsApp buttons</Label>
          </div>
        </div>
        {props.canEdit && (
          <div className="flex flex-wrap gap-2">
            {existing?.is_published ? (
              <>
                <Button onClick={() => save.mutate(true)} disabled={!slugValid || save.isPending}>Save changes</Button>
                <Button variant="outline" onClick={() => save.mutate(false)} disabled={save.isPending}>Unpublish</Button>
              </>
            ) : (
              <>
                <Button onClick={() => save.mutate(true)} disabled={!slugValid || !props.entitled || save.isPending}>Publish profile</Button>
                <Button variant="outline" onClick={() => save.mutate(false)} disabled={!slugValid || save.isPending}>Save draft</Button>
              </>
            )}
          </div>
        )}
        {existing?.is_published && (
          <div className="flex flex-wrap items-center gap-4 rounded-md border p-3">
            {qr && <img src={qr} alt={`QR code for ${publicUrl}`} className="h-28 w-28" />}
            <div className="space-y-2 text-sm">
              <p className="break-all font-medium">{publicUrl}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(publicUrl).then(() => toast.success("Link copied"))}>
                  <Copy className="mr-1 h-4 w-4" /> Copy link
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-4 w-4" /> Open</a>
                </Button>
                {qr && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={qr} download={`${existing.slug}-qr.png`}><Download className="mr-1 h-4 w-4" /> QR code</a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Documents() {
  const { currentWorkspaceId: ws, currentMembership } = useAuth();
  const canEdit = currentMembership?.role === "owner" || currentMembership?.role === "admin";
  const docs = useQuery({ queryKey: ["business-documents", ws], queryFn: () => fetchDocuments(ws as string), enabled: !!ws });
  const ents = useQuery({ queryKey: ["entitlements", ws], queryFn: () => fetchEntitlements(ws as string), enabled: !!ws });
  if (!ws) return null;
  const entitledHosted = !!ents.data?.find((e) => e.entitlement_key === "hosted_profile.publish")?.enabled;

  async function download(d: BusinessDocument) {
    try {
      window.open(await documentDownloadUrl(d), "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-sm text-muted-foreground">Your generated business documents and published profile.</p>
          {!docs.isLoading && (docs.data ?? []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{docs.data!.length} document{docs.data!.length === 1 ? "" : "s"}</span>
              <span>·</span>
              <span>{docs.data!.filter((d) => !d.watermarked).length} final</span>
              <span>·</span>
              <span>{docs.data!.filter((d) => d.watermarked).length} preview</span>
            </div>
          )}
        </div>
        <Button asChild><Link to="/app/business-studio"><Plus className="mr-1 h-4 w-4" /> Create document</Link></Button>
      </div>
      {docs.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (docs.data ?? []).length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description="Create your company profile in Business Studio."
          action={<Button asChild><Link to="/app/business-studio">Open Business Studio</Link></Button>}
        />
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {docs.data!.map((d) => (
              <div key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{d.title}</p>
                    <Badge variant="secondary" className="capitalize">{d.template_key}</Badge>
                    <Badge variant={d.watermarked ? "outline" : "default"}>{d.watermarked ? "Preview" : "Final PDF"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Generated {new Date(d.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })} · {d.page_count} page{d.page_count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => download(d)}>
                    <Eye className="mr-1 h-4 w-4" /> Preview
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download(d)}>
                    <Download className="mr-1 h-4 w-4" /> Download
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" aria-label={`More actions for ${d.title}`}><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => download(d)}>Open document</DropdownMenuItem>
                      {!d.watermarked && <DropdownMenuItem onClick={() => navigator.clipboard.writeText(d.title).then(() => toast.success("Document name copied"))}>Copy document name</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <HostedProfilePanel workspaceId={ws} docs={docs.data ?? []} canEdit={canEdit} entitled={entitledHosted} />
    </div>
  );
}
