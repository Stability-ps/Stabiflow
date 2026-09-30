import { ShieldAlert } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { OperatorOverview } from "@/pages/operator/OperatorOverview";
import { OperatorWorkspaces } from "@/pages/operator/OperatorWorkspaces";
import { OperatorPlans } from "@/pages/operator/OperatorPlans";
import { OperatorFlags } from "@/pages/operator/OperatorFlags";
import { OperatorBilling } from "@/pages/operator/OperatorBilling";
import { OperatorSettings } from "@/pages/operator/OperatorSettings";
import { OperatorSystem } from "@/pages/operator/OperatorSystem";
import { OperatorBusinessStudio } from "@/pages/operator/OperatorBusinessStudio";
import { OperatorPagesLegal } from "@/pages/operator/OperatorPagesLegal";

const TABS = [
  { value: "overview", label: "Overview", el: <OperatorOverview /> },
  { value: "workspaces", label: "Businesses & users", el: <OperatorWorkspaces /> },
  { value: "plans", label: "Plans & pricing", el: <OperatorPlans /> },
  { value: "flags", label: "Feature flags", el: <OperatorFlags /> },
  { value: "billing", label: "Subscriptions & payments", el: <OperatorBilling /> },
  { value: "business-studio", label: "Business Studio", el: <OperatorBusinessStudio /> },
  { value: "pages", label: "Pages & legal", el: <OperatorPagesLegal /> },
  { value: "settings", label: "Settings & content", el: <OperatorSettings /> },
  { value: "system", label: "System & audit", el: <OperatorSystem /> },
] as const;

// Platform Admin. The client-side is_platform_operator check is UX only:
// every tab talks to operator-workspaces / operator-admin, which re-check
// profiles.is_platform_operator with the service-role client on every call.
export default function Operator() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? (params.get("tab") as string) : "overview";

  if (!profile?.is_platform_operator) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p>You don't have operator access.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Platform admin</h1>
        <p className="text-sm text-muted-foreground">Run StabiFlow without a developer. Every change here is audited; credentials are never shown.</p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList className="h-auto flex-wrap justify-start">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="pt-4">
            {t.el}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
