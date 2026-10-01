import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ExternalLink, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  acceptProposal, describeProposal, fetchPendingProposals, IDENTITY_FIELD_LABELS, PROPOSAL_TARGET_LABELS, rejectProposal, safeHref, type FactProposal,
} from "@/lib/businessStudio";

const ORIGIN_LABELS: Record<string, string> = {
  website_scan: "Found on your website",
  monitoring: "Changed on your website",
  ai_wording: "AI wording suggestion",
  document_upload: "From your existing profile",
};

// 44px touch targets on phones; the original compact size from sm up.
const TAP = "h-11 px-4 sm:h-9 sm:px-3";

// Keys the customer can correct per target when accepting.
const EDITABLE: Record<string, string[]> = {
  identity_field: ["value"],
  contact: ["value", "label"],
  location: ["address_line1", "city", "region", "postal_code"],
  social_link: ["url"],
  offering: ["name", "description"],
  team_member: ["full_name", "role_title"],
  project: ["title", "client_name", "description"],
  certification: ["name", "issuer"],
  identifier: ["value"],
};

function ProposalRow({ p, canEdit, onDone }: { p: FactProposal; canEdit: boolean; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const proposed = (p.proposed ?? {}) as Record<string, unknown>;
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries((EDITABLE[p.target] ?? []).map((k) => [k, Array.isArray(proposed[k]) ? (proposed[k] as string[]).join(", ") : String(proposed[k] ?? "")])),
  );
  const accept = useMutation({
    mutationFn: () => {
      if (!editing) return acceptProposal(p.id, null);
      const edited: Record<string, unknown> = { ...proposed };
      for (const [k, v] of Object.entries(draft)) {
        edited[k] = v.trim() === "" ? null : p.field === "core_values" ? v.split(",").map((x) => x.trim()).filter(Boolean) : p.field === "founded_year" ? Number(v) : v.trim();
      }
      return acceptProposal(p.id, edited);
    },
    onSuccess: onDone,
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({ mutationFn: () => rejectProposal(p.id), onSuccess: onDone, onError: (e: Error) => toast.error(e.message) });
  const current = (p.current_value as { value?: unknown } | null)?.value;
  const href = safeHref(p.evidence_url);
  const long = p.field === "long_description" || p.field === "short_description" || p.field === "mission" || p.field === "vision" || p.target === "offering" || p.target === "project";

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary">{p.target === "identity_field" ? IDENTITY_FIELD_LABELS[p.field ?? ""] ?? p.field : PROPOSAL_TARGET_LABELS[p.target]}</Badge>
        <span className="text-muted-foreground">{ORIGIN_LABELS[p.origin] ?? p.origin}</span>
        {p.extraction_method === "ai_extraction" && <span className="text-muted-foreground">· read by AI, quoted from your site</span>}
      </div>
      {editing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.keys(draft).map((k) => (
            <div key={k} className={long && (k === "value" || k === "description") ? "sm:col-span-2" : ""}>
              {long && (k === "value" || k === "description") ? (
                <Textarea aria-label={k} value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
              ) : (
                <Input aria-label={k} placeholder={k.replace(/_/g, " ")} value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="whitespace-pre-line break-words text-sm font-medium">{describeProposal(p)}</p>
      )}
      {current !== undefined && current !== null && current !== "" && (
        <p className="break-words text-xs text-muted-foreground">
          Currently: <span className="line-through">{Array.isArray(current) ? current.join(", ") : String(current)}</span>
        </p>
      )}
      {p.evidence && p.origin !== "ai_wording" && (
        <p className="break-words text-xs italic text-muted-foreground">
          “{p.evidence}”
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="ml-1 inline-flex items-center not-italic underline">
              source <ExternalLink className="ml-0.5 h-3 w-3" />
            </a>
          )}
        </p>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className={TAP} onClick={() => accept.mutate()} disabled={accept.isPending || reject.isPending}>
            <Check className="mr-1 h-4 w-4" /> {editing ? "Save and accept" : "Accept"}
          </Button>
          {!editing && (EDITABLE[p.target] ?? []).length > 0 && (
            <Button size="sm" variant="outline" className={TAP} onClick={() => setEditing(true)}>
              <Pencil className="mr-1 h-4 w-4" /> Correct
            </Button>
          )}
          <Button size="sm" variant="ghost" className={TAP} onClick={() => reject.mutate()} disabled={accept.isPending || reject.isPending}>
            <X className="mr-1 h-4 w-4" /> Not correct
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Review queue for facts found by a scan, the website monitor, an uploaded
 * profile or AI wording. Nothing reaches the Business Identity until the
 * customer accepts it here.
 */
export function ProposalReview({ workspaceId, canEdit, origins, emptyText }: { workspaceId: string; canEdit: boolean; origins?: string[]; emptyText?: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["fact-proposals", workspaceId], queryFn: () => fetchPendingProposals(workspaceId) });
  const [bulkBusy, setBulkBusy] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["fact-proposals", workspaceId] });
    qc.invalidateQueries({ queryKey: ["business-identity", workspaceId] });
  };
  const rows = (q.data ?? []).filter((p) => !origins || origins.includes(p.origin));
  const structured = rows.filter((p) => p.extraction_method === "structured_data" || p.extraction_method === "pattern");

  async function acceptAllStructured() {
    setBulkBusy(true);
    let failed = 0;
    for (const p of structured) {
      try {
        await acceptProposal(p.id, null);
      } catch {
        failed++;
      }
    }
    setBulkBusy(false);
    if (failed) toast.error(`${failed} could not be accepted`);
    refresh();
  }

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyText ?? "Nothing waiting for review."}</p>;
  return (
    <div className="space-y-3">
      {canEdit && structured.length > 1 && (
        <Button size="sm" variant="outline" className={`${TAP} h-auto min-h-11 whitespace-normal sm:min-h-9`} onClick={acceptAllStructured} disabled={bulkBusy}>
          Accept all {structured.length} contact and listing details
        </Button>
      )}
      {rows.map((p) => (
        <ProposalRow key={p.id} p={p} canEdit={canEdit} onDone={refresh} />
      ))}
    </div>
  );
}
