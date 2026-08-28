// Part 4 (launch-completion): workspace data export.
//
// Owner-only (workspace.delete - the same permission as deletion; export
// is part of the same "decide the workspace's fate" surface, not a
// separate lighter capability). Runs synchronously - at pilot scale this
// is realistic; if a tenant's inbox_messages/ai_messages volume grows
// into the tens of thousands, revisit as an async job (queue a request,
// generate in the background, notify when ready) rather than blocking
// this request.
//
// Fixed, allow-listed set of named queries (EXPORT_ENTITIES in
// workspaceLifecycle.ts) - deliberately NOT a generic "query any table by
// name" endpoint, which would be a trivial cross-tenant data leak vector.
// Every query below is explicitly workspace-scoped in the query itself,
// never parameterized by a client-supplied table/column name.
//
// Never selects: workspace_integrations.vault_secret_id or any
// vault.secrets row, any provider access/refresh token, any service-role
// credential, any password/auth secret. workspace_integrations itself is
// deliberately NOT in the export at all (see workspaceLifecycle.ts).
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
import { buildExportZip, toCsv } from "../_shared/workspaceLifecycle.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { workspace_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const workspaceId = body.workspace_id;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);

  // Re-verified as the caller (RLS-bound client): this is the actual
  // authorization boundary, not a trust of the client-supplied workspace_id.
  if (!(await hasWorkspacePermission(callerSb, workspaceId, "workspace.delete"))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const sb = createServiceClient();

  const [
    workspaceRow,
    settingsRow,
    membersRows,
    conversationsRows,
    messagesRows,
    leadsRows,
    pipelinesRows,
    stagesRows,
    opportunitiesRows,
    customersRows,
    attributionRows,
    revenueRows,
    contentRows,
    campaignsRows,
    automationsRows,
    automationRunsRows,
    aiConversationsRows,
    aiMessagesRows,
  ] = await Promise.all([
    sb.from("workspaces").select("id, name, slug, created_at").eq("id", workspaceId).maybeSingle(),
    sb.from("workspace_settings").select("timezone, business_description, website, currency, industry, contact_email, contact_phone, created_at").eq("workspace_id", workspaceId).maybeSingle(),
    // workspace_members has two FKs to profiles (user_id, invited_by) -
    // the embed must be disambiguated or PostgREST errors this query to
    // data:null, which was silently dropping every member row from the
    // export (members.csv came back empty even when a workspace had
    // members) instead of surfacing an error.
    sb.from("workspace_members").select("user_id, role, joined_at, profiles:profiles!workspace_members_user_id_fkey(full_name)").eq("workspace_id", workspaceId),
    sb.from("inbox_conversations").select("id, wa_id, phone_number, display_name, status, inbox_status, priority_level, created_at").eq("workspace_id", workspaceId),
    sb.from("inbox_messages").select("id, conversation_id, direction, sender_type, message_type, content, delivery_status, created_at").eq("workspace_id", workspaceId),
    sb.from("leads").select("id, name, email, phone, source, status, created_at").eq("workspace_id", workspaceId),
    sb.from("pipelines").select("id, name, is_default, created_at").eq("workspace_id", workspaceId),
    sb.from("pipeline_stages").select("id, pipeline_id, name, position").eq("workspace_id", workspaceId),
    sb.from("opportunities").select("id, lead_id, pipeline_id, stage_id, value_minor_units, currency, outcome, created_at").eq("workspace_id", workspaceId),
    sb.from("customers").select("id, name, email, phone, created_at").eq("workspace_id", workspaceId),
    sb.from("attribution_events").select("id, lead_id, event_type, source, campaign_id, occurred_at").eq("workspace_id", workspaceId),
    sb.from("revenue_events").select("id, opportunity_id, amount_minor_units, currency, occurred_at").eq("workspace_id", workspaceId),
    sb.from("content_scheduled_posts").select("id, caption, status, scheduled_for, published_at, created_at").eq("workspace_id", workspaceId),
    sb.from("ad_campaigns").select("id, name, objective, status, daily_budget_minor_units, currency, created_at").eq("workspace_id", workspaceId),
    sb.from("automations").select("id, name, trigger_type, is_active, created_at").eq("workspace_id", workspaceId),
    sb.from("automation_runs").select("id, automation_id, status, started_at, finished_at").eq("workspace_id", workspaceId),
    sb.from("ai_conversations").select("id, created_by, title, created_at").eq("workspace_id", workspaceId),
    sb.from("ai_messages").select("id, conversation_id, role, content, created_at").eq("workspace_id", workspaceId),
  ]);

  if (!workspaceRow.data) return json(req, { error: "Workspace not found" }, 404);

  const zip = buildExportZip({
    "workspace_profile.json": JSON.stringify({ ...workspaceRow.data, ...(settingsRow.data || {}) }, null, 2),
    "members.csv": toCsv((membersRows.data || []).map((m: Record<string, unknown>) => ({ user_id: m.user_id, role: m.role, joined_at: m.joined_at, full_name: (m.profiles as { full_name?: string } | null)?.full_name ?? null }))),
    "conversations.csv": toCsv(conversationsRows.data || []),
    "messages.csv": toCsv(messagesRows.data || []),
    "leads.csv": toCsv(leadsRows.data || []),
    "pipelines.csv": toCsv(pipelinesRows.data || []),
    "pipeline_stages.csv": toCsv(stagesRows.data || []),
    "opportunities.csv": toCsv(opportunitiesRows.data || []),
    "customers.csv": toCsv(customersRows.data || []),
    "attribution_events.csv": toCsv(attributionRows.data || []),
    "revenue_events.csv": toCsv(revenueRows.data || []),
    "content_posts.csv": toCsv(contentRows.data || []),
    "campaigns.csv": toCsv(campaignsRows.data || []),
    "automations.csv": toCsv(automationsRows.data || []),
    "automation_runs.csv": toCsv(automationRunsRows.data || []),
    "ai_conversations.csv": toCsv(aiConversationsRows.data || []),
    "ai_messages.csv": toCsv(aiMessagesRows.data || []),
  });

  await sb.from("workspace_activity_log").insert({
    workspace_id: workspaceId,
    actor_user_id: actorId,
    action: "workspace_data_exported",
    target_type: "workspace",
    target_id: workspaceId,
    metadata: {},
  });

  return new Response(zip, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${workspaceRow.data.slug}-export.zip"`,
      "Cache-Control": "no-store",
    },
  });
});
