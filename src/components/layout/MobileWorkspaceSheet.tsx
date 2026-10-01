import { Check, Plus } from "lucide-react";
import { useOverlayHistory } from "@/hooks/useOverlayHistory";
import { BottomSheet, BottomSheetContent } from "@/components/ui/bottom-sheet";
import { useWorkspaceSwitch } from "@/hooks/useWorkspaceSwitch";

const ROW = "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Mobile workspace picker - same switching logic as the desktop dropdown. */
export function MobileWorkspaceSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { memberships, currentWorkspaceId, switchTo } = useWorkspaceSwitch();
  const { navigateFrom } = useOverlayHistory(open, () => onOpenChange(false));

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent title="Workspaces" description="Switch between the businesses you work in.">
        <ul className="space-y-0.5" aria-label="Workspaces">
          {memberships.map((m) => {
            const current = m.workspaceId === currentWorkspaceId;
            return (
              <li key={m.workspaceId}>
                <button
                  type="button"
                  className={ROW}
                  aria-current={current ? "true" : undefined}
                  onClick={() => { onOpenChange(false); void switchTo(m.workspaceId); }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.workspace.name}</span>
                    <span className="block text-xs capitalize text-muted-foreground">{m.role}</span>
                  </span>
                  {current ? <Check className="h-4 w-4 shrink-0" aria-label="Current workspace" /> : null}
                </button>
              </li>
            );
          })}
          <li className="border-t pt-1">
            <button type="button" className={ROW} onClick={() => navigateFrom("/create-workspace")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm">Create workspace</span>
            </button>
          </li>
        </ul>
      </BottomSheetContent>
    </BottomSheet>
  );
}
