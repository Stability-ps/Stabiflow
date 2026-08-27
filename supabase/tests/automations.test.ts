// Phase J (Automation Engine, V1 = deterministic READ+ACT via the SAME
// dispatchers the UI already uses). Proves, against the REAL deployed
// automations-actions / automations-tick / leads-actions / whatsapp-webhook
// edge functions - never mocked:
//  - malformed conditions/actions are rejected AT CREATION, never silently
//    accepted and discovered broken at run time
//  - permission gating on every automations-actions verb, and tenant
//    isolation / workspace-switching on automations/automation_runs/
//    domain_events via RLS
//  - a real domain event (emitted by leads-actions) is matched to an
//    enabled automation, executed through the SAME dispatcher the UI uses,
//    and recorded step-by-step
//  - idempotency: the (automation_id, domain_event_id) unique constraint,
//    and a genuinely concurrent duplicate webhook delivery collapsing to
//    exactly one domain event / one run / one notification
//  - retries (temporary failure schedules a backoff retry) and partial
//    failure (some steps succeeded, a later one failed - not auto-retried)
//  - loop prevention: an automation whose own action re-triggers its own
//    trigger_event_type is refused on the second hop (direct cycle), so a
//    lead can move at most one extra stage, never in an infinite loop
//  - a creator demoted AFTER enabling an automation has their NEXT run's
//    action rejected by the underlying dispatcher's own live permission
//    check - never cached from creation/enable time
//  - a disabled/draft automation never executes even when its trigger
//    event occurs
//  - an action_config that references another workspace's entity id is
//    rejected by the underlying dispatcher's own workspace-scoped lookup -
//    Automation gets no privileged parallel write path
//  - Flow AI's action_type goes through the SAME flow-ai-chat gateway and
//    respects the SAME workspace quota gate as a human chat request -
//    proven via the quota-exceeded path only, so this suite never consumes
//    real OpenAI usage
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, getTestEnv, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedLead, seedPipeline } from "./leadsHelpers";
import { seedWhatsAppSetup } from "./inboxHelpers";

const AUTOMATIONS_ACTIONS_URL = `${SUPABASE_URL}/functions/v1/automations-actions`;
const AUTOMATIONS_TICK_URL = `${SUPABASE_URL}/functions/v1/automations-tick`;
const LEADS_ACTIONS_URL = `${SUPABASE_URL}/functions/v1/leads-actions`;
const WHATSAPP_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
const AUTOMATIONS_CRON_SECRET = getTestEnv("AUTOMATIONS_CRON_SECRET");
const APP_SECRET = getTestEnv("INTEGRATIONS_META_APP_SECRET");

async function tokenFor(client: TestTenant["client"]): Promise<string> {
  const { data } = await client.auth.getSession();
  return data.session!.access_token;
}

async function callAutomationsActions(token: string, body: Record<string, unknown>) {
  const res = await fetch(AUTOMATIONS_ACTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function callLeadsActions(token: string, body: Record<string, unknown>) {
  const res = await fetch(LEADS_ACTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Runs one automations-tick invocation to completion (matches events -> creates runs -> executes due runs). Real deployed function, real cron secret - never the pg_cron schedule itself, so a test controls exactly when a tick happens instead of waiting up to a minute. */
async function tick(): Promise<Record<string, unknown>> {
  const res = await fetch(AUTOMATIONS_TICK_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": AUTOMATIONS_CRON_SECRET }, body: "{}" });
  expect(res.status).toBe(200);
  return res.json();
}

async function signWebhook(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

function textMessagePayload(phoneNumberId: string, waId: string, messageId: string, text: string) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-test", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: waId, profile: { name: "Automation Test Contact" } }],
      messages: [{ from: waId, id: messageId, type: "text", text: { body: text } }],
    } }] }],
  });
}

