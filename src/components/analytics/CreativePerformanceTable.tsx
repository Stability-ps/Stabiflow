import { ImageIcon } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/EmptyState";
import { MediaPreview } from "@/components/content/MediaPreview";
import type { CreativePerformanceRow } from "@/hooks/useAnalytics";
import { formatMoneyByCurrency } from "@/lib/analytics";

export function CreativePerformanceTable({ rows, canSeeRevenue, workspaceCurrency }: { rows: CreativePerformanceRow[]; canSeeRevenue: boolean; workspaceCurrency: string }) {
  return (
    <Panel aria-labelledby="analytics-creatives">
      <PanelHeader titleId="analytics-creatives" title="Creative performance" />
      <div className="relative overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-2"><EmptyState icon={ImageIcon} title="No published creatives yet" description="Creative-level conversions appear once a campaign with a creative has been published." /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-overline uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Creative</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Campaign</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Spend</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Conversations</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Leads</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Customers</th>
                {canSeeRevenue && <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Revenue</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.creative_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2.5">
                    <div className="flex min-w-[14rem] items-center gap-2">
                      {r.media_storage_path ? (
                        <MediaPreview storagePath={r.media_storage_path} alt={r.primary_text || "Creative"} className="h-10 w-10 rounded object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded bg-muted"><ImageIcon className="h-4 w-4 text-muted-foreground" /></div>
                      )}
                      <span className="max-w-[220px] truncate">{r.primary_text || "—"}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.campaign_name}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">Unavailable at creative level</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.conversations}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.leads}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.customers}</td>
                  {canSeeRevenue && <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{formatMoneyByCurrency(r.revenue, workspaceCurrency)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}
