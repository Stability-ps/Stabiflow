import { ImageIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { MediaPreview } from "@/components/content/MediaPreview";
import type { CreativePerformanceRow } from "@/hooks/useAnalytics";
import { formatMoneyByCurrency } from "@/lib/analytics";

export function CreativePerformanceTable({ rows, canSeeRevenue }: { rows: CreativePerformanceRow[]; canSeeRevenue: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Creative performance</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={ImageIcon} title="No published creatives yet" description="Creative-level conversions appear once a campaign with a creative has been published." /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Creative</th><th className="p-3">Campaign</th><th className="p-3">Spend</th>
                <th className="p-3">Conversations</th><th className="p-3">Leads</th><th className="p-3">Customers</th>
                {canSeeRevenue && <th className="p-3">Revenue</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.creative_id} className="border-b last:border-0">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {r.media_storage_path ? (
                        <MediaPreview storagePath={r.media_storage_path} alt={r.primary_text || "Creative"} className="h-10 w-10 rounded object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded bg-muted"><ImageIcon className="h-4 w-4 text-muted-foreground" /></div>
                      )}
                      <span className="max-w-[220px] truncate">{r.primary_text || "—"}</span>
                    </div>
                  </td>
                  <td className="p-3">{r.campaign_name}</td>
                  <td className="p-3 text-muted-foreground">Unavailable at creative level</td>
                  <td className="p-3">{r.conversations}</td>
                  <td className="p-3">{r.leads}</td>
                  <td className="p-3">{r.customers}</td>
                  {canSeeRevenue && <td className="p-3">{formatMoneyByCurrency(r.revenue, "—")}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
