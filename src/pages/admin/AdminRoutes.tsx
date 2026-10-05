import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "@/components/admin/AdminLayout";
import AdminOverview from "@/pages/admin/AdminOverview";
import AdminAttention from "@/pages/admin/AdminAttention";
import AdminActivity from "@/pages/admin/AdminActivity";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminUserDetail from "@/pages/admin/AdminUserDetail";
import AdminBusinesses from "@/pages/admin/AdminBusinesses";
import AdminBusinessDetail from "@/pages/admin/AdminBusinessDetail";
import AdminRevenue from "@/pages/admin/AdminRevenue";
import AdminTransactions from "@/pages/admin/AdminTransactions";
import AdminSubscriptions from "@/pages/admin/AdminSubscriptions";
import AdminAudit from "@/pages/admin/AdminAudit";
import AdminStaff from "@/pages/admin/AdminStaff";
import AdminExports from "@/pages/admin/AdminExports";
import {
  AdminBusinessStudioPage, AdminContentPage, AdminFeaturesPage, AdminHealthPage, AdminLaunchPage, AdminPlansPage, AdminSettingsPage, AdminUsagePage,
} from "@/pages/admin/AdminOperatorPages";

export default function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<AdminOverview />} />
        <Route path="attention" element={<AdminAttention />} />
        <Route path="activity" element={<AdminActivity />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="users/:id" element={<AdminUserDetail />} />
        <Route path="businesses" element={<AdminBusinesses />} />
        <Route path="businesses/:id" element={<AdminBusinessDetail />} />
        <Route path="revenue" element={<AdminRevenue />} />
        <Route path="transactions" element={<AdminTransactions />} />
        <Route path="subscriptions" element={<AdminSubscriptions />} />
        <Route path="plans" element={<AdminPlansPage />} />
        <Route path="usage" element={<AdminUsagePage />} />
        <Route path="business-studio" element={<AdminBusinessStudioPage />} />
        <Route path="features" element={<AdminFeaturesPage />} />
        <Route path="content" element={<AdminContentPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
        <Route path="health" element={<AdminHealthPage />} />
        <Route path="launch" element={<AdminLaunchPage />} />
        <Route path="exports" element={<AdminExports />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="staff" element={<AdminStaff />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
