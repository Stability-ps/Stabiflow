import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ATTRIBUTION_MODEL_DESCRIPTION, ATTRIBUTION_MODEL_LABELS, ATTRIBUTION_MODELS, type AttributionModel } from "@/lib/analytics";
import { DATE_RANGE_PRESET_LABELS, type DateRangePreset } from "@/lib/analyticsDate";

const PRESETS: DateRangePreset[] = ["last_7_days", "last_30_days", "last_90_days", "this_month", "last_month", "custom"];

export function AnalyticsControls({
  preset, onPresetChange, customFrom, customTo, onCustomFromChange, onCustomToChange,
  attributionModel, onAttributionModelChange,
}: {
  preset: DateRangePreset;
  onPresetChange: (preset: DateRangePreset) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  attributionModel: AttributionModel;
  onAttributionModelChange: (model: AttributionModel) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={preset} onValueChange={(v) => onPresetChange(v as DateRangePreset)}>
        <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => <SelectItem key={p} value={p}>{DATE_RANGE_PRESET_LABELS[p]}</SelectItem>)}
        </SelectContent>
      </Select>

      {preset === "custom" && (
        <div className="flex items-center gap-2">
          <Input type="date" value={customFrom} onChange={(e) => onCustomFromChange(e.target.value)} className="h-9 w-36" />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="date" value={customTo} onChange={(e) => onCustomToChange(e.target.value)} className="h-9 w-36" />
        </div>
      )}

      <Select value={attributionModel} onValueChange={(v) => onAttributionModelChange(v as AttributionModel)}>
        <SelectTrigger className="h-9 w-48" title={ATTRIBUTION_MODEL_DESCRIPTION}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ATTRIBUTION_MODELS.map((m) => <SelectItem key={m} value={m}>{ATTRIBUTION_MODEL_LABELS[m]}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
