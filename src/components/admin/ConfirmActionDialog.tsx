// Change safety for sensitive admin actions:
// current value -> proposed value -> reason -> explicit confirmation -> audit.
import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ConfirmActionDialog({ open, onOpenChange, title, description, current, proposed, confirmLabel, destructive, onConfirm }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: ReactNode;
  current?: ReactNode;
  proposed?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = reason.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) { setReason(""); setError(null); } } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {current !== undefined || proposed !== undefined ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
            {current !== undefined ? <><dt className="text-muted-foreground">Current</dt><dd className="font-medium">{current}</dd></> : null}
            {proposed !== undefined ? <><dt className="text-muted-foreground">New</dt><dd className="font-medium">{proposed}</dd></> : null}
          </dl>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="confirm-reason">Reason (recorded in the audit log)</Label>
          <Textarea id="confirm-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Why is this change being made?" />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(reason.trim());
                setReason("");
                onOpenChange(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : "The change could not be saved.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}{confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
