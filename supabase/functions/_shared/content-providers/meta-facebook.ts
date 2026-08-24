// Facebook Page feed photo publishing via the Meta Graph API.
//
// Adapted from Acapolite's _shared/social-providers/meta-facebook.ts: the
// token and API version now come from the PublishRequest (resolved
// per-workspace by the caller via get_workspace_integration_secret), never
// from a global META_ACCESS_TOKEN/META_GRAPH_API_VERSION environment
// variable - that was the single global credential this whole provider
// layer used to share across every tenant, which is exactly wrong for a
// multi-tenant product.
import { classifyMetaError, classifyNetworkError } from "./metaErrorClassifier.ts";
import type { PublishRequest, PublishSuccess } from "./types.ts";

export async function publishToFacebookPage(request: PublishRequest): Promise<PublishSuccess> {
  const url = `https://graph.facebook.com/${request.apiVersion}/${request.providerAccountId}/photos`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: request.imageUrl,
        caption: request.caption,
        access_token: request.token,
      }),
    });
  } catch (error) {
    classifyNetworkError(error);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.post_id && !body?.id) {
    classifyMetaError(response.status, body);
  }

  const postId = String(body.post_id || body.id);
  return {
    ok: true,
    providerPostId: postId,
    permalink: body.post_id ? `https://www.facebook.com/${body.post_id}` : null,
  };
}
