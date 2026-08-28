import { BarChart3, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignStatusBadge } from "@/components/campaigns/CampaignStatusBadge";
import { EmptyState } from "@/components/EmptyState";
import type { CampaignPerformanceRow } from "@/hooks/useAnalytics";
import { computeRoas, costPerOutcome, formatMoneyByCurrency, formatRoas } from "@/lib/analytics";
import { formatMoney } from "@/lib/adMoney";
import type { AttributionModel } from "@/lib/analytics";
import type { DateRangePreset } from "@/lib/analyticsDate";

function toCsvCell(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadCsv(rows: CampaignPerformanceRow[], canSeeRevenue: boolean, attributionModel: AttributionModel, preset: DateRangePreset) {
  const headers = ["Campaign", "Status", "Currency", "Spend", "Impressions", "Reach", "Clicks", "CTR %", "CPC", "Conversations", "Leads", "Qualified Leads", "Opportunities", "Customers"];
  if (canSeeRevenue) headers.push("Revenue", "ROAS");
  const lines = [headers.map(toCsvCell).join(",")];
  for (const r of rows) {
    const ctr = r.impressions > 0 ? ((r.clicks / r.impressions) * 100).toFixed(2) : "";
    const cpc = r.clicks > 0 ? (r.spend_minor / r.clicks / 100).toFixed(2) : "";
    const line = [
      r.name, r.status, r.currency, (r.spend_minor / 100).toFixed(2), r.impressions, r.reach, r.clicks, ctr, cpc,
      r.conversations, r.leads, r.qualified_leads, r.opportunities, r.customers,
    ];
    if (canSeeRevenue) {
      const roas = computeRoas(r.spend_minor, r.currency, r.revenue);
      const revenueTotal = r.revenue.length === 1 ? (r.revenue[0].amount_minor / 100).toFixed(2) : "";
      line.push(revenueTotal, roas.status === "ok" ? roas.value.toFixed(2) : "");
    }
    lines.push(line.map(toCsvCell).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `campaign-performance-${attributionModel}-${preset}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function CampaignPerformanceTable({ rows, canSeeRevenue, attributionModel, preset, workspaceCurrency }: {
  rows: CampaignPerformanceRow[];
  canSeeRevenue: boolean;
  attributionModel: AttributionModel;
  preset: DateRangePreset;
  workspaceCurrency: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Campaign performance</CardTitle>
        {rows.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => downloadCsv(rows, canSeeRevenue, attributionModel, preset)}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
          </Button>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={BarChart3} title="No campaigns yet" description="Launch a campaign to see performance here." /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Campaign</th><th className="p-3">Status</th><th className="p-3">Spend</th>
                <th className="p-3">Impr.</th><th className="p-3">Clicks</th><th className="p-3">CTR</th><th className="p-3">CPC</th>
                <th className="p-3">Conv.</th><th className="p-3">Leads</th><th className="p-3">Qual.</th><th className="p-3">Opps</th><th className="p-3">Cust.</th>
                <th className="p-3">Cost/Lead</th>
                {canSeeRevenue && <th className="p-3">Revenue</th>}
                {canSeeRevenue && <th className="p-3">ROAS</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ctr = r.impressions > 0 ? `${((r.clicks / r.impressions) * 100).toFixed(2)}%` : "—";
                const cpc = costPerOutcome(r.spend_minor, r.clicks);
                const costPerLead = costPerOutcome(r.spend_minor, r.leads);
                const roas = computeRoas(r.spend_minor, r.currency, r.revenue);
                return (
                  <tr key={r.campaign_id} className="border-b last:border-0">
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3"><CampaignStatusBadge status={r.status} /></td>
                    <td className="p-3">{formatMoney(r.spend_minor, r.currency)}</td>
                    <td className="p-3">{r.impressions.toLocaleString()}</td>
                    <td className="p-3">{r.clicks.toLocaleString()}</td>
                    <td className="p-3">{ctr}</td>
                    <td className="p-3">{cpc === null ? "—" : formatMoney(cpc, r.currency)}</td>
                    <td className="p-3">{r.conversations}</td>
                    <td className="p-3">{r.leads}</td>
                    <td className="p-3">{r.qualified_leads}</td>
                    <td className="p-3">{r.opportunities}</td>
                    <td className="p-3">{r.customers}</td>
                    <td className="p-3">{costPerLead === null ? "—" : formatMoney(costPerLead, r.currency)}</td>
                    {canSeeRevenue && <td className="p-3">{formatMoneyByCurrency(r.revenue, workspaceCurrency)}</td>}
                    {canSeeRevenue && <td className="p-3">{formatRoas(roas)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
