import { ArrowRight, Mail, MapPin, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { Button } from "@/components/ui/button";

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-3">
            <BrandLogo variant="full" className="h-8 w-auto" />
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/legal/privacy">Privacy Policy</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/login">Sign In</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.95fr] lg:items-start">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              StabiFlow is provided by Acapolite Consulting (Pty) Ltd.
            </div>

            <div className="space-y-4">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Contact StabiFlow</h1>
              <p className="max-w-xl text-base leading-7 text-muted-foreground">
                For onboarding, Meta access questions, privacy requests, legal questions, or technical support, use the contact details below.
              </p>
            </div>

            <div className="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary/5 p-2.5 text-primary">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <a href="mailto:contact@stabiflow.com" className="mt-1 block text-lg font-medium text-foreground hover:underline">
                    contact@stabiflow.com
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary/5 p-2.5 text-primary">
                  <MapPin className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Provider</p>
                  <p className="mt-1 text-lg font-medium text-foreground">Acapolite Consulting (Pty) Ltd</p>
                  <p className="text-sm text-muted-foreground">South Africa</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Need help?</h2>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-muted-foreground">
              <li>• Access requests for Meta / WhatsApp business assets</li>
              <li>• Privacy, deletion or data requests</li>
              <li>• Workspace setup and onboarding</li>
              <li>• Technical support and platform questions</li>
            </ul>
            <Button asChild className="mt-6 w-full">
              <a href="mailto:contact@stabiflow.com">
                Email support
                <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
