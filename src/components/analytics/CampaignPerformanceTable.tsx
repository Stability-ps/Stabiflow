import { BarChart3, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
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
    <Panel aria-labelledby="analytics-campaigns">
      <PanelHeader
        titleId="analytics-campaigns"
        title="Campaign performance"
        action={rows.length > 0 ? (
          <Button size="sm" variant="outline" onClick={() => downloadCsv(rows, canSeeRevenue, attributionModel, preset)}>
            <Download aria-hidden="true" /> Export CSV
          </Button>
        ) : null}
      />
      <div className="relative overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-2"><EmptyState icon={BarChart3} title="No campaigns yet" description="Launch a campaign to see performance here." /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-overline uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Campaign</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Status</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Spend</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Impr.</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Clicks</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">CTR</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">CPC</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Conv.</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Leads</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Qual.</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Opps</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Cust.</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Cost/Lead</th>
                {canSeeRevenue && <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Revenue</th>}
                {canSeeRevenue && <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">ROAS</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ctr = r.impressions > 0 ? `${((r.clicks / r.impressions) * 100).toFixed(2)}%` : "—";
                const cpc = costPerOutcome(r.spend_minor, r.clicks);
                const costPerLead = costPerOutcome(r.spend_minor, r.leads);
                const roas = computeRoas(r.spend_minor, r.currency, r.revenue);
                return (
                  <tr key={r.campaign_id} className="border-b border-border last:border-0">
                    <td className="min-w-[12rem] px-3 py-2.5 font-medium text-foreground">{r.name}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums"><CampaignStatusBadge status={r.status} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{formatMoney(r.spend_minor, r.currency)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.impressions.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.clicks.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{ctr}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{cpc === null ? "—" : formatMoney(cpc, r.currency)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.conversations}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.leads}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.qualified_leads}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.opportunities}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.customers}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{costPerLead === null ? "—" : formatMoney(costPerLead, r.currency)}</td>
                    {canSeeRevenue && <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{formatMoneyByCurrency(r.revenue, workspaceCurrency)}</td>}
                    {canSeeRevenue && <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{formatRoas(roas)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}
