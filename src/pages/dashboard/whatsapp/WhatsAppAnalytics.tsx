import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { useWhatsAppOutlet } from "@/pages/dashboard/whatsapp/whatsappOutlet";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";
import { useWhatsAppOperationalAnalytics } from "@/hooks/useWhatsAppOperationalAnalytics";
import {
  DATE_RANGE_PRESET_LABELS,
  previousComparisonRange,
  resolveDateRangePreset,
  type DateRangePreset,
} from "@/lib/analyticsDate";
import {
  formatDuration,
  formatRate,
  handlingBreakdown,
  isEmptyAnalytics,
  periodDelta,
  ratePointDelta,
  type DeltaDirection,
  type WhatsAppOperationalAnalytics,
} from "@/lib/whatsappAnalytics";

// Phase 11 requires only Last 7 / 30 / 90 days.
const PRESETS: DateRangePreset[] = ["last_7_days", "last_30_days", "last_90_days"];

function DeltaText({ direction, label, goodWhenDown }: { direction: DeltaDirection; label: string; goodWhenDown?: boolean }) {
  if (direction === "none" || !label) return null;
  const good = direction === "flat"
    ? undefined
    : goodWhenDown
      ? direction === "down"
      : direction === "up";
  const tone = good === undefined
    ? "text-muted-foreground"
    : good
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-600 dark:text-amber-400";
  return <span className={`text-xs ${tone}`}>{label} vs previous</span>;
}

function Kpi({ title, value, delta }: { title: string; value: string; delta?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {delta}
      </CardContent>
    </Card>
  );
}

function HandlingBar({ data }: { data: WhatsAppOperationalAnalytics }) {
  const rows = handlingBreakdown(data);
  const total = rows.reduce((s, r) => s + r.count, 0);
  const palette: Record<string, string> = {
    handled_ai_only: "bg-sky-500",
    handled_human_assisted: "bg-violet-500",
    handled_human_only: "bg-emerald-500",
    handled_no_agent_reply: "bg-muted-foreground/40",
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">How conversations were handled</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="AI vs human handling split">
          {rows.map((r) => (
            r.count > 0 ? <div key={r.key} className={palette[r.key]} style={{ width: `${(r.count / total) * 100}%` }} /> : null
          ))}
        </div>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${palette[r.key]}`} aria-hidden="true" />
                {r.label}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {r.count} · {formatRate(r.pct)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function WhatsAppAnalytics() {
  const { workspaceId } = useWhatsAppOutlet();
  const timezone = useWorkspaceTimezone(workspaceId);
  const [preset, setPreset] = useState<DateRangePreset>("last_30_days");
  // Captured once per mount/preset change so the resolved range (and every
  // query key) stays stable within a session (same pattern as Analytics).
  const [now] = useState(() => new Date());

  const range = useMemo(() => {
    try {
      return resolveDateRangePreset(preset, timezone, now);
    } catch {
      return null;
    }
  }, [preset, timezone, now]);
  const previousRange = useMemo(() => (range ? previousComparisonRange(range) : null), [range]);

  const { data, isLoading } = useWhatsAppOperationalAnalytics(workspaceId, range);
  const { data: previous } = useWhatsAppOperationalAnalytics(workspaceId, previousRange);

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">WhatsApp Analytics</h2>
        <p className="text-sm text-muted-foreground">Operational performance for customer conversations.</p>
      </div>
      <Select value={preset} onValueChange={(v) => setPreset(v as DateRangePreset)}>
        <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => <SelectItem key={p} value={p}>{DATE_RANGE_PRESET_LABELS[p]}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  if (isLoading || !range) {
    return (
      <div className="space-y-4">
        {header}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}
        </div>
      </div>
    );
  }

  if (isEmptyAnalytics(data)) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          icon={BarChart3}
          title="No WhatsApp conversation data yet"
          description="Operational metrics appear here once customers start messaging your connected WhatsApp number."
        />
      </div>
    );
  }

  const a = data as WhatsAppOperationalAnalytics;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          title="Conversations"
          value={String(a.conversations_started)}
          delta={<DeltaText {...periodDelta(a.conversations_started, previous?.conversations_started)} />}
        />
        <Kpi
          title="Median human response"
          value={formatDuration(a.median_human_response_seconds)}
          delta={<DeltaText {...periodDelta(a.median_human_response_seconds, previous?.median_human_response_seconds ?? null)} goodWhenDown />}
        />
        <Kpi
          title="Handoff rate"
          value={formatRate(a.handoff_rate)}
          delta={<DeltaText {...ratePointDelta(a.handoff_rate, previous?.handoff_rate ?? null)} goodWhenDown />}
        />
        <Kpi
          title="Median resolution"
          value={formatDuration(a.median_resolution_seconds)}
          delta={<DeltaText {...periodDelta(a.median_resolution_seconds, previous?.median_resolution_seconds ?? null)} goodWhenDown />}
        />
        <Kpi
          title="Intake completion"
          value={formatRate(a.intake_completion_rate)}
          delta={<DeltaText {...ratePointDelta(a.intake_completion_rate, previous?.intake_completion_rate ?? null)} />}
        />
      </div>

      <HandlingBar data={a} />

      <p className="text-xs text-muted-foreground">
        {a.human_response_sample_size} conversation{a.human_response_sample_size === 1 ? "" : "s"} handed to a human ·{" "}
        {a.conversations_resolved} resolved ·{" "}
        {a.intake_applicable > 0
          ? `${a.intake_completed} of ${a.intake_applicable} structured-intake conversations completed`
          : "no structured-intake conversations in this period"}
        {" · "}{a.inbound_messages} inbound message{a.inbound_messages === 1 ? "" : "s"}.
        {" "}Response and resolution times use the median; “—” or “N/A” means not enough data, not zero.
      </p>
    </div>
  );
}
