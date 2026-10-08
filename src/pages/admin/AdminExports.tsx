import { AdminPageHeader, RequirePermission, Section } from "@/components/admin/AdminPrimitives";
import { DateRangeControl } from "@/components/admin/DateRangeControl";
import { useAdminRange } from "@/hooks/useAdminRange";
import { ExportButton } from "@/components/admin/ExportButton";
import { useAdmin } from "@/hooks/useAdmin";
import { EXPORT_DATASETS, type ExportDataset } from "@/lib/adminPermissions";

const DESCRIPTIONS: Record<ExportDataset, { text: string; ranged: boolean }> = {
  users: { text: "Every account: name, email, sign-up and last sign-in, businesses and roles, staff role.", ranged: false },
  businesses: { text: "Every business: owner, status, plans, paying, team size, country, lifetime revenue, last activity.", ranged: false },
  transactions: { text: "Paystack transactions created in the selected range, with original and paid amounts and currencies.", ranged: true },
  subscriptions: { text: "All subscriptions with plan, price, status, renewal and cancellation dates.", ranged: false },
  ai_usage: { text: "AI requests in the selected range, aggregated by business, feature and model, with tokens and estimated cost.", ranged: true },
  audit: { text: "The complete staff audit log.", ranged: false },
};

function ExportsView() {
  const { can } = useAdmin();
  const range = useAdminRange();
  const available = (Object.keys(EXPORT_DATASETS) as ExportDataset[]).filter((d) => can(EXPORT_DATASETS[d].permission));
  return (
    <>
      <AdminPageHeader
        title="Exports"
        description="CSV files generated on the server (up to 50,000 rows each). Every export is recorded in the audit log. Directory pages also export their current filters."
        actions={<DateRangeControl />}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {available.map((d) => (
          <Section key={d} title={EXPORT_DATASETS[d].label} description={DESCRIPTIONS[d].ranged ? `Range: ${range.label}` : "Complete dataset"}>
            <p className="mb-3 text-sm text-muted-foreground">{DESCRIPTIONS[d].text}</p>
            <ExportButton dataset={d} filters={DESCRIPTIONS[d].ranged ? { from: range.fromIso, to: range.toIso } : {}} label="Download CSV" />
          </Section>
        ))}
      </div>
    </>
  );
}

export default function AdminExports() {
  return <RequirePermission permission="exports.create"><ExportsView /></RequirePermission>;
}
