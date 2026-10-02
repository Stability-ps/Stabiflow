import { AlertTriangle, CheckCircle2, Clock3, Target, Trophy, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CrmPerformance } from "@/hooks/useAnalytics";

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail?: string; icon: typeof Target }) {
  return <Card><CardContent className="flex items-start justify-between gap-3 p-4"><div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div><Icon className="h-5 w-5 text-muted-foreground" /></CardContent></Card>;
}

export function CrmPerformanceSection({ data }: { data: CrmPerformance }) {
  return (
    <section className="space-y-3">
      <div><h2 className="text-lg font-semibold tracking-tight">CRM performance</h2><p className="text-sm text-muted-foreground">Qualification, follow-ups and outcomes for leads created in this period.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Qualification rate" value={`${data.qualification_rate.toFixed(1)}%`} detail={`${data.qualified} qualified`} icon={Target} />
        <Metric label="Lead conversion" value={`${data.conversion_rate.toFixed(1)}%`} detail={`${data.converted} converted`} icon={Trophy} />
        <Metric label="Follow-ups due" value={data.follow_ups_due} detail={`${data.follow_ups_completed} completed`} icon={Clock3} />
        <Metric label="Overdue follow-ups" value={data.follow_ups_overdue} detail={data.follow_ups_overdue ? "Needs attention" : "Nothing overdue"} icon={data.follow_ups_overdue ? AlertTriangle : CheckCircle2} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Lead outcomes</CardTitle></CardHeader><CardContent className="grid grid-cols-3 gap-3 text-center"><div><p className="text-xl font-semibold">{data.active}</p><p className="text-xs text-muted-foreground">Active</p></div><div><p className="text-xl font-semibold">{data.converted}</p><p className="text-xs text-muted-foreground">Converted</p></div><div><p className="text-xl font-semibold">{data.lost}</p><p className="text-xs text-muted-foreground">Lost</p></div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Why leads were lost</CardTitle></CardHeader><CardContent>{data.lost_reasons.length === 0 ? <p className="text-sm text-muted-foreground">No lost leads in this period.</p> : <div className="space-y-2">{data.lost_reasons.slice(0, 6).map((item) => <div key={item.reason} className="flex items-center justify-between gap-3 text-sm"><span className="flex min-w-0 items-center gap-2"><XCircle className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{item.reason}</span></span><span className="font-medium tabular-nums">{item.count}</span></div>)}</div>}</CardContent></Card>
      </div>
    </section>
  );
}
