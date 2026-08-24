import { Inbox as InboxIcon } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";

export default function Inbox() {
  return (
    <PlaceholderPage
      icon={InboxIcon}
      title="Inbox"
      description="WhatsApp conversations, AI-assisted replies, and human takeover."
      emptyTitle="No conversations yet"
      emptyDescription="Connect a WhatsApp Business number under Integrations to start receiving conversations here."
    />
  );
}
