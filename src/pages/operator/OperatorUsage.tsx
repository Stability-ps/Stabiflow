import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { operatorAdmin } from "@/lib/operatorAdmin";
import { ErrorState } from "@/components/admin/AdminPrimitives";

type Usage = {
  ai30d: { tokens: number; cost_usd: number; by_feature: Record<string, { tokens: number; cost_usd: number; calls: number }> };
  allowances: Array<{ workspace_id: string; workspace_name: string; key: string; used: number; limit: number | null; unlimited: boolean; pct: number | null }>;
  automation30d: { total: number; blocked_usage_limit: number; failed: number };
};

export function OperatorUsage() {
  const q = useQuery({ queryKey: ["operator-usage"], queryFn: () => operatorAdmin<Usage>("usage_overview") });
  if (q.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading usage...</p>;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data;
  const hot = data.allowances.filter((x) => x.pct !== null && x.pct >= 80).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardHeader className="pb-1"><CardTitle className="text-label font-normal text-muted-foreground">AI tokens · 30d</CardTitle></CardHeader><CardContent><p className="text-metric tabular-nums text-foreground">{data.ai30d.tokens.toLocaleString()}</p></CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-label font-normal text-muted-foreground">Estimated AI cost · 30d</CardTitle></CardHeader><CardContent><p className="text-metric tabular-nums text-foreground">${data.ai30d.cost_usd.toFixed(2)}</p></CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-label font-normal text-muted-foreground">Automation runs · 30d</CardTitle></CardHeader><CardContent><p className="text-metric tabular-nums text-foreground">{data.automation30d.total}</p><p className="text-xs text-muted-foreground">{data.automation30d.blocked_usage_limit} quota-blocked · {data.automation30d.failed} failed</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">AI cost by feature · 30d</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-3 font-normal">Feature</th><th className="pr-3 font-normal">Calls</th><th className="pr-3 font-normal">Tokens</th><th className="font-normal">Estimated cost</th></tr></thead>
            <tbody>{Object.entries(data.ai30d.by_feature).sort((a,b)=>b[1].cost_usd-a[1].cost_usd).map(([k,v])=><tr key={k} className="border-t"><td className="py-1 pr-3">{k.replace(/_/g," ")}</td><td className="pr-3">{v.calls}</td><td className="pr-3">{v.tokens.toLocaleString()}</td><td>${v.cost_usd.toFixed(4)}</td></tr>)}</tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Workspaces nearing monthly limits</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {hot.length === 0 && <p className="text-sm text-muted-foreground">No workspace is at or above 80% of a tracked monthly allowance.</p>}
          {hot.map((x)=><div key={x.workspace_id+x.key} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm"><div><p className="font-medium">{x.workspace_name}</p><p className="text-xs text-muted-foreground">{x.key.replace(/[._]/g," ")}</p></div><p className="font-medium">{x.used}/{x.limit} · {Math.round(x.pct ?? 0)}%</p></div>)}
        </CardContent>
      </Card>
    </div>
  );
}
