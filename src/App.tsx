import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { AuthProvider } from "@/hooks/useAuth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireWorkspace } from "@/components/RequireWorkspace";
import { AppLayout } from "@/components/layout/AppLayout";
import LandingPage from "@/pages/LandingPage";
import ContactPage from "@/pages/Contact";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import CreateWorkspace from "@/pages/CreateWorkspace";
import AcceptInvitation from "@/pages/AcceptInvitation";
import Home from "@/pages/dashboard/Home";
import MyBusiness from "@/pages/dashboard/MyBusiness";
import Billing from "@/pages/dashboard/Billing";
import BusinessStudio from "@/pages/dashboard/BusinessStudio";
import Documents from "@/pages/dashboard/Documents";
import PublicProfile from "@/pages/PublicProfile";
import Pricing from "@/pages/Pricing";
import { LegalDocumentPage, LegalIndexPage } from "@/pages/legal/LegalDocumentPage";
import { FeatureGate } from "@/components/FeatureGate";
import Content from "@/pages/dashboard/Content";
import ContentCalendar from "@/pages/dashboard/content/Calendar";
import ContentScheduled from "@/pages/dashboard/content/Scheduled";
import ContentPublished from "@/pages/dashboard/content/Published";
import ContentDrafts from "@/pages/dashboard/content/Drafts";
import ContentMediaLibrary from "@/pages/dashboard/content/MediaLibrary";
import Campaigns from "@/pages/dashboard/Campaigns";
import NewCampaign from "@/pages/dashboard/campaigns/New";
import EditCampaign from "@/pages/dashboard/campaigns/Edit";
import CampaignDetailPage from "@/pages/dashboard/campaigns/Detail";
import CreativeStudio from "@/pages/dashboard/CreativeStudio";
import WhatsAppLayout from "@/pages/dashboard/whatsapp/WhatsAppLayout";
import WhatsAppInbox from "@/pages/dashboard/whatsapp/Inbox";
import WhatsAppContacts from "@/pages/dashboard/whatsapp/Contacts";
import WhatsAppTemplates from "@/pages/dashboard/whatsapp/Templates";
import WhatsAppSettings from "@/pages/dashboard/whatsapp/Settings";
import WhatsAppIntake from "@/pages/dashboard/whatsapp/Intake";
import WhatsAppAnalytics from "@/pages/dashboard/whatsapp/WhatsAppAnalytics";
import Leads from "@/pages/dashboard/Leads";
import Analytics from "@/pages/dashboard/Analytics";
import FlowAI from "@/pages/dashboard/FlowAI";
import Automations from "@/pages/dashboard/Automations";
import Integrations from "@/pages/dashboard/Integrations";
import Settings from "@/pages/dashboard/Settings";
import CustomersList from "@/pages/dashboard/customers/CustomersList";
import Customer360Page from "@/pages/dashboard/customers/Customer360";
import Privacy from "@/pages/legal/Privacy";
import Terms from "@/pages/legal/Terms";
import DataDeletion from "@/pages/legal/DataDeletion";
import Operator from "@/pages/operator/Operator";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/create-workspace"
        element={
          <RequireAuth>
            <CreateWorkspace />
          </RequireAuth>
        }
      />
      <Route path="/accept-invitation" element={<AcceptInvitation />} />
      <Route path="/b/:slug" element={<PublicProfile />} />
      {/* Admin-published versions take over from the in-code pages once
          the owner publishes one (Admin -> Pages & legal). */}
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/legal" element={<LegalIndexPage />} />
      <Route path="/legal/privacy" element={<LegalDocumentPage type="privacy_policy" fallback={<Privacy />} />} />
      <Route path="/legal/terms" element={<LegalDocumentPage type="terms_of_service" fallback={<Terms />} />} />
      <Route path="/legal/data-deletion" element={<LegalDocumentPage type="data_deletion" fallback={<DataDeletion />} />} />
      <Route path="/legal/subscription-terms" element={<LegalDocumentPage type="subscription_terms" />} />
      <Route path="/legal/refunds" element={<LegalDocumentPage type="refund_policy" />} />
      <Route path="/legal/cookies" element={<LegalDocumentPage type="cookie_policy" />} />
      <Route path="/legal/ai-and-data" element={<LegalDocumentPage type="ai_data_disclosure" />} />
      <Route
        element={
          <RequireAuth>
            <RequireWorkspace>
              <AppLayout />
            </RequireWorkspace>
          </RequireAuth>
        }
      >
        <Route path="/app" element={<Home />} />
        <Route path="/app/business" element={<MyBusiness />} />
        <Route path="/app/billing" element={<Billing />} />
        <Route path="/app/business-studio" element={<FeatureGate flag="module.business_studio"><BusinessStudio /></FeatureGate>} />
        <Route path="/app/documents" element={<Documents />} />
        <Route path="/app/content" element={<FeatureGate flag="module.content"><Content /></FeatureGate>}>
          <Route index element={<Navigate to="media-library" replace />} />
          <Route path="calendar" element={<ContentCalendar />} />
          <Route path="scheduled" element={<ContentScheduled />} />
          <Route path="published" element={<ContentPublished />} />
          <Route path="drafts" element={<ContentDrafts />} />
          <Route path="media-library" element={<ContentMediaLibrary />} />
        </Route>
        <Route path="/app/campaigns" element={<FeatureGate flag="module.campaigns"><Campaigns /></FeatureGate>} />
        <Route path="/app/campaigns/new" element={<FeatureGate flag="module.campaigns"><NewCampaign /></FeatureGate>} />
        <Route path="/app/campaigns/:id/edit" element={<FeatureGate flag="module.campaigns"><EditCampaign /></FeatureGate>} />
        <Route path="/app/campaigns/:id" element={<FeatureGate flag="module.campaigns"><CampaignDetailPage /></FeatureGate>} />
        <Route path="/app/creative-studio" element={<FeatureGate flag="module.creative_studio"><CreativeStudio /></FeatureGate>} />
        {/* Legacy flat Inbox route - kept as a redirect so old bookmarks and
            in-app links stay valid now that the Inbox lives inside the
            WhatsApp product area. */}
        <Route path="/app/inbox" element={<Navigate to="/app/whatsapp/inbox" replace />} />
        <Route path="/app/whatsapp" element={<FeatureGate flag="module.whatsapp"><WhatsAppLayout /></FeatureGate>}>
          <Route index element={<Navigate to="/app/whatsapp/inbox" replace />} />
          <Route path="inbox" element={<WhatsAppInbox />} />
          <Route path="contacts" element={<WhatsAppContacts />} />
          <Route path="templates" element={<WhatsAppTemplates />} />
          <Route path="intake" element={<WhatsAppIntake />} />
          <Route path="analytics" element={<WhatsAppAnalytics />} />
          <Route path="settings" element={<WhatsAppSettings />} />
          <Route path="*" element={<Navigate to="/app/whatsapp/inbox" replace />} />
        </Route>
        <Route path="/app/leads" element={<FeatureGate flag="module.leads"><Leads /></FeatureGate>} />
        <Route path="/app/customers" element={<FeatureGate flag="module.customers"><CustomersList /></FeatureGate>} />
        <Route path="/app/customers/:customerId" element={<FeatureGate flag="module.customers"><Customer360Page /></FeatureGate>} />
        <Route path="/app/analytics" element={<FeatureGate flag="module.analytics"><Analytics /></FeatureGate>} />
        <Route path="/app/flow-ai" element={<FeatureGate flag="module.flow_ai"><FlowAI /></FeatureGate>} />
        <Route path="/app/automations" element={<FeatureGate flag="module.automations"><Automations /></FeatureGate>} />
        <Route path="/app/integrations" element={<FeatureGate flag="module.integrations"><Integrations /></FeatureGate>} />
        <Route path="/app/settings" element={<Settings />} />
        <Route path="/app/operator" element={<Operator />} />
        {/* A stale/invalid authenticated link (e.g. an old campaign route
            missing the /app prefix) must stay inside the authenticated
            shell - never fall through to the public catch-all below,
            which would look exactly like an unexpected logout even
            though the session/workspace are both still fully intact. */}
        <Route path="/app/*" element={<NotFoundInApp />} />
      </Route>
      {/* Safety net for genuinely public/unrecognized paths only - unknown
          /app/* paths are handled above, inside the authenticated shell.
          See the integrations-oauth-callback blank-page regression. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function NotFoundInApp() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="That page doesn't exist or may have moved. Your workspace and session are unaffected."
      action={<Button asChild><Link to="/app">Back to Dashboard</Link></Button>}
    />
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <Toaster />
      <BrowserRouter>
        <ErrorBoundary label="app">
          <AppRoutes />
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
