import { supabase } from "@/integrations/supabase/client";

type ErrorPayload = { error?: unknown; code?: unknown; error_code?: unknown };

function pickErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const { error, code, error_code: errorCode } = payload as ErrorPayload;
  if (typeof error === "string" && error.trim().length > 0) return error.trim();
  if (typeof code === "string" && code.trim().length > 0) return code.trim();
  if (typeof errorCode === "string" && errorCode.trim().length > 0) return errorCode.trim();
  return null;
}

async function readErrorPayloadFromContext(error: unknown): Promise<unknown> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!context || typeof context !== "object") return null;

  const maybeResponse = context as { json?: () => Promise<unknown>; text?: () => Promise<string>; clone?: () => unknown };
  const responseWithClone = typeof maybeResponse.clone === "function" ? (maybeResponse.clone() as { json?: () => Promise<unknown>; text?: () => Promise<string> }) : maybeResponse;

  if (typeof responseWithClone.json === "function") {
    try {
      return await responseWithClone.json();
    } catch {
      // Ignore malformed/empty JSON responses and try text fallback.
    }
  }

  if (typeof responseWithClone.text === "function") {
    try {
      const text = await responseWithClone.text();
      if (!text) return null;
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  return null;
}

export class IntegrationInvokeError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "IntegrationInvokeError";
    this.code = code;
  }
}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const contextPayload = await readErrorPayloadFromContext(error);
    const errorCode = pickErrorCode(data) || pickErrorCode(contextPayload);
    if (errorCode) {
      throw new IntegrationInvokeError(errorCode, errorCode);
    }
    throw new IntegrationInvokeError(`${name} failed`);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    const errorCode = pickErrorCode(data);
    if (errorCode) {
      throw new IntegrationInvokeError(errorCode, errorCode);
    }
    throw new IntegrationInvokeError(`${name} failed`);
  }
  return data as T;
}

export type IntegrationProvider = "meta" | "whatsapp";

// Starts an OAuth connection: the caller must navigate the browser to the
// returned url directly (window.location.href = url), NOT fetch it - it's
// Meta's consent dialog, which redirects back to StabiFlow's OAuth
// callback edge function (never back through this frontend call).
export function startIntegrationConnect(workspaceId: string, provider: IntegrationProvider) {
  return invoke<{ url: string }>("integrations-oauth-start", { workspace_id: workspaceId, provider });
}

export type WebhookSubscriptionInfo = { status: "subscribed" | "not_subscribed" | "unknown" | "error"; detail: string; wabaCount: number };

export type DiscoverySummary = {
  facebookPages: { discovered: number; new: number; collisions: number };
  instagramAccounts: { discovered: number; new: number; collisions: number };
  adAccounts: { discovered: number; new: number; collisions: number };
  whatsappNumbers: { discovered: number; new: number; collisions: number };
  whatsappWebhook?: { status: string; detail: string; wabaCount: number };
  collisionDetails: Array<{ table: string; providerId: string }>;
};

export function refreshIntegrationResources(workspaceId: string, provider: IntegrationProvider) {
  return invoke<{ ok: true; summary: DiscoverySummary }>("integrations-discover-resources", { workspace_id: workspaceId, provider });
}

// Explicit "Subscribe webhook" / "Repair subscription" action. Server-side
// this re-POSTs POST /{waba}/subscribed_apps for this workspace's
// discovered WABA(s); it is integration.manage-gated in the edge function.
export function repairWhatsAppWebhookSubscription(workspaceId: string) {
  return invoke<{ ok: true; webhookSubscription: WebhookSubscriptionInfo }>("integrations-discover-resources", {
    workspace_id: workspaceId,
    provider: "whatsapp",
    repair_webhook: true,
  });
}

export type IntegrationResourceHealth = { type: string; id: string; label: string; healthy: boolean; category?: string; message?: string };

export type ConnectionHealthResult = {
  ok: true;
  integration: {
    connected: boolean;
    healthy?: boolean;
    status?: string;
    webhook?: { status: "subscribed" | "not_subscribed" | "unknown" | "error"; detail: string; checked_at: string } | null;
  };
  resources: IntegrationResourceHealth[];
};

export function checkIntegrationConnectionHealth(workspaceId: string, provider: IntegrationProvider) {
  return invoke<ConnectionHealthResult>("integrations-connection-health", { workspace_id: workspaceId, provider });
}

export function disconnectIntegration(workspaceId: string, provider: IntegrationProvider) {
  return invoke<{ ok: true }>("integrations-disconnect", { workspace_id: workspaceId, provider });
}

// --- Resource activation (direct table write - RLS via integration.manage
// is the authorization boundary, same "no edge function needed for a
// plain column toggle" pattern as content_series/ad_campaigns drafts).

export async function setResourceActive(table: "workspace_facebook_pages" | "workspace_instagram_accounts" | "workspace_meta_ad_accounts" | "workspace_whatsapp_numbers", id: string, isActive: boolean) {
  const { error } = await supabase.from(table).update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
}
