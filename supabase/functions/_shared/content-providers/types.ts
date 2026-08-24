// Provider-agnostic publishing interface. Every provider (meta-facebook,
// meta-instagram, and eventually linkedin) implements the same shape so the
// worker never branches on platform-specific logic outside of picking which
// module to call.
//
// Adapted from Acapolite's _shared/social-providers/types.ts: PublishRequest
// gained `token`/`apiVersion`. Acapolite read a single global
// META_ACCESS_TOKEN/META_GRAPH_API_VERSION from the environment inside each
// provider function - that's exactly the single-tenant assumption Phase 5
// must remove. The caller (contentPublishExecution.ts) now resolves the
// right workspace's token via get_workspace_integration_secret() and passes
// it in explicitly, so a provider module itself never reads a workspace
// credential from process/Deno env.

export type PublishRequest = {
  imageUrl: string; // short-lived signed URL the provider can fetch the poster from
  caption: string;
  providerAccountId: string; // Facebook Page ID / IG Business Account ID / (future) LinkedIn org URN
  token: string; // this workspace's Meta access token, resolved from Vault by the caller
  apiVersion: string; // Graph API version, e.g. "v21.0"
};

export type PublishSuccess = {
  ok: true;
  providerPostId: string;
  permalink: string | null;
};

// Thrown, not returned, so a provider can never accidentally "succeed" by
// forgetting to check a response - every non-success path is an exception
// the worker must classify via the two error classes below.
export class TemporaryPublishError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TemporaryPublishError";
    this.code = code;
  }
}

export class PermanentPublishError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PermanentPublishError";
    this.code = code;
  }
}

export type ContentProvider = {
  key: string;
  publish: (request: PublishRequest) => Promise<PublishSuccess>;
};
