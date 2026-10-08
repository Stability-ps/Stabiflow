import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceTab } from "@/pages/dashboard/settings/WorkspaceTab";
import { MembersTab } from "@/pages/dashboard/settings/MembersTab";
import { AccountTab } from "@/pages/dashboard/settings/AccountTab";
import { GuideHelpLink } from "@/components/guide/GuideHelpLink";

export default function Settings() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header className="min-w-0">
        <h1 className="text-title-page text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Workspace profile, members and roles, and your account.</p>
        <GuideHelpLink chapter="settings" label="Help with settings, roles and the StabiFlow Guide" className="mt-1" />
      </header>
      <Tabs defaultValue="workspace">
        <TabsList className="max-w-full justify-start overflow-x-auto">
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
