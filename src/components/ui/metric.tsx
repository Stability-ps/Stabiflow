import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

// Figma "Metric" - a KPI tile with five honest states. Missing data is never
// shown as 0:
//   value         a real measured number ("R 48 210", "12")
//   zero          a real measured zero - 0 IS data
//   no_data       nothing recorded for this period / source ("—")
//   not_connected the integration behind it isn't connected
//   locked        the workspace plan doesn't include it
export type MetricState =
  | { kind: "value"; value: string; note?: ReactNode }
  | { kind: "zero"; value?: string; note?: ReactNode }
  | { kind: "no_data"; note?: ReactNode }
  | { kind: "not_connected"; note: ReactNode }
  | { kind: "locked"; plan: string; note?: ReactNode };

export function Metric({ label, state, icon, to, className }: {
  label: string;
  state: MetricState;
  icon?: ReactNode;
  /** Makes the whole tile a link to its detail / fix / upgrade view. */
  to?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-label text-muted-foreground">{label}</p>
        {state.kind === "locked" ? <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : icon}
      </div>
      <MetricValue state={state} />
      <MetricNote state={state} />
    </>
  );
  const base = "flex min-h-[6.5rem] flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3.5";
  return to ? (
    <Link
      to={to}
      data-metric-state={state.kind}
      className={cn(base, "transition-colors duration-fast hover:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}
    >
      {body}
    </Link>
  ) : (
    <div data-metric-state={state.kind} className={cn(base, className)}>{body}</div>
  );
}

// Slightly smaller on phones so two tiles fit side by side with full
// currency values ("ZAR 48,210.00"); the design-system size from sm up.
const VALUE = "text-[1.375rem] font-semibold leading-7 tracking-tight tabular-nums text-foreground sm:text-metric";

function MetricValue({ state }: { state: MetricState }) {
  switch (state.kind) {
    case "value":
      return <p className={VALUE}>{state.value}</p>;
    case "zero":
      return <p className={VALUE}>{state.value ?? "0"}</p>;
    case "no_data":
      return (
        <p className="text-[1.375rem] font-semibold leading-7 text-muted-foreground sm:text-metric">
          <span aria-hidden="true">—</span>
          <span className="sr-only">No data</span>
        </p>
      );
    case "not_connected":
      return <p className="mt-1 text-title-section text-muted-foreground">Not connected</p>;
    case "locked":
      return <p className="mt-1 text-title-section text-muted-foreground">{state.plan}</p>;
  }
}

function MetricNote({ state }: { state: MetricState }) {
  const fallback: Record<MetricState["kind"], string> = {
    value: "",
    zero: "Measured this period",
    no_data: "No data for this period",
    not_connected: "",
    locked: "Not included in your current plan",
  };
  const note = state.note ?? fallback[state.kind];
  if (!note) return null;
  return <p className={cn("mt-auto text-xs", state.kind === "not_connected" ? "text-link" : "text-muted-foreground")}>{note}</p>;
}
