import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDay, MAX_RANGE_DAYS, parseDay, RANGE_PRESETS, resolveRange, type RangeKey } from "@/lib/adminDateRange";

export function DateRangeControl() {
  const [params, setParams] = useSearchParams();
  const current = resolveRange(params);
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(formatDay(current.from));
  const [to, setTo] = useState(formatDay(new Date(current.to.getTime() - 1)));
  const fromD = parseDay(from);
  const toD = parseDay(to);
  const invalid = !fromD || !toD || toD < fromD;

  function apply(key: RangeKey, extra?: { from: string; to: string }) {
    const next = new URLSearchParams(params);
    next.set("range", key);
    next.delete("from");
    next.delete("to");
    next.delete("page");
    if (extra) {
      next.set("from", extra.from);
      next.set("to", extra.to);
    }
    setParams(next, { replace: true });
  }

  return (
    <>
      <Select
        value={current.key}
        onValueChange={(v) => (v === "custom" ? setCustomOpen(true) : apply(v as RangeKey))}
      >
        <SelectTrigger className="h-9 w-auto min-w-[11rem] gap-2" aria-label="Date range">
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          <SelectValue>{current.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {RANGE_PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Custom range</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="range-from">From</Label><Input id="range-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="range-to">To (inclusive)</Label><Input id="range-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">{invalid ? "Choose a start date on or before the end date." : `Ranges longer than ${MAX_RANGE_DAYS} days are shortened to the most recent ${MAX_RANGE_DAYS}.`}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomOpen(false)}>Cancel</Button>
            <Button disabled={invalid} onClick={() => { apply("custom", { from, to }); setCustomOpen(false); }}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
