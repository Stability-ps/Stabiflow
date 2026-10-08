// Mock WhatsApp send provider (Phase L-1), same shape/intent as
// _shared/ad-providers/metaMarketingApiMock.ts: fabricates a plausible
// result with no real Meta API call and no real message delivered, so the
// window/template send logic can be genuinely exercised end to end -
// never imported by the real provider, never silently substituted for it;
// the calling edge function is the only place that chooses, and only when
// resolveWhatsAppSendMockMode(req) is true - env flag AND test-harness
// header both present (see whatsappSendProvider.ts).
import type { WhatsAppSendProvider } from "./whatsappSendProvider.ts";

function mockWamid(prefix: string): string {
  return `mock_wamid_${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export const MOCK_WHATSAPP_PROVIDER: WhatsAppSendProvider = {
  sendText: (_cred, _to, _body) => Promise.resolve(mockWamid("text")),
  sendTemplate: (_cred, _to, _template) => Promise.resolve(mockWamid("template")),
};
