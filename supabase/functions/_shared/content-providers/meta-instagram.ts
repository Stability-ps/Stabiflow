// Instagram Business/Professional account feed publishing via the Meta
// Graph API's two-step container flow: create a media container, wait for
// Meta to finish processing it, then publish it.
//
// Adapted from Acapolite's _shared/social-providers/meta-instagram.ts: the
// token and API version now come from the PublishRequest (resolved
// per-workspace by the caller), never a global META_ACCESS_TOKEN/
// META_GRAPH_API_VERSION environment variable.
import { classifyMetaError, classifyNetworkError } from "./metaErrorClassifier.ts";
import { TemporaryPublishError } from "./types.ts";
import type { PublishRequest, PublishSuccess } from "./types.ts";

const CONTAINER_POLL_ATTEMPTS = 8;
const CONTAINER_POLL_DELAY_MS = 1500;

async function graphFetch(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    classifyNetworkError(error);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) classifyMetaError(response.status, body);
  return body;
}

async function waitForContainerReady(apiVersion: string, containerId: string, token: string) {
  for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt++) {
    const status = await graphFetch(
      `https://graph.facebook.com/${apiVersion}/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
      { method: "GET" },
    );
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR") {
      throw new TemporaryPublishError("ig_container_error", "Instagram media container failed to process");
    }
    await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_DELAY_MS));
  }
  // Still processing after the poll budget - a fresh retry will create a new
  // container next cron tick rather than hold the function open indefinitely.
  throw new TemporaryPublishError("ig_container_timeout", "Instagram media container did not finish processing in time");
}

export async function publishToInstagramAccount(request: PublishRequest): Promise<PublishSuccess> {
  const { apiVersion, token } = request;

  const container = await graphFetch(`https://graph.facebook.com/${apiVersion}/${request.providerAccountId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: request.imageUrl, caption: request.caption, access_token: token }),
  });
  const containerId = String(container.id);

  await waitForContainerReady(apiVersion, containerId, token);

  const published = await graphFetch(`https://graph.facebook.com/${apiVersion}/${request.providerAccountId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: token }),
  });
  const mediaId = String(published.id);

  let permalink: string | null = null;
  try {
    const permalinkResult = await graphFetch(
      `https://graph.facebook.com/${apiVersion}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`,
      { method: "GET" },
    );
    permalink = permalinkResult.permalink || null;
  } catch {
    // Permalink lookup is best-effort - publishing already succeeded.
    permalink = null;
  }

  return { ok: true, providerPostId: mediaId, permalink };
}
