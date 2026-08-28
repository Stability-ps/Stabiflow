import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BrandLogo } from "@/components/layout/BrandLogo";

/**
 * Shared shell for the public legal pages (/legal/privacy, /legal/terms).
 * Deliberately outside AppLayout - these must be readable without being
 * signed in or having a workspace, matching how a signup-flow link or an
 * external reviewer would reach them.
 */
export function LegalLayout({ title, effectiveDate, children }: { title: string; effectiveDate: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link to="/">
            <BrandLogo variant="full" className="h-7" />
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link to="/legal/privacy" className="hover:text-foreground">Privacy Policy</Link>
            <Link to="/legal/terms" className="hover:text-foreground">Terms of Service</Link>
            <Link to="/legal/data-deletion" className="hover:text-foreground">Data Deletion</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Effective date: {effectiveDate}</p>
        <div className="prose prose-sm mt-8 max-w-none space-y-6 text-sm leading-6 text-foreground [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:mt-8 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
          {children}
        </div>
      </main>
    </div>
  );
}
