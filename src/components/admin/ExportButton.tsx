import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/hooks/useAdmin";
import { downloadAdminExport } from "@/lib/adminApi";
import { EXPORT_DATASETS, type ExportDataset } from "@/lib/adminPermissions";

/** Server-generated CSV honouring the current filters. Hidden when the role
 * cannot export this dataset (the server refuses regardless). */
export function ExportButton({ dataset, filters = {}, label = "Export CSV" }: { dataset: ExportDataset; filters?: Record<string, unknown>; label?: string }) {
  const { can } = useAdmin();
  const [busy, setBusy] = useState(false);
  if (!can("exports.create") || !can(EXPORT_DATASETS[dataset].permission)) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { filename } = await downloadAdminExport(dataset, filters);
          toast.success(`Downloaded ${filename}`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Export failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}
