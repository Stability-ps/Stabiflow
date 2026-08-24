import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// No real underlying data source exists yet (Content/Campaigns/WhatsApp/
// Leads land in later phases), so every metric renders its defined empty
// state rather than an invented number - never a placeholder "0" or "-"
// that could be mistaken for a real, currently-zero value.
export function MetricCard({ icon: Icon, label, emptyMessage }: { icon: LucideIcon; label: string; emptyMessage: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </CardContent>
    </Card>
  );
}
