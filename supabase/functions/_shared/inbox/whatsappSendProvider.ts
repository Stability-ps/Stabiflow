// Provider seam for outbound WhatsApp sends (Phase L-1), mirroring
// _shared/ad-providers/adPublishExecution.ts's MetaAdsProvider pattern
// exactly: the same function signatures for the real and mock
// implementations, decided by the calling edge function - never a hidden
// fallback from real to mock or back.
//
// Before this, sendWhatsAppText had no mock at all; every prior test
// exercised the FAILURE path (a fake token making the real Graph call
// fail), never a genuine success. This seam is what lets Phase L-1's
// tests prove the window/template logic actually WORKS on success,
// without a real Meta API call or real message.
//
// W1 hardening: the mock send provider is now gated by the SAME
// per-request test-harness proof that OAuth/discovery already require
// (_shared/integration-providers/testHarness.ts). There is only ONE
// deployed Supabase project (no staging) - INTEGRATIONS_META_MOCK_MODE
// alone cannot tell "the automated test suite is calling this" from "a
// real customer message just arrived on production". Without the
// x-stabiflow-test-harness header the mock is never selected, so a
// production send can never be silently faked, even while the env flag
// stays "true" for the test suite's benefit. (whatsapp-webhook, which is
// only ever hit by signature-verified Meta traffic, does not use this at
// all - it always sends for real.)
import { sendWhatsAppText, sendWhatsAppTemplate, type WhatsAppSendCredential, type WhatsAppTemplateParameter } from "./whatsappSend.ts";
import { isTestHarnessRequest } from "../integration-providers/testHarness.ts";

export type WhatsAppSendProvider = {
  sendText(cred: WhatsAppSendCredential, to: string, body: string): Promise<string | null>;
  sendTemplate(cred: WhatsAppSendCredential, to: string, template: { name: string; language: string; bodyParameters: WhatsAppTemplateParameter[] }): Promise<string | null>;
};

export const REAL_WHATSAPP_PROVIDER: WhatsAppSendProvider = {
  sendText: sendWhatsAppText,
  sendTemplate: sendWhatsAppTemplate,
};

function mockFlagOn(): boolean {
  return (Deno.env.get("INTEGRATIONS_META_MOCK_MODE") || "").trim().toLowerCase() === "true";
}

// The single authoritative resolver for whether an outbound send may use
// the mock provider. Requires BOTH the env flag AND a genuine test-harness
// request - a real (browser or Meta) caller can never receive it. Every
// send call site must route through this, never re-derive the env flag.
export function resolveWhatsAppSendMockMode(req: Request): boolean {
  return mockFlagOn() && isTestHarnessRequest(req);
}

// True exactly when the env flag is on but the caller is NOT the test
// harness - i.e. a real send that must go through the REAL provider even
// though mock mode is enabled for tests. Callers can log/assert on this to
// make the boundary observable.
export function isBlockedWhatsAppMockSend(req: Request): boolean {
  return mockFlagOn() && !isTestHarnessRequest(req);
}
