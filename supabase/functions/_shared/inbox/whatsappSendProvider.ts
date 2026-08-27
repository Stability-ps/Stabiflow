// Provider seam for outbound WhatsApp sends (Phase L-1), mirroring
// _shared/ad-providers/adPublishExecution.ts's MetaAdsProvider pattern
// exactly: the same function signatures for the real and mock
// implementations, selected by the SAME INTEGRATIONS_META_MOCK_MODE flag
// already used everywhere else in this codebase, decided by the calling
// edge function - never a hidden fallback from real to mock or back.
//
// Before this, sendWhatsAppText had no mock at all; every prior test
// exercised the FAILURE path (a fake token making the real Graph call
// fail), never a genuine success. This seam is what lets Phase L-1's
// tests prove the window/template logic actually WORKS on success,
// without a real Meta API call or real message.
import { sendWhatsAppText, sendWhatsAppTemplate, type WhatsAppSendCredential, type WhatsAppTemplateParameter } from "./whatsappSend.ts";

export type WhatsAppSendProvider = {
  sendText(cred: WhatsAppSendCredential, to: string, body: string): Promise<string | null>;
  sendTemplate(cred: WhatsAppSendCredential, to: string, template: { name: string; language: string; bodyParameters: WhatsAppTemplateParameter[] }): Promise<string | null>;
};

export const REAL_WHATSAPP_PROVIDER: WhatsAppSendProvider = {
  sendText: sendWhatsAppText,
  sendTemplate: sendWhatsAppTemplate,
};

export function isWhatsAppMockMode(): boolean {
  return (Deno.env.get("INTEGRATIONS_META_MOCK_MODE") || "").trim().toLowerCase() === "true";
}
