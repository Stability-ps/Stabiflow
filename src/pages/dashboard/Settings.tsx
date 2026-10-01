import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CreditCard, LayoutDashboard, Plug } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkspaceTab } from "@/pages/dashboard/settings/WorkspaceTab";
import { MembersTab } from "@/pages/dashboard/settings/MembersTab";
import { AccountTab } from "@/pages/dashboard/settings/AccountTab";

function SettingsRow({ icon: Icon, label, description, onClick, comingSoon }: {
  icon: typeof Plug;
  label: string;
  description: string;
  onClick?: () => void;
  comingSoon?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left text-sm transition-colors enabled:hover:bg-accent/60 disabled:cursor-default"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      {comingSoon ? <Badge variant="outline" className="shrink-0 text-[10px]">Coming soon</Badge> : onClick && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}

// Settings is a plain-language index: Your Business / Connections /
// StabiFlow / Account. It doesn't rebuild anything - Workspace/Members/
// Account below are the exact same tab content this page has always had,
// Connections and Billing link to the existing standalone Integrations and
// Billing pages (they no longer need permanent top-level sidebar spots),
// and "Dashboard preferences" opens the real customizer on Home. Anything
// listed as "Coming soon" (Notifications, AI & automation, Usage & limits)
// has no real settings UI to link to yet - never a fake toggle screen.
export default function Settings() {
  const navigate = useNavigate();
  const [businessTab, setBusinessTab] = useState<"workspace" | "members">("workspace");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Your business, connections, and account.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Business</CardTitle>
          <CardDescription>Business details, workspace, and who's on your team.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={businessTab} onValueChange={(v) => setBusinessTab(v as "workspace" | "members")}>
            <TabsList>
              <TabsTrigger value="workspace">Business &amp; workspace</TabsTrigger>
              <TabsTrigger value="members">Team &amp; permissions</TabsTrigger>
            </TabsList>
            <TabsContent value="workspace" className="mt-4"><WorkspaceTab /></TabsContent>
            <TabsContent value="members" className="mt-4"><MembersTab /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connections</CardTitle>
          <CardDescription>WhatsApp, Meta, and other integrations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingsRow icon={Plug} label="WhatsApp" description="Connect and manage your WhatsApp Business number." onClick={() => navigate("/app/integrations")} />
          <SettingsRow icon={Plug} label="Meta" description="Connect your Meta ad account and Facebook Page." onClick={() => navigate("/app/integrations")} />
          <SettingsRow icon={Plug} label="All integrations" description="Manage every connected account in one place." onClick={() => navigate("/app/integrations")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">StabiFlow</CardTitle>
          <CardDescription>How StabiFlow works for you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingsRow
            icon={LayoutDashboard}
            label="Dashboard preferences"
            description="Choose and arrange the widgets on your Home dashboard."
            onClick={() => navigate("/app", { state: { openDashboardCustomizer: true } })}
          />
          <SettingsRow icon={Plug} label="Notifications" description="Choose what StabiFlow notifies you about." comingSoon />
          <SettingsRow icon={Plug} label="AI &amp; automation" description="Preferences for Flow AI and automation defaults." comingSoon />
          <SettingsRow icon={Plug} label="Usage &amp; limits" description="Track your plan's usage against its limits." comingSoon />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>Your profile, security, and billing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AccountTab />
          <div className="border-t pt-3">
            <SettingsRow icon={CreditCard} label="Billing & plan" description="StabiFlow subscription, invoices, and plan." onClick={() => navigate("/app/billing")} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
