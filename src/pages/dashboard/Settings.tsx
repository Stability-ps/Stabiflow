import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceTab } from "@/pages/dashboard/settings/WorkspaceTab";
import { MembersTab } from "@/pages/dashboard/settings/MembersTab";
import { AccountTab } from "@/pages/dashboard/settings/AccountTab";
import { MobileSettings } from "@/pages/dashboard/settings/MobileSettings";

export default function Settings() {
  return (
    <>
      <MobileSettings />
      <div className="hidden space-y-6 md:block">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Workspace profile, members and roles, and your account.</p>
      </div>
      <Tabs defaultValue="workspace">
        <TabsList>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        <TabsContent value="workspace" className="mt-4"><WorkspaceTab /></TabsContent>
        <TabsContent value="members" className="mt-4"><MembersTab /></TabsContent>
        <TabsContent value="account" className="mt-4"><AccountTab /></TabsContent>
      </Tabs>
      </div>
    </>
  );
}
