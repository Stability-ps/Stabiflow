import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminPageHeader, ErrorState, LoadingRows, Section } from "@/components/admin/AdminPrimitives";
import { AttentionList } from "@/components/admin/AttentionList";
import { adminConsole, type AdminAlert } from "@/lib/adminApi";
import { humanize, timeAgo } from "@/lib/adminFormat";
import { cn } from "@/lib/utils";

export default function AdminAttention() {
  const [area, setArea] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin-attention"],
    queryFn: () => adminConsole<{ alerts: AdminAlert[]; generatedAt: string }>("attention"),
    refetchInterval: 120_000,
  });
  const alerts = q.data?.alerts ?? [];
  const areas = [...new Set(alerts.map((a) => a.area))];
  const shown = area ? alerts.filter((a) => a.area === area) : alerts;

  return (
    <>
      <AdminPageHeader
        title="Needs attention"
        description="Failed payments and webhooks, at-risk subscriptions, failing automations and publishing, broken integrations, undeliverable messages, AI failure spikes and customers near their limits."
        actions={<Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}><RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", q.isFetching && "animate-spin")} />Refresh</Button>}
      />
      {areas.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by area">
          <Button size="sm" variant={area === null ? "default" : "outline"} onClick={() => setArea(null)}>All · {alerts.length}</Button>
          {areas.map((a) => (
            <Button key={a} size="sm" variant={area === a ? "default" : "outline"} onClick={() => setArea(a)}>
              {humanize(a)} · {alerts.filter((x) => x.area === a).length}
            </Button>
          ))}
        </div>
      ) : null}
      <Section title={`${shown.length} open ${shown.length === 1 ? "item" : "items"}`} description={q.data ? `Checked ${timeAgo(q.data.generatedAt)}. Refreshes every 2 minutes.` : undefined}>
        {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <AttentionList alerts={shown} />}
      </Section>
    </>
  );
}
