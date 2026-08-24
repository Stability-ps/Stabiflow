// Placeholder. No LinkedIn credentials are requested or stored yet. This
// exists purely so the provider dispatch table in the worker has a real
// entry to route to once LinkedIn Company Page publishing is implemented,
// instead of requiring a schema/dispatch redesign later.
//
// Ported unchanged from Acapolite's _shared/social-providers/linkedin.ts.
import { PermanentPublishError } from "./types.ts";
import type { PublishRequest, PublishSuccess } from "./types.ts";

export async function publishToLinkedInCompanyPage(_request: PublishRequest): Promise<PublishSuccess> {
  throw new PermanentPublishError("linkedin_not_implemented", "LinkedIn Company Page publishing is not implemented yet.");
}