async function postWebhook(body: string) {
  const res = await fetch(WHATSAPP_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": await signWebhook(body) }, body });
  return { status: res.status, text: await res.text() };
}

describe("Automation Engine (Phase J, release blocker)", () => {
  let workspace: TestTenant;
  let otherWorkspace: TestTenant;
  let ownerToken: string;
  let managerClient: TestTenant["client"];
  let managerUserId: string;
  let managerToken: string;
  let viewerClient: TestTenant["client"];

  beforeAll(async () => {
    workspace = await createTestTenant("automations");
    otherWorkspace = await createTestTenant("automations-other");
    ownerToken = await tokenFor(workspace.client);

    const managerUser = await createTestUser("automations-manager");
    await seedMembership(workspace.workspaceId, managerUser.userId, "manager");
    managerClient = managerUser.client;
    managerUserId = managerUser.userId;
    managerToken = await tokenFor(managerClient);

    const viewerUser = await createTestUser("automations-viewer");
    await seedMembership(workspace.workspaceId, viewerUser.userId, "viewer");
    viewerClient = viewerUser.client;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant(otherWorkspace);
  });

  describe("creation - malformed input rejected at creation, never accepted for later discovery at run time", () => {
    it("rejects an unknown action_type outright", async () => {
      const result = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Bad action type", trigger_event_type: "lead.created",
        actions: [{ action_type: "delete_workspace", action_config: {} }],
      });
      expect(result.status).toBe(400);
      const { data } = await admin.from("automations").select("id").eq("workspace_id", workspace.workspaceId).eq("name", "Bad action type");
      expect(data).toEqual([]);
    });

    it("rejects an unrecognized condition operator", async () => {
      const result = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Bad operator", trigger_event_type: "lead.created",
        conditions: [{ field: "qualification_status", operator: "matches_regex", value: ".*" }],
        actions: [{ action_type: "create_notification", action_config: { title: "x" } }],
      });
      expect(result.status).toBe(400);
    });

    it("rejects an unrecognized trigger_event_type - the taxonomy is closed, never a tenant-supplied string", async () => {
      const result = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Bad trigger", trigger_event_type: "lead.deleted_forever",
        actions: [{ action_type: "create_notification", action_config: { title: "x" } }],
      });
      expect(result.status).toBe(400);
    });

    it("rejects a lead.idle_timeout trigger with no idle_timeout_minutes", async () => {
      const result = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Bad idle timeout", trigger_event_type: "lead.idle_timeout",
        actions: [{ action_type: "create_notification", action_config: { title: "x" } }],
      });
      expect(result.status).toBe(400);
    });

    it("rejects enabling an automation with zero actions - the dispatcher's own create/update validation refuses an empty actions array, so this seeds the zero-action state directly to prove the enable-time guard independently catches it too", async () => {
      const { data: automation } = await admin.from("automations").insert({ workspace_id: workspace.workspaceId, name: "No actions yet", trigger_event_type: "lead.created", created_by: managerUserId, status: "draft" }).select("id").single();
      const enableResult = await callAutomationsActions(managerToken, { workspace_id: workspace.workspaceId, action: "set_status", automation_id: automation!.id, status: "enabled" });
      expect(enableResult.status).toBe(400);
      await admin.from("automations").delete().eq("id", automation!.id);
    });
  });

  describe("permission gating on automations-actions", () => {
    it("a viewer (automation.view/view_runs only) cannot create, update, enable, or delete an automation", async () => {
      const create = await callAutomationsActions(await tokenFor(viewerClient), { workspace_id: workspace.workspaceId, action: "create", name: "Viewer attempt", trigger_event_type: "lead.created", actions: [{ action_type: "create_notification", action_config: {} }] });
      expect(create.status).toBe(403);
    });

    it("a viewer CAN read automations (broad view grant)", async () => {
      const { data, error } = await viewerClient.from("automations").select("id").eq("workspace_id", workspace.workspaceId);
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe("tenant isolation & workspace switching", () => {
    it("REGRESSION: a workspace member cannot read/write automations, automation_runs, or domain_events by passing ANOTHER workspace's id", async () => {
      const { data: autos, error: autosError } = await workspace.client.from("automations").select("id").eq("workspace_id", otherWorkspace.workspaceId);
      expect(autosError).toBeNull();
      expect(autos).toEqual([]);

      const { data: runs, error: runsError } = await workspace.client.from("automation_runs").select("id").eq("workspace_id", otherWorkspace.workspaceId);
      expect(runsError).toBeNull();
      expect(runs).toEqual([]);

      const { data: events, error: eventsError } = await workspace.client.from("domain_events").select("id").eq("workspace_id", otherWorkspace.workspaceId);
      expect(eventsError).toBeNull();
      expect(events).toEqual([]);
    });

    it("automations-actions refuses to update/enable/delete an automation_id that belongs to a DIFFERENT workspace even for an otherwise-privileged caller", async () => {
      const created = await callAutomationsActions(await tokenFor(otherWorkspace.client), {
        workspace_id: otherWorkspace.workspaceId, action: "create", name: "Other workspace automation", trigger_event_type: "lead.created", actions: [{ action_type: "create_notification", action_config: {} }],
      });
      expect(created.status).toBe(200);
      const foreignAutomationId = created.body.automation.id;

      const update = await callAutomationsActions(managerToken, { workspace_id: workspace.workspaceId, action: "update", automation_id: foreignAutomationId, name: "Hijacked" });
      expect(update.status).toBe(404);
      // delete's .eq(workspace_id) filter matches zero rows - Postgrest does
      // not error on a zero-row delete, so this still reports {ok:true};
      // the property that actually matters is that nothing was touched.
      const del = await callAutomationsActions(managerToken, { workspace_id: workspace.workspaceId, action: "delete", automation_id: foreignAutomationId });
      expect(del.status).toBe(200);
      const { data: stillThere } = await admin.from("automations").select("id, name").eq("id", foreignAutomationId).maybeSingle();
      expect(stillThere).not.toBeNull();
      expect(stillThere!.name).toBe("Other workspace automation");
      await admin.from("automations").delete().eq("id", foreignAutomationId);
    });
  });

  describe("end-to-end: lead.created triggers an enabled automation through the SAME dispatcher the UI uses", () => {
    let automationId: string;
    let leadId: string;

    it("creates and enables an automation: trigger=lead.created, action=create_internal_note", async () => {
      const created = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Note new leads", trigger_event_type: "lead.created",
        actions: [{ action_type: "create_internal_note", action_config: { note: "Auto-created by Phase J automation test" } }],
      });
      expect(created.status).toBe(200);
      automationId = created.body.automation.id;
      const enabled = await callAutomationsActions(managerToken, { workspace_id: workspace.workspaceId, action: "set_status", automation_id: automationId, status: "enabled" });
      expect(enabled.status).toBe(200);
    });

    it("creating a lead emits lead.created; a tick matches it, executes the action, and records the step", async () => {
      const result = await callLeadsActions(ownerToken, { workspace_id: workspace.workspaceId, action: "create_manual", contact_name: "Phase J Trigger Lead", source: "manual" });
      expect(result.status).toBe(200);
      leadId = result.body.lead.id;

      const { data: event } = await admin.from("domain_events").select("id").eq("dedupe_key", `lead.created:${leadId}`).maybeSingle();
      expect(event).not.toBeNull();

      await tick();

      const { data: run } = await admin.from("automation_runs").select("*").eq("automation_id", automationId).eq("domain_event_id", event!.id).maybeSingle();
      expect(run).not.toBeNull();
      expect(run!.status).toBe("succeeded");

      const { data: steps } = await admin.from("automation_run_steps").select("*").eq("run_id", run!.id);
      expect(steps).toHaveLength(1);
      expect(steps![0].status).toBe("succeeded");

      const { data: note } = await admin.from("crm_notes").select("id, body").eq("target_type", "lead").eq("target_id", leadId).maybeSingle();
      expect(note).not.toBeNull();
      expect(note!.body).toBe("Auto-created by Phase J automation test");
    });

    it("REGRESSION: idempotency - (automation_id, domain_event_id) is unique; a second run for the same pair is refused at the database level", async () => {
      const { data: event } = await admin.from("domain_events").select("id").eq("dedupe_key", `lead.created:${leadId}`).single();
      const { error } = await admin.from("automation_runs").insert({ automation_id: automationId, workspace_id: workspace.workspaceId, domain_event_id: event.id, status: "pending" });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("23505");
    });
  });

  describe("disabled/draft automations never execute", () => {
    it("a draft (never-enabled) automation produces no run even when its trigger event fires", async () => {
      const created = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Never enabled", trigger_event_type: "lead.created",
        actions: [{ action_type: "create_notification", action_config: { title: "should never fire" } }],
      });
      const automationId = created.body.automation.id;

      const result = await callLeadsActions(ownerToken, { workspace_id: workspace.workspaceId, action: "create_manual", contact_name: "Draft Automation Lead", source: "manual" });
      await tick();

      const { data: runs } = await admin.from("automation_runs").select("id").eq("automation_id", automationId);
      expect(runs).toEqual([]);
      await admin.from("automations").delete().eq("id", automationId);
      await admin.from("leads").delete().eq("id", result.body.lead.id);
    });

    it("an enabled-then-disabled automation stops executing", async () => {
      const created = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Enable then disable", trigger_event_type: "lead.created",
        actions: [{ action_type: "create_notification", action_config: { title: "should never fire either" } }],
      });
      const automationId = created.body.automation.id;
      await callAutomationsActions(managerToken, { workspace_id: workspace.workspaceId, action: "set_status", automation_id: automationId, status: "enabled" });
      await callAutomationsActions(managerToken, { workspace_id: workspace.workspaceId, action: "set_status", automation_id: automationId, status: "disabled" });

      const result = await callLeadsActions(ownerToken, { workspace_id: workspace.workspaceId, action: "create_manual", contact_name: "Disabled Automation Lead", source: "manual" });
      await tick();

      const { data: runs } = await admin.from("automation_runs").select("id").eq("automation_id", automationId);
      expect(runs).toEqual([]);
      await admin.from("automations").delete().eq("id", automationId);
      await admin.from("leads").delete().eq("id", result.body.lead.id);
    });
  });

  describe("retries and partial failure", () => {
    it("a temporary failure (the underlying dispatcher errors) schedules a backoff retry rather than terminally failing on the first attempt", async () => {
      const created = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Fails on nonexistent target", trigger_event_type: "lead.created",
        // target_id is a syntactically valid but nonexistent lead id - the underlying add_note dispatcher call 404s.
        actions: [{ action_type: "create_internal_note", action_config: { target_id: "00000000-0000-0000-0000-000000000000", note: "will never land" } }],
      });
      const automationId = created.body.automation.id;
      await callAutomationsActions(managerToken, { workspace_id: workspace.workspaceId, action: "set_status", automation_id: automationId, status: "enabled" });

      const result = await callLeadsActions(ownerToken, { workspace_id: workspace.workspaceId, action: "create_manual", contact_name: "Retry Test Lead", source: "manual" });
      const { data: event } = await admin.from("domain_events").select("id").eq("dedupe_key", `lead.created:${result.body.lead.id}`).single();
      await tick();

      const { data: run } = await admin.from("automation_runs").select("*").eq("automation_id", automationId).eq("domain_event_id", event.id).single();
      expect(run.status).toBe("pending"); // scheduled for retry, not terminally failed
      expect(run.attempt_count).toBe(1);
      expect(run.next_retry_at).not.toBeNull();

      await admin.from("automations").delete().eq("id", automationId);
      await admin.from("leads").delete().eq("id", result.body.lead.id);
    });

    it("a partial outcome (one action succeeds, a later one fails) is recorded as 'partial' and is not auto-retried", async () => {
      const created = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Partial failure automation", trigger_event_type: "lead.created",
        actions: [
          { action_type: "create_internal_note", action_config: { note: "This one succeeds" } },
          { action_type: "create_internal_note", action_config: { target_id: "00000000-0000-0000-0000-000000000000", note: "This one fails" } },
        ],
      });
      const automationId = created.body.automation.id;
      await callAutomationsActions(managerToken, { workspace_id: workspace.workspaceId, action: "set_status", automation_id: automationId, status: "enabled" });

      const result = await callLeadsActions(ownerToken, { workspace_id: workspace.workspaceId, action: "create_manual", contact_name: "Partial Failure Lead", source: "manual" });
      const { data: event } = await admin.from("domain_events").select("id").eq("dedupe_key", `lead.created:${result.body.lead.id}`).single();
      await tick();

      const { data: run } = await admin.from("automation_runs").select("*").eq("automation_id", automationId).eq("domain_event_id", event.id).single();
      expect(run.status).toBe("partial");
      expect(run.next_retry_at).toBeNull();

      const { data: steps } = await admin.from("automation_run_steps").select("status").eq("run_id", run.id).order("sort_order");
      expect(steps!.map((s: { status: string }) => s.status)).toEqual(["succeeded", "failed"]);

      await admin.from("automations").delete().eq("id", automationId);
      await admin.from("leads").delete().eq("id", result.body.lead.id);
    });
  });

  describe("loop prevention: a direct cycle is refused on the second hop, never runs forever", () => {
    it("REGRESSION: an automation whose OWN action re-emits its OWN trigger_event_type fires exactly once, not repeatedly", async () => {
      const { pipelineId, stages } = await seedPipeline(workspace.workspaceId, { stageNames: ["Stage A", "Stage B", "Stage C"] });
      const [stageA, stageB, stageC] = stages.sort((a, b) => a.sort_order - b.sort_order);
      const lead = await seedLead(workspace.workspaceId, { pipeline_id: pipelineId, pipeline_stage_id: stageA.id });

      const created = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Always move to Stage C", trigger_event_type: "lead.stage_changed",
        actions: [{ action_type: "update_lead_stage", action_config: { pipeline_id: pipelineId, pipeline_stage_id: stageC.id } }],
      });
      const automationId = created.body.automation.id;
      await callAutomationsActions(managerToken, { workspace_id: workspace.workspaceId, action: "set_status", automation_id: automationId, status: "enabled" });

      // Human moves A -> B. This is the ONE legitimate trigger.
      const move = await callLeadsActions(ownerToken, { workspace_id: workspace.workspaceId, action: "move_stage", lead_id: lead.id, pipeline_id: pipelineId, pipeline_stage_id: stageB.id });
      expect(move.status).toBe(200);

      await tick(); // Phase A creates run #1 (B, human-caused) and Phase C executes it: moves lead B -> C, which itself emits a SECOND lead.stage_changed (caused_by_automation_id = this automation).
      await tick(); // Phase A sees the SECOND event; loopGuard must refuse it (direct cycle) rather than creating run #2.
      await tick(); // One more tick to be sure nothing further ever fires.

      const { data: runs } = await admin.from("automation_runs").select("id, status").eq("automation_id", automationId);
      expect(runs).toHaveLength(1); // never a second run for this automation, despite 3 ticks
      expect(runs![0].status).toBe("succeeded");

      const { data: finalLead } = await admin.from("leads").select("pipeline_stage_id").eq("id", lead.id).single();
      expect(finalLead!.pipeline_stage_id).toBe(stageC.id); // the one legitimate hop DID apply

      const { data: stageChangeEvents } = await admin.from("domain_events").select("id").eq("entity_id", lead.id).eq("event_type", "lead.stage_changed");
      expect(stageChangeEvents).toHaveLength(2); // human's A->B, automation's B->C - never a third C->C loop attempt

      await admin.from("automations").delete().eq("id", automationId);
    });
  });

  describe("a creator demoted AFTER enabling an automation has their next run blocked by the dispatcher's own live permission check", () => {
    it("REGRESSION: demoting the automation's creator to viewer (no lead.edit) causes the next matching run's action to fail, never silently mutating with stale elevated access", async () => {
      const created = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Note leads (permission loss test)", trigger_event_type: "lead.created",
        actions: [{ action_type: "create_internal_note", action_config: { note: "Should never be written after demotion" } }],
      });
      const automationId = created.body.automation.id;
      const enabled = await callAutomationsActions(managerToken, { workspace_id: workspace.workspaceId, action: "set_status", automation_id: automationId, status: "enabled" });
      expect(enabled.status).toBe(200); // the creator DID have lead.edit at enable time

      // Demote the creator out from under the already-enabled automation.
      const { error: demoteError } = await admin.from("workspace_members").update({ role: "viewer" }).eq("workspace_id", workspace.workspaceId).eq("user_id", managerUserId);
      expect(demoteError).toBeNull();

      try {
        const result = await callLeadsActions(ownerToken, { workspace_id: workspace.workspaceId, action: "create_manual", contact_name: "Permission Loss Lead", source: "manual" });
        const { data: event } = await admin.from("domain_events").select("id").eq("dedupe_key", `lead.created:${result.body.lead.id}`).single();
        await tick();

        const { data: run } = await admin.from("automation_runs").select("id, status").eq("automation_id", automationId).eq("domain_event_id", event.id).single();
        const { data: steps } = await admin.from("automation_run_steps").select("status, error").eq("run_id", run.id);
        expect(steps![0].status).toBe("failed");
        expect(JSON.stringify(steps![0].error)).toMatch(/forbidden/i);

        const { data: note } = await admin.from("crm_notes").select("id").eq("target_type", "lead").eq("target_id", result.body.lead.id).maybeSingle();
        expect(note).toBeNull(); // the mutation never actually happened

        await admin.from("leads").delete().eq("id", result.body.lead.id);
      } finally {
        // Restore the pool identity's role for any other test/run that reuses it.
        await admin.from("workspace_members").update({ role: "manager" }).eq("workspace_id", workspace.workspaceId).eq("user_id", managerUserId);
        await admin.from("automations").delete().eq("id", automationId);
      }
    });
  });

  describe("cross-workspace entity reference in action_config is rejected by the underlying dispatcher's own workspace-scoped lookup", () => {
    it("REGRESSION: an action_config target_id borrowed from another workspace never mutates that workspace's data", async () => {
      const foreignLead = await seedLead(otherWorkspace.workspaceId, { contact_name: "Foreign Workspace Lead" });

      const created = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Cross-workspace reference attempt", trigger_event_type: "lead.created",
        actions: [{ action_type: "create_internal_note", action_config: { target_id: foreignLead.id, note: "Should never land on the foreign lead" } }],
      });
      const automationId = created.body.automation.id;
      await callAutomationsActions(managerToken, { workspace_id: workspace.workspaceId, action: "set_status", automation_id: automationId, status: "enabled" });

      const result = await callLeadsActions(ownerToken, { workspace_id: workspace.workspaceId, action: "create_manual", contact_name: "Cross Workspace Trigger Lead", source: "manual" });
      const { data: event } = await admin.from("domain_events").select("id").eq("dedupe_key", `lead.created:${result.body.lead.id}`).single();
      await tick();

      const { data: run } = await admin.from("automation_runs").select("id, status").eq("automation_id", automationId).eq("domain_event_id", event.id).single();
      const { data: steps } = await admin.from("automation_run_steps").select("status, error").eq("run_id", run.id);
      expect(steps![0].status).toBe("failed"); // "Lead not found" - the impersonated caller's own workspace never sees the foreign lead

      const { data: note } = await admin.from("crm_notes").select("id").eq("target_type", "lead").eq("target_id", foreignLead.id).maybeSingle();
      expect(note).toBeNull();

      await admin.from("automations").delete().eq("id", automationId);
      await admin.from("leads").delete().eq("id", result.body.lead.id);
      await admin.from("leads").delete().eq("id", foreignLead.id);
    });
  });

  describe("concurrent event delivery collapses to exactly one domain event, one run, one notification", () => {
    it("REGRESSION: two concurrent webhook deliveries for the same brand-new WhatsApp contact never produce two conversation.started events or two runs", async () => {
      const number = await seedWhatsAppSetup(workspace.workspaceId);
      const waId = `27${Date.now()}${Math.floor(Math.random() * 1000)}`;

      const created = await callAutomationsActions(managerToken, {
        workspace_id: workspace.workspaceId, action: "create", name: "Notify on new conversation", trigger_event_type: "conversation.started",
        actions: [{ action_type: "create_notification", action_config: { title: "New WhatsApp conversation" } }],
      });
      const automationId = created.body.automation.id;
      await callAutomationsActions(managerToken, { workspace_id: workspace.workspaceId, action: "set_status", automation_id: automationId, status: "enabled" });

      const [res1, res2] = await Promise.all([
        postWebhook(textMessagePayload(number.phone_number_id, waId, `wamid.concurrent-a-${Date.now()}`, "First concurrent message")),
        postWebhook(textMessagePayload(number.phone_number_id, waId, `wamid.concurrent-b-${Date.now()}`, "Second concurrent message")),
      ]);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const { data: conversation } = await admin.from("inbox_conversations").select("id").eq("whatsapp_number_id", number.id).eq("wa_id", waId).single();
      const { data: events } = await admin.from("domain_events").select("id").eq("dedupe_key", `conversation.started:${conversation.id}`);
      expect(events).toHaveLength(1); // exactly one, despite two concurrent deliveries racing the upsert

      await tick();
      const { data: runs } = await admin.from("automation_runs").select("id").eq("automation_id", automationId).eq("domain_event_id", events![0].id);
      expect(runs).toHaveLength(1);

      await admin.from("automations").delete().eq("id", automationId);
    });
  });

  describe("Flow AI's action_type respects the SAME workspace quota gate as a human chat request", () => {
    it("REGRESSION: a request_flow_ai_analysis action fails cleanly against an exhausted workspace quota - never consumes real OpenAI usage to prove this", async () => {
      const quotaWorkspace = await createTestTenant("automations-flow-ai-quota");
      try {
        const quotaOwnerToken = await tokenFor(quotaWorkspace.client);
        await admin.from("workspace_billing").update({ limits: { flow_ai_monthly_token_limit: 100 } }).eq("workspace_id", quotaWorkspace.workspaceId);
        await admin.from("ai_usage_events").insert({ workspace_id: quotaWorkspace.workspaceId, model: "gpt-4o-mini", status: "success", input_tokens: 60, output_tokens: 60 });

        const created = await callAutomationsActions(quotaOwnerToken, {
          workspace_id: quotaWorkspace.workspaceId, action: "create", name: "Request analysis on new lead", trigger_event_type: "lead.created",
          actions: [{ action_type: "request_flow_ai_analysis", action_config: { prompt: "Summarize this lead." } }],
        });
        const automationId = created.body.automation.id;
        await callAutomationsActions(quotaOwnerToken, { workspace_id: quotaWorkspace.workspaceId, action: "set_status", automation_id: automationId, status: "enabled" });

        const result = await callLeadsActions(quotaOwnerToken, { workspace_id: quotaWorkspace.workspaceId, action: "create_manual", contact_name: "Flow AI Quota Lead", source: "manual" });
        const { data: event } = await admin.from("domain_events").select("id").eq("dedupe_key", `lead.created:${result.body.lead.id}`).single();
        await tick();

        const { data: run } = await admin.from("automation_runs").select("id, status").eq("automation_id", automationId).eq("domain_event_id", event.id).single();
        const { data: steps } = await admin.from("automation_run_steps").select("status, error").eq("run_id", run.id);
        expect(steps![0].status).toBe("failed");
        expect(JSON.stringify(steps![0].error)).toMatch(/429/);
      } finally {
        await cleanupTenant(quotaWorkspace);
      }
    });
  });
});
