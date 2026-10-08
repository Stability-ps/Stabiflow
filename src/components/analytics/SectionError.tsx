import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";

/** A section whose own query failed: says so instead of rendering an empty "no data yet" state. */
export function SectionError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Panel>
      <PanelHeader title={title} />
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm text-destructive-strong">
        <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Couldn't load this section. Other figures on this page are unaffected.</span>
        <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
      </div>
    </Panel>
  );
}
