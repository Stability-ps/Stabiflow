import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { availableCreateActions, CREATE_ACTIONS } from "@/lib/createActions";

/** The single global "+ Create" entry point - launches an existing creation
 * flow on its own page rather than building a second copy of any form.
 * Only shows actions the workspace has both the module flag and the
 * permission for (see availableCreateActions). */
export function CreateMenu() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { isEnabled, isLoading } = useFeatureFlags();
  const actions = availableCreateActions(CREATE_ACTIONS, { isEnabled, hasPermission });

  if (isLoading || actions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Create
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Create</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {actions.map((action) => (
          <DropdownMenuItem key={action.id} onClick={() => navigate(action.to)} className="gap-2">
            <action.icon className="h-4 w-4 text-muted-foreground" />
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
