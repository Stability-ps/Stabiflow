// Existing, working operator tools re-hosted inside the admin shell. Their
// endpoints (operator-admin / operator-workspaces) now enforce per-action
// role permissions; the gate here only explains when a role lacks access.
import type { ReactNode } from "react";
import { Eye } from "lucide-react";
import { useAdmin } from "@/hooks/useAdmin";
import { AdminPageHeader, RequirePermission } from "@/components/admin/AdminPrimitives";
import type { AdminPermission } from "@/lib/adminPermissions";
import { OperatorBusinessStudio } from "@/pages/operator/OperatorBusinessStudio";
import { OperatorFlags } from "@/pages/operator/OperatorFlags";
import { OperatorLaunchReadiness } from "@/pages/operator/OperatorLaunchReadiness";
import { OperatorPagesLegal } from "@/pages/operator/OperatorPagesLegal";
import { OperatorPlans } from "@/pages/operator/OperatorPlans";
import { OperatorSettings } from "@/pages/operator/OperatorSettings";
import { OperatorSystem } from "@/pages/operator/OperatorSystem";
import { OperatorUsage } from "@/pages/operator/OperatorUsage";

function Page({ title, description, permission, manage, children }: {
  title: string; description: string; permission: AdminPermission; manage?: AdminPermission; children: ReactNode;
}) {
  const { can } = useAdmin();
  const readOnly = !!manage && !can(manage);
  return (
    <RequirePermission permission={permission}>
      <AdminPageHeader title={title} description={description} />
      {readOnly ? (
        <>
          <p className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"><Eye className="h-4 w-4" />Read-only. Your role can view this but not change it.</p>
          {/* Disables every control inside, so nothing offers an action the server would refuse. */}
          <fieldset disabled className="min-w-0">{children}</fieldset>
        </>
      ) : children}
    </RequirePermission>
  );
}

export function AdminPlansPage() {
  return <Page title="Plans & pricing" description="The single source for plans, prices and entitlements used by pricing, checkout, Paystack and limit enforcement. Price terms are immutable once created: add a new price instead." permission="plans.read" manage="plans.manage"><OperatorPlans /></Page>;
}
export function AdminFeaturesPage() {
  return <Page title="Feature flags" description="Module switches, audiences and per-business targeting. Changes need a reason and are audited." permission="features.read" manage="features.manage"><OperatorFlags /></Page>;
}
export function AdminUsagePage() {
  return <Page title="Usage & AI" description="AI tokens and estimated cost by feature, plan allowances closest to their limits, and automation outcomes over the last 30 days." permission="analytics.read"><OperatorUsage /></Page>;
}
export function AdminBusinessStudioPage() {
  return <Page title="Business Studio" description="Website scans, generated profiles and profile templates." permission="analytics.read" manage="content.manage"><OperatorBusinessStudio /></Page>;
}
export function AdminContentPage() {
  return <Page title="Pages & legal" description="Draft, preview and publish legal documents and public pages." permission="content.manage"><OperatorPagesLegal /></Page>;
}
export function AdminSettingsPage() {
  return <Page title="Settings & copy" description="Public copy and platform settings. Operational settings (billing timings) need the Admin or Owner role." permission="content.manage"><OperatorSettings /></Page>;
}
export function AdminHealthPage() {
  return <Page title="System health" description="Whether each integration credential is configured (values are never shown), recent failed jobs and payment webhooks. For per-business connection health, open the business." permission="system.read"><OperatorSystem /></Page>;
}
export function AdminLaunchPage() {
  return <Page title="Launch readiness" description="Automated checks that the commercial catalogue, module access, guardrails, legal versions and public pages are production-ready." permission="system.read"><OperatorLaunchReadiness /></Page>;
}
