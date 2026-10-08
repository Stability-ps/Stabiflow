import type { LeadRow, PipelineStage } from "@/hooks/useLeads";
import { StatusPill } from "@/components/ui/status-pill";
import { leadDisplayName, relativeAge, sourceLabel, staleDays } from "@/lib/leadsWorkspace";
import { qualificationStatusLabel } from "@/lib/qualification";
import { FollowUpPill, StagePill } from "@/pages/dashboard/leads/LeadPills";

function formatValue(value: number | null): string | null {
  const n = Number(value);
  return value != null && n > 0 ? `R ${n.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}` : null;
}

// Columns from lg up; below that each lead is a stacked, scannable card row.
// lg: lead, stage, owner, follow-up, value; xl adds source and last update.
const GRID =
  "lg:grid lg:grid-cols-[minmax(11rem,1fr)_8rem_7.5rem_12rem_5.5rem] lg:items-center lg:gap-3 " +
  "xl:grid-cols-[minmax(12rem,1fr)_8.5rem_8rem_7rem_13rem_5.5rem_6rem]";

/**
 * Lead rows. Everything needed to decide whether a lead needs attention is
 * on the row: stage, owner, source, follow-up state (or staleness), last
 * update and value - no need to open each lead.
 */
export function LeadList({ leads, stagesById, ownerName, onSelect, now }: {
  leads: LeadRow[];
  stagesById: Map<string, PipelineStage>;
  ownerName: (userId: string | null) => string | null;
  onSelect: (id: string) => void;
  now: Date;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div aria-hidden="true" className={`hidden border-b border-border bg-background/60 px-4 py-2 text-overline uppercase text-muted-foreground ${GRID}`}>
        <span>Lead</span><span>Stage</span><span>Owner</span><span className="hidden xl:block">Source</span><span>Follow-up</span><span className="hidden xl:block">Updated</span><span className="text-right">Value</span>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" aria-label="Leads">
        {leads.map((l) => {
          const name = leadDisplayName(l);
          const owner = ownerName(l.assigned_to);
          const stale = staleDays(l, now);
          const value = formatValue(l.estimated_value);
          const stage = l.pipeline_stage_id ? stagesById.get(l.pipeline_stage_id) : undefined;
          const subtitle = [l.company_name, l.human_reference].filter(Boolean).join(" · ");
          return (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => onSelect(l.id)}
                className={`w-full px-4 py-3 text-left transition-colors duration-fast hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${GRID}`}
              >
                {/* Lead */}
                <span className="flex min-w-0 items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground" title={name}>{name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {subtitle}
                      <span className="xl:hidden"> · {sourceLabel(l.source)}</span>
                    </span>
                  </span>
                  {value ? <span className="shrink-0 text-sm font-medium tabular-nums text-foreground lg:hidden">{value}</span> : null}
                </span>
                {/* Stage + follow-up + owner: one wrapping line on phones */}
                <span className="mt-2 flex flex-wrap items-center gap-1.5 lg:contents">
                  <span className="lg:min-w-0">
                    <StagePill lead={l} stage={stage} />
                    {l.status === "active" && l.qualification_status === "qualified" ? <span className="sr-only">, {qualificationStatusLabel(l.qualification_status)}</span> : null}
                  </span>
                  <span className={`text-xs lg:truncate lg:text-sm ${owner ? "text-muted-foreground lg:text-foreground" : "font-medium text-warning"}`}>
                    <span className="sr-only">Owner: </span>{owner ?? "Unassigned"}
                  </span>
                  <span className="hidden truncate text-sm text-muted-foreground xl:block">{sourceLabel(l.source)}</span>
                  <span className="flex min-w-0 flex-col gap-0.5 lg:items-start">
                    {l.status === "active" && !l.archived_at ? (
                      stale !== null ? (
                        <StatusPill tone="neutral">Stale · {stale}d</StatusPill>
                      ) : (
                        <FollowUpPill lead={l} now={now} />
                      )
                    ) : null}
                    {l.follow_up_note && l.next_follow_up_at ? <span className="hidden max-w-full truncate text-xs text-muted-foreground lg:block" title={l.follow_up_note}>{l.follow_up_note}</span> : null}
                  </span>
                  <span className="hidden text-sm text-muted-foreground xl:block">{relativeAge(l.updated_at, now)}</span>
                  <span className="hidden text-right text-sm font-medium tabular-nums text-foreground lg:block">{value ?? <span className="text-muted-foreground" aria-label="No value">—</span>}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
