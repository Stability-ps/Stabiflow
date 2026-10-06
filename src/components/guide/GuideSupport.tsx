import { Link } from "react-router-dom";
import { LifeBuoy, Mail, Search, Settings, Wrench } from "lucide-react";

const SUPPORT_EMAIL = "contact@stabiflow.com";

/** "Still need help?" - uses StabiFlow's existing public support channel. */
export function GuideSupport() {
  const items = [
    { icon: Search, label: "Search help", detail: "Press / to search the whole guide.", to: "/app/guide" },
    { icon: Wrench, label: "Troubleshooting", detail: "Fix common problems by symptom.", to: "/app/guide/troubleshooting" },
    { icon: Settings, label: "Account & settings", detail: "Workspace, members and your account.", to: "/app/settings" },
  ];
  return (
    <section aria-labelledby="guide-support" className="guide-no-print rounded-2xl border bg-gradient-to-br from-sky-50/70 via-card to-card p-5 dark:from-sky-950/20">
      <div className="flex items-center gap-2">
        <LifeBuoy className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 id="guide-support" className="text-lg font-semibold">Still need help?</h2>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((i) => (
          <Link key={i.label} to={i.to} className="rounded-xl border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
            <i.icon className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="mt-2 block text-sm font-medium">{i.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{i.detail}</span>
          </Link>
        ))}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("StabiFlow support request")}`} className="rounded-xl border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
          <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="mt-2 block text-sm font-medium">Contact support</span>
          <span className="mt-0.5 block break-all text-xs text-muted-foreground">{SUPPORT_EMAIL} - report a problem or ask a question.</span>
        </a>
      </div>
    </section>
  );
}
