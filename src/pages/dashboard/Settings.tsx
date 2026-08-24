import { Settings as SettingsIcon } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";

export default function Settings() {
  return (
    <PlaceholderPage
      icon={SettingsIcon}
      title="Settings"
      description="Workspace profile, members and roles, billing, and your account preferences."
      emptyTitle="Settings are coming here"
      emptyDescription="Workspace and account settings will be organized here as each area is built out."
    />
  );
}
