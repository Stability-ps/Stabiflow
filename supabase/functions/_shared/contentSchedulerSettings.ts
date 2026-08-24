// Two independent switches gate automatic publishing:
//  - CONTENT_AUTO_PUBLISH_ENABLED (env var, emergency kill switch): only an
//    operator with production environment access can flip this. It exists
//    so publishing can be killed even if the database or a workspace's
//    admin UI is compromised or misbehaving. This is deliberately a single
//    environment-level switch, not per-workspace - see Phase 5 instruction
//    "separate environment-level kill switch from workspace-level
//    preference."
//  - content_scheduler_settings.auto_publish_enabled (DB row, PER
//    WORKSPACE, admin toggle): what that workspace's own automatic
//    publishing switch controls.
// Both must independently allow publishing for the worker to do anything
// for a given workspace's posts - see computeEffectiveAutoPublish. Manual
// "Publish now" bypasses this entirely (it's a single, explicit, one-post
// action - see content-publish-now), so this module only matters for the
// automatic cron path.
//
// Adapted from Acapolite's _shared/socialSchedulerSettings.ts: only the env
// var name changed (SOCIAL_AUTO_PUBLISH_ENABLED -> CONTENT_AUTO_PUBLISH_ENABLED)
// and decideSetAutoPublish's `isAdmin` param is now about workspace-admin
// standing, not a single global role.
export function computeEffectiveAutoPublish(envKillSwitchAllows: boolean, workspaceAutoPublishEnabled: boolean): boolean {
  return envKillSwitchAllows === true && workspaceAutoPublishEnabled === true;
}

export function envKillSwitchAllowsPublishing(): boolean {
  return (Deno.env.get("CONTENT_AUTO_PUBLISH_ENABLED") || "false").trim().toLowerCase() === "true";
}

// The business decision behind content-scheduler-settings' "set" action,
// pulled out as a pure function so it's directly testable: a non-admin (of
// that workspace) is refused regardless of the requested value, and
// repeating the same enable/disable request is a no-op (idempotent) rather
// than a fresh write + a fresh audit log entry every time.
export type SetAutoPublishDecision =
  | { action: "forbidden" }
  | { action: "no_change"; enabled: boolean }
  | { action: "update"; enabled: boolean };

export function decideSetAutoPublish(params: { isWorkspaceAdmin: boolean; currentEnabled: boolean; requestedEnabled: boolean }): SetAutoPublishDecision {
  if (!params.isWorkspaceAdmin) return { action: "forbidden" };
  if (params.currentEnabled === params.requestedEnabled) return { action: "no_change", enabled: params.requestedEnabled };
  return { action: "update", enabled: params.requestedEnabled };
}
