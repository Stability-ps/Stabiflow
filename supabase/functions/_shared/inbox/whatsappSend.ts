// Sends a WhatsApp text message and downloads inbound media via the Meta
// WhatsApp Cloud API (Phase D). Adapted from Acapolite's whatsapp-agent
// sendText()/downloadMedia() - the CALLS are the same Graph API endpoints,
// but the credential is now a per-workspace {token, phoneNumberId} resolved
// by the caller from Vault (see integrations-connection-health/
// integrations-oauth-callback for the established get_workspace_integration_secret()
// pattern), never a global WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID
// environment variable.
import { classifyIntegrationNetworkError, classifyMetaGraphError } from "../integration-providers/metaGraphError.ts";
import { graphApiBaseUrl } from "../integration-providers/metaOAuth.ts";
import { cleanReply } from "./replyGuardrails.ts";

export type WhatsAppSendCredential = { token: string; phoneNumberId: string; apiVersion: string };

const MAX_MEDIA_BYTES = 12 * 1024 * 1024;

export async function sendWhatsAppText(cred: WhatsAppSendCredential, to: string, body: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`${graphApiBaseUrl(cred.apiVersion)}/${cred.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: cleanReply(body) } }),
    });
  } catch (error) {
    classifyIntegrationNetworkError(error);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) classifyMetaGraphError(response.status, data);
  return String(data?.messages?.[0]?.id || "") || null;
}

export type DownloadedMedia = { bytes: Uint8Array; mime: string; size: number; sha256: string | null };

export async function downloadWhatsAppMedia(cred: WhatsAppSendCredential, mediaId: string): Promise<DownloadedMedia> {
  const lookupUrl = `${graphApiBaseUrl(cred.apiVersion)}/${mediaId}`;
  let lookup: Response;
  try {
    lookup = await fetch(lookupUrl, { headers: { Authorization: `Bearer ${cred.token}` } });
  } catch (error) {
    classifyIntegrationNetworkError(error);
  }
  const info = await lookup.json().catch(() => ({}));
  if (!lookup.ok || !info?.url) classifyMetaGraphError(lookup.status, info);
  if (Number(info.file_size || 0) > MAX_MEDIA_BYTES) throw new Error("Attachment too large");

  let response: Response;
  try {
    response = await fetch(String(info.url), { headers: { Authorization: `Bearer ${cred.token}` } });
  } catch (error) {
    classifyIntegrationNetworkError(error);
  }
  if (!response.ok) throw new Error(`Media download failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error("Attachment too large");
  return { bytes, mime: String(info.mime_type || response.headers.get("content-type") || "application/octet-stream"), size: bytes.byteLength, sha256: String(info.sha256 || "") || null };
}

export const ALLOWED_INBOUND_MEDIA_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
