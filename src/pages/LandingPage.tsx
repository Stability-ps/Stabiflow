import { ArrowRight, BarChart3, Building2, CheckCircle2, Megaphone, MessageSquareText, Palette, Plug, ShieldCheck, Sparkles, Target, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/layout/BrandLogo";

const featureCards = [
  {
    icon: Megaphone,
    title: "Meta Advertising",
    description: "Create, manage and monitor Meta advertising campaigns.",
  },
  {
    icon: Building2,
    title: "Facebook & Instagram",
    description: "Connect authorized business Pages and Instagram accounts.",
  },
  {
    icon: MessageSquareText,
    title: "WhatsApp Business",
    description: "Receive and manage customer conversations from connected WhatsApp Business accounts.",
  },
  {
    icon: Users,
    title: "Unified Inbox",
    description: "Manage customer conversations and staff responses from one workspace.",
  },
  {
    icon: Target,
    title: "Leads & CRM",
    description: "Turn conversations into leads, opportunities and customers.",
  },
  {
    icon: Palette,
    title: "Content Management",
    description: "Organize and manage business content and campaign assets.",
  },
  {
    icon: BarChart3,
    title: "Analytics",
    description: "View advertising, lead and customer performance data.",
  },
  {
    icon: Sparkles,
    title: "Automation & AI",
    description: "Help businesses automate repetitive workflows and assist staff with customer interactions.",
  },
];

const steps = [
  {
    title: "Create your StabiFlow workspace.",
    description: "Set up your business workspace in minutes and centralize your teams, media, leads and conversations.",
  },
  {
    title: "Connect your business accounts.",
    description: "Users securely authorize StabiFlow to access only the Meta and WhatsApp business assets they choose.",
  },
  {
    title: "Select the assets you want to use.",
    description: "Users choose their Facebook Pages, Instagram accounts, Meta ad accounts and WhatsApp Business assets.",
  },
  {
    title: "Manage everything from StabiFlow.",
    description: "Users can manage campaigns, conversations, leads, content and analytics from their workspace.",
  },
];

const audienceCards = [
  "Small and medium businesses",
  "Marketing teams",
  "Sales teams",
  "Customer support teams",
  "Agencies managing authorized client assets",
];

const securityPoints = [
  "Customers authorize access through Meta",
  "Customers choose which assets StabiFlow can use",
  "Access is workspace-specific",
  "Users can disconnect integrations",
  "StabiFlow follows least-privilege access principles",
  "Customer data is only used to provide the requested service",
  "Access is not sold to third parties",
];

const faqs = [
  {
    question: "What is StabiFlow?",
    answer: "StabiFlow is a SaaS platform that helps businesses manage advertising, communications, leads and customer workflows from one workspace.",
  },
  {
    question: "Does StabiFlow own my Facebook, Instagram or WhatsApp accounts?",
    answer: "No. Customers retain ownership and control of their Meta business assets. StabiFlow only accesses assets that the customer explicitly authorizes.",
  },
  {
    question: "Can I disconnect my Meta account?",
    answer: "Yes. Authorized integrations can be disconnected from StabiFlow.",
  },
  {
    question: "Does StabiFlow share my data?",
    answer: "StabiFlow uses authorized data to provide the features requested by the customer. See the Privacy Policy for full details.",
  },
  {
    question: "Is StabiFlow affiliated with Meta?",
    answer: "StabiFlow uses Meta APIs to provide integrations but is not endorsed by or affiliated with Meta unless expressly stated otherwise.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-3" aria-label="StabiFlow home">
            <BrandLogo variant="full" className="h-8 w-auto" />
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition hover:text-foreground">Features</a>
            <a href="#how-it-works" className="transition hover:text-foreground">How it works</a>
            <a href="#security" className="transition hover:text-foreground">Security</a>
            <a href="#faq" className="transition hover:text-foreground">FAQ</a>
            <a href="#contact" className="transition hover:text-foreground">Contact</a>
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to="/login">Sign In</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/signup">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.10),_transparent_55%)]" />
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:px-8 lg:py-24">
            <div className="space-y-8">
              <div className="inline-flex items-center rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
                StabiFlow is a SaaS platform provided by Acapolite Consulting (Pty) Ltd.
              </div>

              <div className="space-y-5">
                <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                  Create. Advertise. Connect. Convert.
                </h1>
                <p className="max-w-xl text-lg leading-8 text-muted-foreground">
                  StabiFlow brings Meta advertising, Facebook and Instagram business assets, WhatsApp customer conversations, leads, content, analytics and automation into one workspace.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="group">
                  <Link to="/signup">
                    Get Started
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/login">Sign In</Link>
                </Button>
              </div>

              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>StabiFlow is a SaaS platform provided by Acapolite Consulting (Pty) Ltd.</span>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-5 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.35)]">
              <div className="rounded-2xl border border-border bg-gradient-to-br from-slate-50 via-white to-sky-50 p-5">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Example workspace</p>
                    <h2 className="mt-2 text-xl font-semibold">Growth dashboard</h2>
                  </div>
                  <div className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-700">
                    Illustrative
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border bg-white p-4">
                      <p className="text-xs text-muted-foreground">Campaigns</p>
                      <p className="mt-2 text-2xl font-semibold">32</p>
                    </div>
                    <div className="rounded-xl border border-border bg-white p-4">
                      <p className="text-xs text-muted-foreground">Qualified leads</p>
                      <p className="mt-2 text-2xl font-semibold">1,480</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-white p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Advertising performance</p>
                      <span className="text-xs text-emerald-600">+12.4%</span>
                    </div>
                    <div className="mt-4 flex h-28 items-end gap-2">
                      {[28, 44, 35, 60, 58, 72, 82].map((bar, index) => (
                        <div key={index} className="flex-1 rounded-t-xl bg-gradient-to-t from-sky-500 to-blue-300" style={{ height: `${bar}%` }} />
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border bg-white p-4">
                      <p className="text-xs text-muted-foreground">Inbox</p>
                      <p className="mt-2 text-xl font-semibold">214 new</p>
                    </div>
                    <div className="rounded-xl border border-border bg-white p-4">
                      <p className="text-xs text-muted-foreground">Automation tasks</p>
                      <p className="mt-2 text-xl font-semibold">19 active</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="border-y border-border bg-muted/20">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">What StabiFlow does</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">One workspace for your marketing and customer operations.</h2>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {featureCards.map(({ icon: Icon, title, description }) => (
                <div key={title} className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
                  <div className="mb-4 inline-flex rounded-xl bg-primary/5 p-3 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">How it works</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">From setup to daily operations.</h2>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-4">
            {steps.map((step, index) => (
              <div key={step.title} className="rounded-2xl border border-border bg-card p-6">
                <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {index + 1}
                </div>
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{step.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-dashed border-border bg-muted/30 p-5 text-sm leading-6 text-muted-foreground">
            Customers retain control of their own Meta business assets and permissions. StabiFlow only accesses business assets that an authenticated user has authorized.
          </div>
        </section>

        <section className="border-y border-border bg-slate-950 text-white">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-300">Meta & WhatsApp integration</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Why StabiFlow uses Meta Platform Data.</h2>
              </div>

              <div className="space-y-6 text-slate-200">
                <p className="text-lg leading-8">
                  StabiFlow allows businesses to connect their own Meta business assets so they can manage authorized Facebook Pages, Instagram accounts, advertising accounts and WhatsApp customer communications from one workspace.
                </p>
                <p className="leading-7 text-slate-300">
                  Platform Data is used only to provide features requested by the customer for assets they have authorized StabiFlow to access.
                </p>
                <p className="leading-7 text-slate-300">
                  StabiFlow does not claim ownership of customers&apos; Meta business assets.
                </p>
              </div>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[
                "Display connected Facebook Pages",
                "Display connected Instagram business accounts",
                "Display and manage authorized Meta ad accounts",
                "Retrieve campaign and performance data",
                "Support Meta campaign workflows",
                "Manage authorized WhatsApp Business accounts",
                "Receive and send customer messages through authorized WhatsApp Business accounts",
              ].map((useCase) => (
                <div key={useCase} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                  <div className="mb-3 inline-flex rounded-full bg-white/10 p-2 text-sky-300">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <p>{useCase}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Who StabiFlow is for</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Built for teams that need clarity across marketing and customer experience.</h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
            {audienceCards.map((label) => (
              <div key={label} className="rounded-2xl border border-border bg-card p-5 text-center shadow-sm">
                <div className="mb-4 inline-flex rounded-full bg-primary/5 p-3 text-primary">
                  <Users className="h-5 w-5" />
                </div>
                <p className="text-base font-medium">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="security" className="border-y border-border bg-muted/20">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Security & data control</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Least-privilege access, customer-controlled permissions.</h2>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {securityPoints.map((point) => (
                <div key={point} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
                  <div className="mt-0.5 rounded-full bg-emerald-50 p-1 text-emerald-600">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <p className="text-sm leading-6 text-foreground">{point}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-border bg-card p-8 shadow-sm">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Provider</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">StabiFlow is developed and operated by Acapolite Consulting (Pty) Ltd.</h2>
            <p className="mt-5 max-w-3xl text-base leading-8 text-muted-foreground">
              StabiFlow is developed and operated by Acapolite Consulting (Pty) Ltd. Acapolite Consulting provides business and technology services and operates StabiFlow as a SaaS platform for businesses that need a single workspace for advertising, communications, customer management and automation. StabiFlow is based in South Africa.
            </p>
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span>Acapolite Consulting (Pty) Ltd · South Africa</span>
            </div>
          </div>
        </section>

        <section id="faq" className="border-y border-border bg-muted/20">
          <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">FAQ</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Questions businesses ask before connecting.</h2>
            </div>

            <div className="mt-12 space-y-4">
              {faqs.map((faq) => (
                <details key={faq.question} className="group rounded-2xl border border-border bg-card p-5" open={faq.question === "What is StabiFlow?"}>
                  <summary className="cursor-pointer list-none text-left text-base font-medium text-foreground">
                    {faq.question}
                  </summary>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-border bg-card p-8 shadow-sm">
            <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Contact</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight">Talk to the StabiFlow team.</h2>
                <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
                  Need help with setup, permissions, business onboarding or privacy questions? We&apos;re here to help you understand how StabiFlow fits your workflow.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-muted/20 p-5">
                <div className="mb-3 inline-flex rounded-full bg-primary/5 p-2.5 text-primary">
                  <Plug className="h-4 w-4" />
                </div>
                <p className="text-sm text-muted-foreground">Contact</p>
                <a href="mailto:contact@stabiflow.com" className="mt-2 block text-lg font-semibold text-foreground hover:underline">
                  contact@stabiflow.com
                </a>
                <a href="/contact" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline">
                  View contact page
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-background">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 text-sm text-muted-foreground sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <BrandLogo variant="full" className="h-7 w-auto" />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Link to="/legal/privacy" className="hover:text-foreground">Privacy Policy</Link>
              <Link to="/legal/terms" className="hover:text-foreground">Terms of Service</Link>
              <Link to="/contact" className="hover:text-foreground">Contact</Link>
              <Link to="/login" className="hover:text-foreground">Sign In</Link>
            </div>
          </div>
          <div className="flex flex-col gap-2 border-t border-border pt-6 text-xs leading-6 text-muted-foreground md:flex-row md:justify-between">
            <p>StabiFlow is developed and operated by Acapolite Consulting (Pty) Ltd. South Africa.</p>
            <p>Meta, Facebook, Instagram and WhatsApp are trademarks of their respective owners.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
