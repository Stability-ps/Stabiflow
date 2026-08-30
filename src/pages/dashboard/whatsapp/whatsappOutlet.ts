import { useOutletContext } from "react-router-dom";
import type { WorkspaceIntegrationRow } from "@/hooks/useIntegrations";

export type WhatsAppNumber = {
  id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  platform_status: string | null;
  waba_id: string | null;
  is_active: boolean;
};

export type WhatsAppOutletContext = {
  workspaceId: string;
  canView: boolean;
  canManage: boolean;
  numbers: WhatsAppNumber[];
  activeNumbers: WhatsAppNumber[];
  integration: WorkspaceIntegrationRow;
};

// Shared by every /app/whatsapp/* child page - the parent WhatsAppLayout
// supplies this via <Outlet context>, so children never re-run the
// permission / connection gates or re-fetch the integration row.
export function useWhatsAppOutlet(): WhatsAppOutletContext {
  return useOutletContext<WhatsAppOutletContext>();
}
