import { useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { useInboxConversations } from "@/hooks/useInboxConversations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyWidgetState } from "@/components/dashboard/EmptyWidgetState";

export function RecentConversationsWidget() {
  const navigate = useNavigate();
  const { workspaceId, timezone, whatsappConnected } = useDashboardContext();
  const query = useInboxConversations(whatsappConnected ? workspaceId : null);
  const conversations = (query.data ?? []).slice(0, 5);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3"><CardTitle className="text-base">Recent conversations</CardTitle></CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        ) : conversations.length > 0 ? (
          <ul className="divide-y">
            {conversations.map((conversation) => (
              <li key={conversation.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 truncate font-medium">{conversation.display_name || conversation.phone_number}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{new Date(conversation.updated_at).toLocaleDateString(undefined, { timeZone: timezone })}</span>
              </li>
            ))}
          </ul>
        ) : !whatsappConnected ? (
          <EmptyWidgetState
            icon={MessageSquare}
            title="No conversations yet"
            description="Connect WhatsApp to start receiving conversations here."
            action={<Button size="sm" onClick={() => navigate("/app/integrations")}>Connect WhatsApp</Button>}
          />
        ) : (
          <EmptyWidgetState icon={MessageSquare} title="Waiting for your first conversation" description="New WhatsApp messages will appear here automatically." />
        )}
      </CardContent>
    </Card>
  );
}
