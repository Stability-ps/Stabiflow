import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { LegalLayout } from "@/pages/legal/LegalLayout";
import { LegalMarkdown } from "@/components/legal/LegalMarkdown";
import { fetchLegalHistory, fetchPublishedLegal, LEGAL_DOCUMENTS, type LegalDocumentType } from "@/lib/legal";

const date = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" }) : "-");

/**
 * Renders the admin-published version of a legal document. Until one has
 * been published, `fallback` (the existing in-code page) is shown, so
 * nothing changes for visitors until the owner deliberately publishes.
 */
export function LegalDocumentPage({ type, fallback }: { type: LegalDocumentType; fallback?: ReactNode }) {
  const meta = LEGAL_DOCUMENTS.find((d) => d.type === type)!;
  const doc = useQuery({ queryKey: ["legal-doc", type], queryFn: () => fetchPublishedLegal(type), staleTime: 5 * 60_000, retry: false });
  const history = useQuery({ queryKey: ["legal-history", type], queryFn: () => fetchLegalHistory(type), enabled: !!doc.data, staleTime: 5 * 60_000 });

  if (doc.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!doc.data) {
    if (fallback) return <>{fallback}</>;
    return (
      <LegalLayout title={meta.title} effectiveDate="-">
        <p>This document has not been published yet. <Link to="/contact" className="underline">Contact us</Link> if you have a question.</p>
      </LegalLayout>
    );
  }
  const d = doc.data;
  return (
    <LegalLayout title={d.title} effectiveDate={`${date(d.effective_at)} (version ${d.version})`}>
      <LegalMarkdown source={d.body} />
      {(history.data ?? []).length > 1 && (
        <section>
          <h2>Version history</h2>
          <ul>
            {history.data!.map((h) => (
              <li key={h.version}>
                Version {h.version} - effective {date(h.effective_at)}
                {h.status === "published" ? " (current)" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </LegalLayout>
  );
}

/** /legal index of every published policy (plus the in-code Privacy/Terms/Data Deletion pages). */
export function LegalIndexPage() {
  return (
    <LegalLayout title="Policies" effectiveDate="see each document">
      <ul>
        {LEGAL_DOCUMENTS.map((d) => (
          <li key={d.type}>
            <Link className="underline" to={`/legal/${d.slug}`}>{d.title}</Link>
          </li>
        ))}
      </ul>
    </LegalLayout>
  );
}
