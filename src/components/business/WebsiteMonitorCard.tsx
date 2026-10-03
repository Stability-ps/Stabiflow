import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchEntitlements } from "@/lib/billing";
import { fetchMonitor, saveMonitor, type WebsiteMonitor } from "@/lib/businessStudio";

function Editor({ workspaceId, existing, defaultUrl, canEdit, entitled }: { workspaceId: string; existing: WebsiteMonitor | null; defaultUrl: string; canEdit: boolean; entitled: boolean }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(existing?.url ?? defaultUrl);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [freq, setFreq] = useState(String(existing?.frequency_days ?? 7));
  const save = useMutation({
    mutationFn: () => saveMonitor(workspaceId, { url: /^https?:\/\//i.test(url) ? url : `https://${url}`, enabled, frequency_days: Number(freq) }, !!existing),
    onSuccess: () => {
      toast.success(enabled ? "We'll keep an eye on your website" : "Monitoring paused");
      qc.invalidateQueries({ queryKey: ["website-monitor", workspaceId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Website monitoring</CardTitle>
        <CardDescription>We recheck your website and show you anything that changed. Nothing is updated until you approve it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!entitled ? (
          <p className="text-sm">
            Included with the Business and Growth plans. <Link className="underline" to="/app/billing">See plans</Link>
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
              <div className="space-y-1">
                <Label htmlFor="mon-url">Website</Label>
                <Input id="mon-url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!canEdit} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mon-freq">Check every</Label>
                <Select value={freq} onValueChange={setFreq} disabled={!canEdit}>
                  <SelectTrigger id="mon-freq"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Week</SelectItem>
                    <SelectItem value="14">2 weeks</SelectItem>
                    <SelectItem value="30">Month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="mon-on" checked={enabled} onCheckedChange={(v) => setEnabled(!!v)} disabled={!canEdit} />
              <Label htmlFor="mon-on">Monitoring on</Label>
            </div>
            {existing?.last_checked_at && <p className="text-xs text-muted-foreground">Last checked {new Date(existing.last_checked_at).toLocaleDateString("en-ZA")}</p>}
            {canEdit && <Button size="sm" onClick={() => save.mutate()} disabled={!url.trim() || save.isPending}>Save</Button>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function WebsiteMonitorCard({ workspaceId, defaultUrl, canEdit }: { workspaceId: string; defaultUrl: string; canEdit: boolean }) {
  const mon = useQuery({ queryKey: ["website-monitor", workspaceId], queryFn: () => fetchMonitor(workspaceId) });
  const ents = useQuery({ queryKey: ["entitlements", workspaceId], queryFn: () => fetchEntitlements(workspaceId) });
  if (mon.isLoading || ents.isLoading) return null;
  const entitled = !!ents.data?.find((e) => e.entitlement_key === "website_monitoring")?.enabled;
  return <Editor key={mon.data?.updated_at ?? "new"} workspaceId={workspaceId} existing={mon.data ?? null} defaultUrl={defaultUrl} canEdit={canEdit} entitled={entitled} />;
}
