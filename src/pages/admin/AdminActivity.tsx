import { useQuery } from "@tanstack/react-query";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { AdminPageHeader, ErrorState, LoadingRows, Section } from "@/components/admin/AdminPrimitives";
import { adminConsole, type ActivityRow } from "@/lib/adminApi";

export default function AdminActivity() {
  const q = useQuery({
    queryKey: ["admin-activity", 100],
    queryFn: () => adminConsole<{ rows: ActivityRow[] }>("activity", { limit: 100 }).then((r) => r.rows),
    refetchInterval: 30_000,
  });
  return (
    <>
      <AdminPageHeader title="Live activity" description="Sign-ups, new businesses, payments, subscription changes, failed automations, new integrations and leads. Metadata only: message and lead content is never shown here. Refreshes every 30 seconds." />
      <Section title="Most recent 100 events">
        {q.isLoading ? <LoadingRows rows={10} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <ActivityFeed rows={q.data ?? []} />}
      </Section>
    </>
  );
}
