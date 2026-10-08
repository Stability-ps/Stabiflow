import { createContext, useContext } from "react";
import type { AdminMe } from "@/lib/adminApi";
import { can, type AdminPermission } from "@/lib/adminPermissions";

/** Provided by AdminLayout once the server has confirmed the caller's role. */
export const AdminContext = createContext<AdminMe | null>(null);

/** The signed-in staff member, as reported by the server. */
export function useAdmin() {
  const me = useContext(AdminContext);
  if (!me) throw new Error("useAdmin must be used inside the admin shell");
  return { ...me, can: (p: AdminPermission) => can(me.role, p) };
}
