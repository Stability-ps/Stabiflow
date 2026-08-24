import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/useAuth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireWorkspace } from "@/components/RequireWorkspace";
import { AppLayout } from "@/components/layout/AppLayout";
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
import Integrations from "@/pages/dashboard/Integrations";
import Settings from "@/pages/dashboard/Settings";

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
      <Route
        element={
          <RequireAuth>
            <RequireWorkspace>
              <AppLayout />
            </RequireWorkspace>
          </RequireAuth>
        }
      >
        <Route path="/" element={<Overview />} />
        <Route path="/content" element={<Content />}>
          <Route index element={<Navigate to="calendar" replace />} />
          <Route path="calendar" element={<ContentCalendar />} />
          <Route path="scheduled" element={<ContentScheduled />} />
          <Route path="published" element={<ContentPublished />} />
          <Route path="drafts" element={<ContentDrafts />} />
          <Route path="media-library" element={<ContentMediaLibrary />} />
        </Route>
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/campaigns/new" element={<NewCampaign />} />
        <Route path="/campaigns/:id/edit" element={<EditCampaign />} />
        <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
        <Route path="/creative-studio" element={<CreativeStudio />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/flow-ai" element={<FlowAI />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/settings" element={<Settings />} />
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
