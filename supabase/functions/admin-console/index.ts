// Admin Control Centre API: owner dashboard, needs-attention, activity,
// global search, user/business directories and detail, revenue,
// transactions, subscriptions, audit, staff roles and CSV exports.
//
// Authorization: resolveAdminCaller() (JWT -> platform_admin_roles) then a
// per-action permission from ADMIN_CONSOLE_ACTIONS. All reads go through
// service-role-only SQL read models (20261019060000_admin_control_centre.sql)
// that never return secrets, tokens or message/lead content. Every mutation
// and every export writes platform_admin_audit.
import { corsHeaders, json } from "../_shared/contentAuth.ts";
import { isUuid, reasonOf } from "../_shared/operator/adminValidation.ts";
import { permits, resolveAdminCaller, writeAdminAudit, type AdminCaller } from "../_shared/admin/authorize.ts";
import { ADMIN_CONSOLE_ACTIONS, ADMIN_ROLES, EXPORT_DATASETS, ROLE_LABELS, ROLE_PERMISSIONS, can, isAdminRole, isExportDataset, type ExportDataset } from "../_shared/admin/permissions.ts";
import { buildAlerts, type AttentionSignals } from "../_shared/admin/attention.ts";
import { exportFilename, toCsv } from "../_shared/admin/csv.ts";

const DAY = 86_400_000;
const MAX_RANGE_DAYS = 400;
const EXPORT_MAX_ROWS = 50_000;
const EXPORT_PAGE = 1000;

class BadRequest extends Error {}

function range(body: Record<string, unknown>): { from: string; to: string } {
  const to = typeof body.to === "string" ? new Date(body.to) : new Date();
  const from = typeof body.from === "string" ? new Date(body.from) : new Date(to.getTime() - 30 * DAY);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new BadRequest("Invalid date range");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY) throw new BadRequest(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
  return { from: from.toISOString(), to: to.toISOString() };
}

function paging(body: Record<string, unknown>, max = 100) {
  const pageSize = Math.min(Math.max(Number(body.pageSize) || 25, 1), max);
  const page = Math.max(Math.floor(Number(body.page) || 0), 0);
  return { pageSize, page, offset: page * pageSize };
}

