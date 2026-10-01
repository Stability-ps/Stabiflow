import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// `value` is undefined/null when there's genuinely no real data source (or
// permission) behind this metric yet - renders emptyMessage in that case.
// A real, currently-zero value is passed as the STRING "0" (or "$0.00"),
// which renders as a real number - never conflated with "unavailable".
export function MetricCard({ icon: Icon, label, emptyMessage, value }: { icon: LucideIcon; label: string; emptyMessage: string; value?: string }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2 max-sm:p-3 max-sm:pb-1.5">
        <CardTitle className="min-w-0 text-sm font-medium leading-tight text-muted-foreground max-sm:text-xs">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="max-sm:p-3 max-sm:pt-1">
        {value !== undefined ? <p className="text-2xl font-semibold max-sm:text-xl">{value}</p> : <p className="text-sm text-muted-foreground max-sm:text-xs">{emptyMessage}</p>}
      </CardContent>
    </Card>
  );
}
