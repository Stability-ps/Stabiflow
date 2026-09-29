import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { operatorAdmin } from "@/lib/operatorAdmin";

type Data = {
  scans: { id: string; requested_url: string; final_url: string | null; purpose: string; status: string; pages_fetched: number; error: string | null; created_at: string; workspaces: { name: string } | null }[];
  documents: { id: string; title: string; template_key: string; watermarked: boolean; page_count: number | null; created_at: string; workspaces: { name: string } | null }[];
  hostedProfiles: { workspace_id: string; slug: string; is_published: boolean; published_at: string | null; workspaces: { name: string } | null }[];
  pendingProposals: number;
  templates: { key: string; name: string; description: string | null; is_premium: boolean; is_active: boolean }[];
};

const d = (v: string | null) => (v ? new Date(v).toLocaleString() : "-");

/** Website scans, documents, hosted profiles and profile designs. */
export function OperatorBusinessStudio() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["op-bstudio"], queryFn: () => operatorAdmin<Data>("business_studio") });
  const update = useMutation({
    mutationFn: (v: { key: string; update: Record<string, unknown> }) => operatorAdmin("update_template", { template_key: v.key, update: v.update }),
    onSuccess: () => {
      toast.success("Design updated");
      qc.invalidateQueries({ queryKey: ["op-bstudio"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (q.error || !q.data) return <p className="text-sm text-destructive">Could not load Business Studio data.</p>;
  const x = q.data;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{x.pendingProposals} business facts are waiting for customers to review.</p>
      <Card>
        <CardHeader><CardTitle className="text-base">Profile designs</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {x.templates.map((t) => (
            <div key={t.key} className="flex flex-wrap items-center gap-4 text-sm">
              <span className="w-40 font-medium">{t.name}</span>
              <div className="flex items-center gap-2">
                <Checkbox id={`tpl-${t.key}-p`} checked={t.is_premium} onCheckedChange={(v) => update.mutate({ key: t.key, update: { is_premium: !!v } })} />
                <Label htmlFor={`tpl-${t.key}-p`}>Paid only</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id={`tpl-${t.key}-a`} checked={t.is_active} onCheckedChange={(v) => update.mutate({ key: t.key, update: { is_active: !!v } })} />
                <Label htmlFor={`tpl-${t.key}-a`}>Available</Label>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Recent website scans</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {x.scans.length === 0 && <p className="text-muted-foreground">No scans yet.</p>}
          {x.scans.map((s) => (
            <p key={s.id}>
              {d(s.created_at)} · {s.workspaces?.name} · <span className="break-all">{s.final_url ?? s.requested_url}</span> · {s.purpose} ·{" "}
              <Badge variant={s.status === "completed" ? "outline" : "destructive"}>{s.status}</Badge> · {s.pages_fetched} pages{s.error ? ` · ${s.error}` : ""}
            </p>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Recent documents</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {x.documents.length === 0 && <p className="text-muted-foreground">No documents yet.</p>}
          {x.documents.map((doc) => (
            <p key={doc.id}>{d(doc.created_at)} · {doc.workspaces?.name} · {doc.title} · {doc.template_key} · {doc.page_count} pages{doc.watermarked ? " · preview" : " · paid"}</p>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Hosted profiles</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {x.hostedProfiles.length === 0 && <p className="text-muted-foreground">None yet.</p>}
          {x.hostedProfiles.map((h) => (
            <p key={h.workspace_id}>
              {h.workspaces?.name} · <a className="underline" href={`/b/${h.slug}`} target="_blank" rel="noopener noreferrer">/b/{h.slug}</a> · {h.is_published ? `live since ${d(h.published_at)}` : "not published"}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
