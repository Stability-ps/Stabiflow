import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { operatorAdmin, type AdminSetting } from "@/lib/operatorAdmin";

function SettingEditor({ setting, onChanged }: { setting: AdminSetting; onChanged: () => void }) {
  const [draft, setDraft] = useState(JSON.stringify(setting.value, null, 2));
  const save = useMutation({
    mutationFn: () => {
      let value: unknown;
      try {
        value = JSON.parse(draft);
      } catch {
        throw new Error("Value must be valid JSON (text in \"quotes\", numbers as-is)");
      }
      return operatorAdmin("update_setting", { setting: { key: setting.key, value } });
    },
    onSuccess: () => {
      toast.success("Setting saved");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const dirty = draft !== JSON.stringify(setting.value, null, 2);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono">{setting.key}</span>
          <Badge variant={setting.is_public ? "secondary" : "outline"}>{setting.is_public ? "public" : "internal"}</Badge>
        </CardTitle>
        {setting.description && <p className="text-xs text-muted-foreground">{setting.description}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea className="font-mono text-xs" rows={Math.min(12, draft.split("\n").length + 1)} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Value for ${setting.key}`} />
        <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Platform settings and public copy (support contact, notices, home and
 * pricing copy, FAQs, billing grace period). Never credentials - those are
 * edge-function secrets, shown only as configured/missing under System.
 */
export function OperatorSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["op-settings"], queryFn: () => operatorAdmin<{ settings: AdminSetting[] }>("list_settings") });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (q.error || !q.data) return <p className="text-sm text-destructive">Could not load settings.</p>;
  const groups = q.data.settings.reduce<Record<string, AdminSetting[]>>((acc, s) => {
    const g = s.key.split(".")[0];
    (acc[g] ||= []).push(s);
    return acc;
  }, {});
  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([group, settings]) => (
        <section key={group} className="space-y-2">
          <h2 className="text-sm font-semibold capitalize">{group}</h2>
          {settings.map((s) => (
            <SettingEditor key={`${s.key}:${s.updated_at}`} setting={s} onChanged={() => qc.invalidateQueries({ queryKey: ["op-settings"] })} />
          ))}
        </section>
      ))}
    </div>
  );
}
