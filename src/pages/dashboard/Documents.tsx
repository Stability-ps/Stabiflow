import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import QRCode from "qrcode";
import { AlertTriangle, Copy, Download, ExternalLink, Eye, FileText, MoreHorizontal, Plus } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
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

function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive-strong">
      <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Couldn't load {what}. Nothing has changed.</span>
      <Button variant="outline" size="sm" className="bg-card" onClick={onRetry}>Try again</Button>
    </div>
  );
}

/** entitled: null = we couldn't read the plan (never treated as "not included"). */
function HostedProfilePanel({ workspaceId, docs, canEdit, entitled, onRetryEntitlement }: { workspaceId: string; docs: BusinessDocument[]; canEdit: boolean; entitled: boolean | null; onRetryEntitlement: () => void }) {
  const qc = useQueryClient();
  const hp = useQuery({ queryKey: ["hosted-profile", workspaceId], queryFn: () => fetchHostedProfile(workspaceId) });
  const identity = useQuery({ queryKey: ["business-identity", workspaceId], queryFn: () => fetchBusinessIdentity(workspaceId) });
  if (hp.isLoading || identity.isLoading) return <div className="h-48 animate-pulse rounded-xl bg-muted" role="status" aria-label="Loading hosted profile" />;
  // A failed read must not open the editor as if no profile existed: saving
  // from there would try to create a second profile for this workspace.
  if (hp.isError) return <LoadError what="your hosted profile" onRetry={() => void hp.refetch()} />;
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
      onRetryEntitlement={onRetryEntitlement}
    />
  );
}

function HostedProfileEditor(props: {
  workspaceId: string; existing: HostedProfile | null; suggestedSlug: string; docs: BusinessDocument[]; canEdit: boolean; entitled: boolean | null; onSaved: () => void; onRetryEntitlement: () => void;
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
        <CardTitle className="flex flex-wrap items-center gap-2">
          Hosted business profile {existing?.is_published ? <StatusPill tone="success">Live</StatusPill> : <StatusPill tone="neutral">Not published</StatusPill>}
        </CardTitle>
        <CardDescription>A web page for your business with your services, credentials, contact details and profile download. Only published when you choose.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.entitled === null ? (
          <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive-strong">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Couldn't check whether your plan includes publishing.
            <Button variant="link" size="sm" className="h-auto p-0" onClick={props.onRetryEntitlement}>Try again</Button>
          </p>
        ) : !props.entitled && (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning" role="note">
            Hosted profiles are included with the Business and Growth plans. <Link className="font-medium text-foreground underline underline-offset-4" to="/app/billing">See plans</Link>
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="hp-slug">Your link</Label>
            <div className="flex items-center gap-1 text-sm">
              <span className="text-muted-foreground">/b/</span>
              <Input id="hp-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} disabled={!props.canEdit} aria-invalid={!slugValid} />
            </div>
            {!slugValid && <p className="text-xs text-destructive-strong">3-60 lowercase letters, numbers and dashes.</p>}
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
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-3">
            {qr && <img src={qr} alt={`QR code for ${publicUrl}`} className="h-28 w-28" />}
            <div className="space-y-2 text-sm">
              <p className="break-all font-medium text-foreground">{publicUrl}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(publicUrl).then(() => toast.success("Link copied"))}>
                  <Copy aria-hidden="true" /> Copy link
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" /> Open</a>
                </Button>
                {qr && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={qr} download={`${existing.slug}-qr.png`}><Download aria-hidden="true" /> QR code</a>
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
  const entitledHosted = ents.isError ? null : !!ents.data?.find((e) => e.entitlement_key === "hosted_profile.publish")?.enabled;

  async function download(d: BusinessDocument) {
    try {
      window.open(await documentDownloadUrl(d), "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title-page text-foreground">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your generated business documents and published profile.</p>
          {!docs.isLoading && (docs.data ?? []).length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {docs.data!.length} document{docs.data!.length === 1 ? "" : "s"} · {docs.data!.filter((d) => !d.watermarked).length} final · {docs.data!.filter((d) => d.watermarked).length} preview
            </p>
          )}
        </div>
        <Button asChild><Link to="/app/business-studio"><Plus aria-hidden="true" /> Create document</Link></Button>
      </header>
      {docs.isLoading ? (
        <div className="h-32 animate-pulse rounded-xl bg-muted" role="status" aria-label="Loading documents" />
      ) : docs.isError ? (
        <LoadError what="your documents" onRetry={() => void docs.refetch()} />
      ) : (docs.data ?? []).length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description="Create your company profile in Business Studio."
          action={<Button asChild><Link to="/app/business-studio">Open Business Studio</Link></Button>}
          className="rounded-xl border border-border bg-card"
        />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {docs.data!.map((d) => (
              <div key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-foreground">{d.title}</p>
                    <StatusPill tone="neutral" dot={false} className="capitalize">{d.template_key}</StatusPill>
                    <StatusPill tone={d.watermarked ? "neutral" : "success"}>{d.watermarked ? "Preview" : "Final PDF"}</StatusPill>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Generated {new Date(d.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })} · {d.page_count} page{d.page_count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => download(d)}>
                    <Eye aria-hidden="true" /> Preview
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download(d)}>
                    <Download aria-hidden="true" /> Download
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" aria-label={`More actions for ${d.title}`}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
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
      <HostedProfilePanel workspaceId={ws} docs={docs.data ?? []} canEdit={canEdit} entitled={entitledHosted} onRetryEntitlement={() => void ents.refetch()} />
    </div>
  );
}
