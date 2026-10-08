import type { LucideIcon } from "lucide-react";
import { Metric } from "@/components/ui/metric";

// `value` is undefined/null when there's genuinely no real data source (or
// permission) behind this metric yet - renders emptyMessage in that case.
// A real, currently-zero value is passed as the STRING "0" (or "$0.00"),
// which renders as a real number - never conflated with "unavailable".
// Screens that know *why* data is missing (not connected, locked) should use
// <Metric> directly with the matching state.
export function MetricCard({ icon: Icon, label, emptyMessage, value }: { icon: LucideIcon; label: string; emptyMessage: string; value?: string }) {
  return (
    <Metric
      label={label}
      icon={<Icon className="h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden="true" />}
      state={value !== undefined ? { kind: "value", value } : { kind: "no_data", note: emptyMessage }}
    />
  );
}
