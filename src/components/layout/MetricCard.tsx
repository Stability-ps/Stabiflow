import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// `value` is undefined/null when there's genuinely no real data source (or
// permission) behind this metric yet - renders emptyMessage in that case.
// A real, currently-zero value is passed as the STRING "0" (or "$0.00"),
// which renders as a real number - never conflated with "unavailable".
export function MetricCard({ icon: Icon, label, emptyMessage, value }: { icon: LucideIcon; label: string; emptyMessage: string; value?: string }) {
  return (
    <Card className="border-border/70 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/70"><Icon className="h-4 w-4 text-muted-foreground" /></span>
      </CardHeader>
      <CardContent className="pb-4">
        {value !== undefined ? <p className="text-2xl font-semibold">{value}</p> : <p className="text-sm text-muted-foreground">{emptyMessage}</p>}
      </CardContent>
    </Card>
  );
}
