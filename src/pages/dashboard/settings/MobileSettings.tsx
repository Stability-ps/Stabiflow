import { Link, useSearchParams } from "react-router-dom";
import { Building2, ChevronLeft, ChevronRight, CreditCard, Palette, Plug, UserRound, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceProfile } from "@/hooks/useWorkspaceProfile";
import { WorkspaceTab } from "@/pages/dashboard/settings/WorkspaceTab";
import { MembersTab } from "@/pages/dashboard/settings/MembersTab";
import { AccountTab } from "@/pages/dashboard/settings/AccountTab";

type MobileSettingsSection = "workspace" | "members" | "account";

function SettingsRow(props: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  onClick?: () => void;
  to?: string;
}) {
  const Icon = props.icon;
  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{props.title}</span>
        {props.subtitle ? <span className="block truncate text-xs text-muted-foreground">{props.subtitle}</span> : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </>
  );

  const className =
    "flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (props.to) {
    return <Link to={props.to} className={className}>{body}</Link>;
  }

  return <button type="button" onClick={props.onClick} className={className}>{body}</button>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</h2>;
}

export function MobileSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentWorkspaceId, currentMembership, profile, user } = useAuth();
  const { data } = useWorkspaceProfile(currentWorkspaceId);
  const section = searchParams.get("section") as MobileSettingsSection | null;

  const setSection = (next: MobileSettingsSection | null) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("section", next);
    else params.delete("section");
    setSearchParams(params, { replace: false });
  };

  if (section) {
    const title = section === "workspace" ? "Workspace" : section === "members" ? "Team & members" : "My account";
    return (
      <div className="space-y-4 md:hidden">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2" onClick={() => setSection(null)}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Settings
          </Button>
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        {section === "workspace" ? <WorkspaceTab /> : section === "members" ? <MembersTab /> : <AccountTab />}
      </div>
    );
  }

  const workspaceName = data?.workspace.name || currentMembership?.workspace.name || "Workspace";
  const workspaceSlug = data?.workspace.slug;
  const logoPath = data?.settings.logo_path;
  const workspaceSubtitle = workspaceSlug ? `stabiflow.com/${workspaceSlug}` : "Business profile and workspace settings";
  const memberSubtitle = currentMembership?.role ? `Your role: ${currentMembership.role}` : "Members, invitations and roles";
  const accountSubtitle = profile?.full_name || user?.email || "Profile and legal";

  return (
    <div className="space-y-5 md:hidden">
      <section className="rounded-2xl border bg-card p-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12 rounded-xl">
            <AvatarImage src={logoPath || undefined} alt={workspaceName} className="object-contain" />
            <AvatarFallback className="rounded-xl">{workspaceName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-semibold">{workspaceName}</p>
            <p className="truncate text-xs text-muted-foreground">{workspaceSubtitle}</p>
          </div>
        </div>
      </section>

      <section className="space-y-1">
        <SectionLabel>Workspace</SectionLabel>
        <div className="divide-y rounded-2xl border bg-card px-1">
          <SettingsRow icon={Building2} title="Workspace profile" subtitle="Name, business details, contact and region" onClick={() => setSection("workspace")} />
          <SettingsRow icon={Palette} title="Brand kit" subtitle="Logo, colours and advert identity" to="/app/creative-studio" />
          <SettingsRow icon={Plug} title="Integrations" subtitle="Meta, WhatsApp and connected services" to="/app/integrations" />
        </div>
      </section>

      <section className="space-y-1">
        <SectionLabel>Team</SectionLabel>
        <div className="rounded-2xl border bg-card px-1">
          <SettingsRow icon={Users} title="Members & roles" subtitle={memberSubtitle} onClick={() => setSection("members")} />
        </div>
      </section>

      <section className="space-y-1">
        <SectionLabel>Account</SectionLabel>
        <div className="divide-y rounded-2xl border bg-card px-1">
          <SettingsRow icon={UserRound} title="My account" subtitle={accountSubtitle} onClick={() => setSection("account")} />
          <SettingsRow icon={CreditCard} title="Billing" subtitle="Plan, usage and payment settings" to="/app/billing" />
        </div>
      </section>
    </div>
  );
}
