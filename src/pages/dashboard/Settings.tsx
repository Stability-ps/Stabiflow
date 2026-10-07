import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceTab } from "@/pages/dashboard/settings/WorkspaceTab";
import { MembersTab } from "@/pages/dashboard/settings/MembersTab";
import { AccountTab } from "@/pages/dashboard/settings/AccountTab";
import { GuideHelpLink } from "@/components/guide/GuideHelpLink";

export default function Settings() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="operational-header">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace control</p>
        <h1 className="operational-title">Settings</h1>
        <p className="text-sm text-muted-foreground">Workspace profile, members and roles, and your account.</p>
        <GuideHelpLink chapter="settings" label="Help with settings, roles and the StabiFlow Guide" className="mt-1" />
      </div>
      <Tabs defaultValue="workspace">
        <TabsList className="rounded-xl border border-border/70 bg-card/80 p-1 shadow-sm">
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        <TabsContent value="workspace" className="mt-4"><WorkspaceTab /></TabsContent>
        <TabsContent value="members" className="mt-4"><MembersTab /></TabsContent>
        <TabsContent value="account" className="mt-4"><AccountTab /></TabsContent>
      </Tabs>
    </div>
  );
}
