import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function DirectoryControls({ search, filter, filters, placeholder, onChange }: {
  search: string; filter: string; filters: { value: string; label: string }[]; placeholder: string;
  onChange: (patch: Record<string, string | number | null>) => void;
}) {
  const [text, setText] = useState(search);
  const [synced, setSynced] = useState(search);
  if (synced !== search) {
    // URL changed elsewhere (back button, filter link): adopt it.
    setSynced(search);
    setText(search);
  }
  useEffect(() => {
    if (text === search) return;
    const t = setTimeout(() => onChange({ q: text.trim() || null, page: 0 }), 300);
    return () => clearTimeout(t);
  }, [text, search, onChange]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} />
      </div>
      <Select value={filter} onValueChange={(v) => onChange({ filter: v, page: 0 })}>
        <SelectTrigger className="sm:w-56" aria-label="Filter"><SelectValue /></SelectTrigger>
        <SelectContent>{filters.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