function str(v: unknown, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

async function rpc<T>(caller: AdminCaller, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await caller.sb.rpc(fn, args);
  if (error) {
    if (error.code === "22023") throw new BadRequest(error.message);
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

const TXN_STATUSES = ["initialized", "success", "failed", "abandoned", "amount_mismatch", "reversed"] as const;
const TXN_KINDS = ["purchase", "subscription_initial", "subscription_renewal"] as const;
const SUB_STATUSES = ["incomplete", "active", "past_due", "grace", "cancelled", "expired"] as const;
const TXN_SELECT = "id, reference, provider, kind, status, amount_minor, currency, paid_amount_minor, paid_currency, paid_at, verified_via, failure_reason, created_at, updated_at, workspace_id, workspaces(name), billing_prices(billing_interval, billing_plans(name, code))";

// deno-lint-ignore no-explicit-any
function transactionsQuery(caller: AdminCaller, body: Record<string, unknown>, select: string, opts?: any) {
  let q = caller.sb.from("billing_transactions").select(select, opts);
  const status = oneOf(body.status, TXN_STATUSES);
  if (status) q = q.eq("status", status);
  const kind = oneOf(body.kind, TXN_KINDS);
  if (kind) q = q.eq("kind", kind);
  const currency = str(body.currency, 3).toUpperCase();
  if (/^[A-Z]{3}$/.test(currency)) q = q.eq("currency", currency);
  if (isUuid(body.workspace_id)) q = q.eq("workspace_id", body.workspace_id);
  const ref = str(body.q, 100);
  if (ref) q = q.ilike("reference", `%${ref.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (body.from || body.to) {
    const r = range(body);
    q = q.gte("created_at", r.from).lt("created_at", r.to);
  }
  return q.order("created_at", { ascending: false });
}

function subscriptionsQuery(caller: AdminCaller, body: Record<string, unknown>, opts?: unknown) {
  let q = caller.sb.from("workspace_subscriptions").select(
    "id, status, provider, current_period_start, current_period_end, grace_until, cancel_at_period_end, cancelled_at, created_at, updated_at, workspace_id, workspaces(name), billing_plans(name, code), billing_prices(amount_minor, currency, billing_interval)",
    opts,
  );
  const status = oneOf(body.status, SUB_STATUSES);
  if (status) q = q.eq("status", status);
  return q.order("created_at", { ascending: false });
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function collect(fetchPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; offset < EXPORT_MAX_ROWS; offset += EXPORT_PAGE) {
    const { data, error } = await fetchPage(offset, offset + EXPORT_PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < EXPORT_PAGE) break;
  }
  return rows;
}

async function exportRows(caller: AdminCaller, dataset: ExportDataset, body: Record<string, unknown>): Promise<{ columns: { key: string; label: string }[]; rows: Row[] }> {
  switch (dataset) {
    case "users": {
      const rows = await collect(async (from) => {
        const page = await rpc<{ rows: Row[] }>(caller, "admin_users_page", { p_search: str(body.search), p_filter: str(body.filter) || "all", p_limit: 100, p_offset: from });
        return { data: page.rows.map((r) => ({ ...r, workspaces: (r.workspaces as Row[]).map((w) => `${w.name} (${w.role})`).join("; ") })), error: null };
      });
      return {
        columns: [{ key: "id", label: "User ID" }, { key: "full_name", label: "Name" }, { key: "email", label: "Email" }, { key: "email_confirmed", label: "Email confirmed" },
          { key: "created_at", label: "Signed up" }, { key: "last_sign_in_at", label: "Last sign-in" }, { key: "workspaces", label: "Businesses (role)" }, { key: "admin_role", label: "Staff role" }],
        rows,
      };
    }
    case "businesses": {
      const rows = await collect(async (from) => {
        const page = await rpc<{ rows: Row[] }>(caller, "admin_workspaces_page", { p_search: str(body.search), p_filter: str(body.filter) || "all", p_limit: 100, p_offset: from });
        return {
          data: page.rows.map((r) => ({
            ...r, owner_email: r.owner?.email ?? "", plan_codes: (r.plan_codes ?? []).join("; "),
            revenue: (r.revenue as Row[]).map((x) => `${x.currency} ${(Number(x.gross_minor) / 100).toFixed(2)}`).join("; "),
          })),
          error: null,
        };
      });
      return {
        columns: [{ key: "id", label: "Business ID" }, { key: "name", label: "Name" }, { key: "owner_email", label: "Owner email" }, { key: "status", label: "Status" },
          { key: "plan_codes", label: "Plans" }, { key: "paying", label: "Paying" }, { key: "members", label: "Members" }, { key: "country_code", label: "Country" },
          { key: "revenue", label: "Lifetime revenue" }, { key: "created_at", label: "Created" }, { key: "last_activity_at", label: "Last activity" }],
        rows,
      };
    }
    case "transactions": {
      const raw = await collect((from, to) => transactionsQuery(caller, body, TXN_SELECT).range(from, to));
      return {
        columns: [{ key: "reference", label: "Reference" }, { key: "created_at", label: "Created" }, { key: "paid_at", label: "Paid at" }, { key: "workspace", label: "Business" },
          { key: "plan", label: "Plan" }, { key: "kind", label: "Type" }, { key: "status", label: "Status" }, { key: "currency", label: "Currency" },
          { key: "amount", label: "Amount" }, { key: "paid_currency", label: "Paid currency" }, { key: "paid_amount", label: "Paid amount" },
          { key: "provider", label: "Provider" }, { key: "verified_via", label: "Verified via" }, { key: "failure_reason", label: "Failure reason" }],
        rows: raw.map((t) => ({
          ...t, workspace: t.workspaces?.name ?? "", plan: t.billing_prices?.billing_plans?.name ?? "",
          amount: (Number(t.amount_minor) / 100).toFixed(2), paid_amount: t.paid_amount_minor == null ? "" : (Number(t.paid_amount_minor) / 100).toFixed(2),
        })),
      };
    }
    case "subscriptions": {
      const raw = await collect((from, to) => subscriptionsQuery(caller, body).range(from, to));
      return {
        columns: [{ key: "id", label: "Subscription ID" }, { key: "workspace", label: "Business" }, { key: "plan", label: "Plan" }, { key: "status", label: "Status" },
          { key: "currency", label: "Currency" }, { key: "amount", label: "Amount" }, { key: "interval", label: "Interval" }, { key: "created_at", label: "Started" },
          { key: "current_period_end", label: "Current period end" }, { key: "cancel_at_period_end", label: "Cancels at period end" }, { key: "cancelled_at", label: "Cancelled at" }],
        rows: raw.map((s) => ({
          ...s, workspace: s.workspaces?.name ?? "", plan: s.billing_plans?.name ?? "", currency: s.billing_prices?.currency ?? "",
          amount: s.billing_prices ? (Number(s.billing_prices.amount_minor) / 100).toFixed(2) : "", interval: s.billing_prices?.billing_interval ?? "",
        })),
      };
    }
    case "ai_usage": {
      const r = range(body);
      const raw = await collect((from, to) => caller.sb.from("ai_usage_events")
        .select("workspace_id, feature, model, status, total_tokens, estimated_cost, workspaces(name)")
        .gte("created_at", r.from).lt("created_at", r.to).order("created_at").range(from, to));
      const agg = new Map<string, Row>();
      for (const e of raw) {
        const key = `${e.workspace_id}|${e.feature}|${e.model}`;
        const cur = agg.get(key) ?? { workspace: e.workspaces?.name ?? e.workspace_id ?? "", feature: e.feature ?? "", model: e.model ?? "", calls: 0, failed: 0, tokens: 0, cost_usd: 0 };
        cur.calls += 1; if (e.status === "error") cur.failed += 1;
        cur.tokens += Number(e.total_tokens ?? 0); cur.cost_usd += Number(e.estimated_cost ?? 0);
        agg.set(key, cur);
      }
      return {
        columns: [{ key: "workspace", label: "Business" }, { key: "feature", label: "Feature" }, { key: "model", label: "Model" }, { key: "calls", label: "Requests" },
          { key: "failed", label: "Failed" }, { key: "tokens", label: "Tokens" }, { key: "cost_usd", label: "Estimated cost (USD)" }],
        rows: [...agg.values()].map((x) => ({ ...x, cost_usd: x.cost_usd.toFixed(4) })),
      };
    }
    case "audit": {
      const raw = await collect((from, to) => caller.sb.from("platform_admin_audit")
        .select("created_at, action, target_type, target_id, workspace_id, reason, profiles(full_name)").order("created_at", { ascending: false }).range(from, to));
      return {
        columns: [{ key: "created_at", label: "When" }, { key: "operator", label: "Staff member" }, { key: "action", label: "Action" }, { key: "target_type", label: "Target type" },
          { key: "target_id", label: "Target" }, { key: "workspace_id", label: "Business ID" }, { key: "reason", label: "Reason" }],
        rows: raw.map((a) => ({ ...a, operator: a.profiles?.full_name ?? "" })),
      };
    }
  }
}

async function handle(req: Request, caller: AdminCaller, action: string, body: Record<string, unknown>): Promise<Response> {
  switch (action) {
    case "me":
      return json(req, { ok: true, userId: caller.userId, role: caller.role, permissions: ROLE_PERMISSIONS[caller.role] });

    case "overview": {
      const r = range(body);
      return json(req, { ok: true, data: await rpc(caller, "admin_overview", { p_from: r.from, p_to: r.to }) });
    }

    case "attention": {
      const signals = await rpc<AttentionSignals>(caller, "admin_attention_signals");
      let alerts = buildAlerts(signals);
      // Roles without the business directory see the problem, not the customer.
      if (!can(caller.role, "businesses.read")) {
        alerts = alerts.map((a) => (a.workspace ? { ...a, workspace: null, href: a.href.startsWith("/admin/businesses/") ? "/admin/attention" : a.href } : a));
      }
      return json(req, { ok: true, alerts, generatedAt: new Date().toISOString() });
    }

    case "activity": {
      const limit = Math.min(Math.max(Number(body.limit) || 30, 1), 100);
      const rows = await rpc<Row[]>(caller, "admin_activity_feed", { p_limit: limit });
      // Customer names are personal data: only roles with users.read see them.
      const showPeople = can(caller.role, "users.read");
      const showBusinesses = can(caller.role, "businesses.read");
      return json(req, {
        ok: true,
        rows: rows.map((r) => {
          let out = r.kind === "user_signed_up" && !showPeople ? { ...r, label: "", user_id: null } : r;
          if (!showBusinesses) out = { ...out, workspace_id: null, workspace_name: null, label: out.kind === "workspace_created" ? "" : out.label };
          return out;
        }),
      });
    }

    case "search": {
      const results = await rpc<Record<string, Row[]>>(caller, "admin_search", { p_q: str(body.q, 100) });
      return json(req, {
        ok: true,
        users: can(caller.role, "users.read") ? results.users : [],
        workspaces: can(caller.role, "businesses.read") ? results.workspaces : [],
        transactions: can(caller.role, "billing.read") ? results.transactions : [],
        subscriptions: can(caller.role, "billing.read") ? results.subscriptions : [],
      });
    }

    case "users": {
      const p = paging(body);
      const data = await rpc<Row>(caller, "admin_users_page", { p_search: str(body.search), p_filter: str(body.filter, 30) || "all", p_limit: p.pageSize, p_offset: p.offset });
      return json(req, { ok: true, ...data, page: p.page, pageSize: p.pageSize });
    }

    case "user": {
      if (!isUuid(body.id)) throw new BadRequest("Invalid user id");
      const data = await rpc<Row | null>(caller, "admin_user_detail", { p_user_id: body.id });
      if (!data) return json(req, { error: "User not found" }, 404);
      return json(req, { ok: true, data });
    }

    case "businesses": {
      const p = paging(body);
      const data = await rpc<Row>(caller, "admin_workspaces_page", { p_search: str(body.search), p_filter: str(body.filter, 30) || "all", p_limit: p.pageSize, p_offset: p.offset });
      return json(req, { ok: true, ...data, page: p.page, pageSize: p.pageSize });
    }

    case "business": {
      if (!isUuid(body.id)) throw new BadRequest("Invalid business id");
      const data = await rpc<Row | null>(caller, "admin_workspace_detail", { p_workspace_id: body.id });
      if (!data) return json(req, { error: "Business not found" }, 404);
      // Billing detail needs billing.read; member emails need users.read.
      if (!can(caller.role, "billing.read")) {
        data.subscriptions = []; data.purchases = []; data.transactions = []; data.billing_hidden = true;
      }
      if (!can(caller.role, "users.read")) {
        data.members = (data.members as Row[]).map((m) => ({ ...m, email: null }));
      }
      return json(req, { ok: true, data });
    }

    case "revenue": {
      const r = range(body);
      return json(req, { ok: true, data: await rpc(caller, "admin_revenue", { p_from: r.from, p_to: r.to }) });
    }

    case "transactions": {
      const p = paging(body);
      if (body.view === "webhooks") {
        let q = caller.sb.from("billing_webhook_events")
          .select("id, provider, event_type, signature_valid, processing_status, processing_result, received_at, processed_at, workspace_id, workspaces(name)", { count: "exact" });
        const st = oneOf(body.status, ["received", "processed", "ignored", "failed"] as const);
        if (st) q = q.eq("processing_status", st);
        const { data, count, error } = await q.order("received_at", { ascending: false }).range(p.offset, p.offset + p.pageSize - 1);
        if (error) throw new Error(error.message);
        return json(req, { ok: true, rows: data ?? [], total: count ?? 0, page: p.page, pageSize: p.pageSize });
      }
      const { data, count, error } = await transactionsQuery(caller, body, TXN_SELECT, { count: "exact" }).range(p.offset, p.offset + p.pageSize - 1);
      if (error) throw new Error(error.message);
      return json(req, { ok: true, rows: data ?? [], total: count ?? 0, page: p.page, pageSize: p.pageSize });
    }

    case "subscriptions": {
      const p = paging(body);
      const { data, count, error } = await subscriptionsQuery(caller, body, { count: "exact" }).range(p.offset, p.offset + p.pageSize - 1);
      if (error) throw new Error(error.message);
      return json(req, { ok: true, rows: data ?? [], total: count ?? 0, page: p.page, pageSize: p.pageSize });
    }

    case "audit": {
      const p = paging(body);
      let q = caller.sb.from("platform_admin_audit")
        .select("id, action, target_type, target_id, workspace_id, reason, before_state, after_state, created_at, operator_user_id, profiles(full_name), workspaces(name)", { count: "exact" });
      const targetType = str(body.target_type, 60);
      if (targetType) q = q.eq("target_type", targetType);
      if (isUuid(body.operator_user_id)) q = q.eq("operator_user_id", body.operator_user_id);
      if (body.from || body.to) {
        const r = range(body);
        q = q.gte("created_at", r.from).lt("created_at", r.to);
      }
      const { data, count, error } = await q.order("created_at", { ascending: false }).range(p.offset, p.offset + p.pageSize - 1);
      if (error) throw new Error(error.message);
      return json(req, { ok: true, rows: data ?? [], total: count ?? 0, page: p.page, pageSize: p.pageSize });
    }

    case "staff": {
      const rows = await rpc<Row[]>(caller, "admin_staff");
      return json(req, { ok: true, rows, roles: ADMIN_ROLES.map((r) => ({ role: r, ...ROLE_LABELS[r], permissions: ROLE_PERMISSIONS[r] })) });
    }

    case "grant_role": {
      const email = str(body.email, 320);
      if (!email.includes("@")) throw new BadRequest("Enter the email address of an existing StabiFlow account");
      if (!isAdminRole(body.role)) throw new BadRequest("Choose a valid role");
      const reason = reasonOf(body.reason);
      if (!reason.ok) throw new BadRequest(reason.error);
      const userId = await rpc<string | null>(caller, "admin_find_user_by_email", { p_email: email });
      if (!userId) throw new BadRequest("No StabiFlow account uses that email. They must sign up first.");
      if (userId === caller.userId) throw new BadRequest("You cannot change your own role");
      const { data: before } = await caller.sb.from("platform_admin_roles").select("role").eq("user_id", userId).maybeSingle();
      const { error } = await caller.sb.from("platform_admin_roles").upsert({ user_id: userId, role: body.role, granted_by: caller.userId }, { onConflict: "user_id" });
      if (error) {
        if (/last owner/i.test(error.message)) throw new BadRequest("The last owner cannot be demoted");
        throw new Error(error.message);
      }
      await writeAdminAudit(caller.sb, { operator: caller.userId, action: before ? "change_admin_role" : "grant_admin_role", targetType: "admin_role", targetId: userId, reason: reason.value, before: before ?? null, after: { role: body.role } });
      return json(req, { ok: true });
    }

    case "revoke_role": {
      if (!isUuid(body.user_id)) throw new BadRequest("Invalid user id");
      if (body.user_id === caller.userId) throw new BadRequest("You cannot remove your own access");
      const reason = reasonOf(body.reason);
      if (!reason.ok) throw new BadRequest(reason.error);
      const { data: before } = await caller.sb.from("platform_admin_roles").select("role").eq("user_id", body.user_id).maybeSingle();
      if (!before) throw new BadRequest("That account has no staff role");
      const { error } = await caller.sb.from("platform_admin_roles").delete().eq("user_id", body.user_id);
      if (error) {
        if (/last owner/i.test(error.message)) throw new BadRequest("The last owner cannot be removed");
        throw new Error(error.message);
      }
      await writeAdminAudit(caller.sb, { operator: caller.userId, action: "revoke_admin_role", targetType: "admin_role", targetId: String(body.user_id), reason: reason.value, before });
      return json(req, { ok: true });
    }

    case "export": {
      if (!isExportDataset(body.dataset)) throw new BadRequest("Unknown dataset");
      const dataset = body.dataset;
      if (!permits(caller, EXPORT_DATASETS[dataset].permission)) return json(req, { error: "Forbidden" }, 403);
      const { columns, rows } = await exportRows(caller, dataset, body);
      const filters = Object.fromEntries(Object.entries(body).filter(([k]) => !["action", "dataset"].includes(k)));
      await writeAdminAudit(caller.sb, { operator: caller.userId, action: "export_data", targetType: "export", targetId: dataset, after: { rows: rows.length, filters } });
      return new Response(toCsv(columns, rows), {
        status: 200,
        headers: {
          ...corsHeaders(req),
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${exportFilename(dataset)}"`,
          "Access-Control-Expose-Headers": "Content-Disposition",
          "Cache-Control": "no-store",
        },
      });
    }

    default:
      return json(req, { error: "Unknown action" }, 400);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, {}, 200);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const auth = await resolveAdminCaller(req);
  if (!auth.ok) return json(req, { error: auth.error }, auth.status);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const action = typeof body.action === "string" ? body.action : "";
  if (!permits(auth.caller, ADMIN_CONSOLE_ACTIONS[action])) {
    return json(req, { error: ADMIN_CONSOLE_ACTIONS[action] ? "Your role does not allow this" : "Unknown action" }, ADMIN_CONSOLE_ACTIONS[action] ? 403 : 400);
  }

  try {
    return await handle(req, auth.caller, action, body);
  } catch (e) {
    if (e instanceof BadRequest) return json(req, { error: e.message }, 400);
    const ref = crypto.randomUUID().slice(0, 8);
    console.error("admin-console failed", ref, action, e instanceof Error ? e.message : e);
    return json(req, { error: "Something went wrong loading this data.", ref }, 500);
  }
});
