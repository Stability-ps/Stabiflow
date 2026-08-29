import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
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
import CreateWorkspace from "@/pages/CreateWorkspace";
import AcceptInvitation from "@/pages/AcceptInvitation";
import Overview from "@/pages/dashboard/Overview";
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
import Inbox from "@/pages/dashboard/Inbox";
import Leads from "@/pages/dashboard/Leads";
import Analytics from "@/pages/dashboard/Analytics";
import FlowAI from "@/pages/dashboard/FlowAI";
import Automations from "@/pages/dashboard/Automations";
import Integrations from "@/pages/dashboard/Integrations";
import Settings from "@/pages/dashboard/Settings";
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

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route
        path="/create-workspace"
        element={
          <RequireAuth>
            <CreateWorkspace />
          </RequireAuth>
        }
      />
      <Route path="/accept-invitation" element={<AcceptInvitation />} />
      <Route path="/legal/privacy" element={<Privacy />} />
      <Route path="/legal/terms" element={<Terms />} />
      <Route path="/legal/data-deletion" element={<DataDeletion />} />
      <Route
        element={
          <RequireAuth>
            <RequireWorkspace>
              <AppLayout />
            </RequireWorkspace>
          </RequireAuth>
        }
      >
        <Route path="/app" element={<Overview />} />
        <Route path="/app/content" element={<Content />}>
          <Route index element={<Navigate to="media-library" replace />} />
          <Route path="calendar" element={<ContentCalendar />} />
          <Route path="scheduled" element={<ContentScheduled />} />
          <Route path="published" element={<ContentPublished />} />
          <Route path="drafts" element={<ContentDrafts />} />
          <Route path="media-library" element={<ContentMediaLibrary />} />
        </Route>
        <Route path="/app/campaigns" element={<Campaigns />} />
        <Route path="/app/campaigns/new" element={<NewCampaign />} />
        <Route path="/app/campaigns/:id/edit" element={<EditCampaign />} />
        <Route path="/app/campaigns/:id" element={<CampaignDetailPage />} />
        <Route path="/app/creative-studio" element={<CreativeStudio />} />
        <Route path="/app/inbox" element={<Inbox />} />
        <Route path="/app/leads" element={<Leads />} />
        <Route path="/app/analytics" element={<Analytics />} />
        <Route path="/app/flow-ai" element={<FlowAI />} />
        <Route path="/app/automations" element={<Automations />} />
        <Route path="/app/integrations" element={<Integrations />} />
        <Route path="/app/settings" element={<Settings />} />
        <Route path="/app/operator" element={<Operator />} />
      </Route>
    </Routes>
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
