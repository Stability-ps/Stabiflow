import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchMyLegalAcceptanceStatus, reacceptLegal } from "@/lib/legal";

/**
 * Shown when a new Privacy Policy / Terms version has been published since
 * this user last accepted. Accepting records a 'reconsent' acceptance of
 * the DB-current versions (the browser never supplies a version).
 */
export function LegalReconsentBanner() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["legal-acceptance-status"], queryFn: fetchMyLegalAcceptanceStatus, staleTime: 10 * 60_000, retry: false });
  const accept = useMutation({
    mutationFn: reacceptLegal,
    onSuccess: () => {
      toast.success("Thank you - your acceptance has been recorded");
      qc.invalidateQueries({ queryKey: ["legal-acceptance-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (status.data !== "outdated") return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 border-b bg-sky-50 px-4 py-2 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
      <span>
        We've updated our <Link className="underline" to="/legal/terms" target="_blank">Terms of Service</Link> and{" "}
        <Link className="underline" to="/legal/privacy" target="_blank">Privacy Policy</Link>.
      </span>
      <Button size="sm" variant="outline" className="h-7" onClick={() => accept.mutate()} disabled={accept.isPending}>
        I accept
      </Button>
    </div>
  );
}
