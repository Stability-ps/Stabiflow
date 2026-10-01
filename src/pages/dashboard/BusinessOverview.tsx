import { Building2, Contact, Files, Users, Wand2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useBusinessSectionCounts } from "@/hooks/useSectionCounts";
import { SectionLandingHeader, SectionLinkCard } from "@/components/layout/SectionLandingPage";

// Business is a landing/hub page, not a module of its own - it just gives
// an overview of, and quick access into, the business-management pages
// that already exist (My Business, Business Studio, Customers, Leads,
// Documents). Invoices/Quotes are intentionally absent here while
// module.invoicing stays off (see src/lib/navigation.ts) - never show a
// card for a module that doesn't exist yet.
export default function BusinessOverview() {
  const { currentWorkspaceId } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const showCustomers = isEnabled("module.customers");
  const showLeads = isEnabled("module.leads");
  const showBusinessStudio = isEnabled("module.business_studio");
  const counts = useBusinessSectionCounts(currentWorkspaceId, { customers: showCustomers, leads: showLeads });

  return (
    <div className="space-y-6">
      <SectionLandingHeader title="Business" description="Your business profile, customers, leads and documents in one place." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SectionLinkCard icon={Building2} title="My Business" description="Your business profile - the facts StabiFlow and your customers see." to="/app/business" />
        {showBusinessStudio && (
          <SectionLinkCard icon={Wand2} title="Business Studio" description="Scan your website to build and keep your business profile up to date." to="/app/business-studio" />
        )}
        {showCustomers && (
          <SectionLinkCard icon={Contact} title="Customers" description="Everyone who's bought from you, with their full history." to="/app/customers" count={counts.data?.customers} countLabel="customers" />
        )}
        {showLeads && (
          <SectionLinkCard icon={Users} title="Leads" description="New enquiries and your sales pipeline." to="/app/leads" count={counts.data?.leads} countLabel="leads" />
        )}
        <SectionLinkCard icon={Files} title="Documents" description="Proposals and documents generated for your business." to="/app/documents" count={counts.data?.documents} countLabel="documents" />
      </div>
    </div>
  );
}
