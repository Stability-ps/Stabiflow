// Phase 14 - server-side Inbox search / filter / keyset pagination.
//
// Exercises public.get_inbox_conversations against LOCAL Supabase with
// REAL RLS + the real permission gate. No provider calls anywhere.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";
import { seedWhatsAppSetup } from "./inboxHelpers";

const PAGE = 50;

type Row = {
  id: string;
  display_name: string | null;
  wa_id: string;
  phone_number: string;
  inbox_status: string;
  priority_level: string;
  assigned_staff_id: string | null;
  status: string;
  ai_enabled: boolean;
  updated_at: string;
  is_unread: boolean;
};

async function rpc(client: SupabaseClient, workspaceId: string, params: Record<string, unknown> = {}): Promise<Row[]> {
  const { data, error } = await client.rpc("get_inbox_conversations", {
    p_workspace_id: workspaceId,
    p_limit: PAGE,
    ...params,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

// Seed N conversations with strictly-decreasing updated_at (older as i grows),
// a few with a shared updated_at to exercise the id tie-breaker.
async function seedConversations(workspaceId: string, numberId: string, n: number, opts: { sharedTs?: number } = {}) {
  const base = Date.UTC(2026, 5, 1, 12, 0, 0);
  const rows = Array.from({ length: n }, (_, i) => {
    const shared = opts.sharedTs && i < opts.sharedTs;
    return {
      workspace_id: workspaceId,
      whatsapp_number_id: numberId,
      wa_id: `2782${String(1_000_000 + i).slice(1)}`,
      phone_number: `+2782${String(1_000_000 + i).slice(1)}`,
      display_name: `Person ${String(i).padStart(4, "0")}`,
      inbox_status: ["new", "unassigned", "assigned", "waiting_client", "resolved"][i % 5],
      priority_level: ["normal", "high", "urgent"][i % 3],
      status: i % 7 === 0 ? "human_handoff" : "active",
      ai_enabled: i % 7 !== 0,
      last_inbound_at: new Date(base - i * 1000).toISOString(),
      updated_at: new Date(shared ? base : base - i * 60_000).toISOString(),
    };
  });
  // chunked insert
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("inbox_conversations").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`seed conversations: ${error.message}`);
  }
}

describe("Phase 14 - get_inbox_conversations", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let numberId: string;

  beforeAll(async () => {
    ws = await createTestTenant("inbox-search");
    other = await createTestTenant("inbox-search-other");
    numberId = (await seedWhatsAppSetup(ws.workspaceId)).id;
    await seedWhatsAppSetup(other.workspaceId);
    await seedConversations(ws.workspaceId, numberId, 230, { sharedTs: 4 }); // >200 so the old client cap is beaten
  });
  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
  });

  // --- pagination ------------------------------------------------------
  it("first page returns exactly the page size, ordered updated_at DESC then id DESC", async () => {
    const p1 = await rpc(ws.client, ws.workspaceId);
    expect(p1).toHaveLength(PAGE);
    for (let i = 1; i < p1.length; i++) {
      const a = p1[i - 1], b = p1[i];
      const at = new Date(a.updated_at).getTime(), bt = new Date(b.updated_at).getTime();
      expect(at >= bt).toBe(true);
      if (at === bt) expect(a.id > b.id).toBe(true); // deterministic tie-break on id DESC
    }
  });

  it("keyset pages cover every conversation with no duplicate ids and no OFFSET", async () => {
    const seen = new Set<string>();
    let cursor: { updated_at: string; id: string } | null = null;
    let pages = 0;
    for (;;) {
      const page: Row[] = await rpc(ws.client, ws.workspaceId, {
        p_cursor_updated_at: cursor?.updated_at ?? undefined,
        p_cursor_id: cursor?.id ?? undefined,
      });
      pages++;
      for (const r of page) {
        expect(seen.has(r.id)).toBe(false); // no duplicate traversal
        seen.add(r.id);
      }
      if (page.length < PAGE) break;
      const last = page[page.length - 1];
      cursor = { updated_at: last.updated_at, id: last.id };
      if (pages > 20) throw new Error("pagination did not terminate");
    }
    expect(seen.size).toBe(230);
    expect(pages).toBe(5); // 50,50,50,50,30
  });

  it("has_more is inferable from a full page; the final short page ends traversal", async () => {
    const p1 = await rpc(ws.client, ws.workspaceId);
    expect(p1.length === PAGE).toBe(true); // client reads this as hasNextPage
  });

  // --- search --------------------------------------------------------
  it("finds a conversation by display_name, case-insensitively, even beyond the old 200-row window", async () => {
    // Person 0225 sits well past row 200 in updated_at order.
    const byName = await rpc(ws.client, ws.workspaceId, { p_search: "person 0225" });
    expect(byName).toHaveLength(1);
    expect(byName[0].display_name).toBe("Person 0225");
  });

  it("finds a conversation by exact wa_id and by phone number", async () => {
    const target = (await admin.from("inbox_conversations").select("wa_id, phone_number").eq("workspace_id", ws.workspaceId).eq("display_name", "Person 0100").single()).data!;
    expect((await rpc(ws.client, ws.workspaceId, { p_search: target.wa_id }))[0].display_name).toBe("Person 0100");
    expect((await rpc(ws.client, ws.workspaceId, { p_search: target.phone_number }))[0].display_name).toBe("Person 0100");
  });

  it("phone search accepts a local (leading-0) form of an international-format number", async () => {
    // stored wa_id 2782xxxxxxx -> operator types 082xxxxxxx
    const target = (await admin.from("inbox_conversations").select("wa_id").eq("workspace_id", ws.workspaceId).eq("display_name", "Person 0100").single()).data!;
    const local = "0" + target.wa_id.slice(2); // drop '27', prefix '0'
    const hit = await rpc(ws.client, ws.workspaceId, { p_search: local });
    expect(hit.some((r) => r.display_name === "Person 0100")).toBe(true);
  });

  it("search is workspace-scoped - a term that exists in workspace B returns nothing for workspace B's own caller-less lookup from A", async () => {
    await seedConversations(other.workspaceId, (await admin.from("workspace_whatsapp_numbers").select("id").eq("workspace_id", other.workspaceId).limit(1).single()).data!.id, 1);
    const fromA = await rpc(ws.client, other.workspaceId, { p_search: "Person 0000" });
    expect(fromA).toEqual([]); // A is not a member of B
  });

  // --- filters ------------------------------------------------------
  it("filters compose in one query (inbox_status + priority + unread)", async () => {
    const rows = await rpc(ws.client, ws.workspaceId, {
      p_inbox_status: "unassigned",
      p_priority: "high",
      p_unread_only: true,
      p_limit: 100,
    });
    for (const r of rows) {
      expect(r.inbox_status).toBe("unassigned");
      expect(r.priority_level).toBe("high");
      expect(r.is_unread).toBe(true);
    }
    expect(rows.length).toBeGreaterThan(0);
  });

  it("assignment filter: unassigned vs specific staff", async () => {
    const staff = await createTestUser("inbox-search-staff");
    await seedMembership(ws.workspaceId, staff.userId, "support");
    const first = (await rpc(ws.client, ws.workspaceId))[0];
    await admin.from("inbox_conversations").update({ assigned_staff_id: staff.userId, assigned_staff_name: "Staffer" }).eq("id", first.id);

    const mine = await rpc(ws.client, ws.workspaceId, { p_assignment: "staff", p_assigned_staff_id: staff.userId, p_limit: 100 });
    expect(mine.every((r) => r.assigned_staff_id === staff.userId)).toBe(true);
    expect(mine.some((r) => r.id === first.id)).toBe(true);

    const unassigned = await rpc(ws.client, ws.workspaceId, { p_assignment: "unassigned", p_limit: 100 });
    expect(unassigned.every((r) => r.assigned_staff_id === null)).toBe(true);
    expect(unassigned.some((r) => r.id === first.id)).toBe(false);

    // 'staff' with no id selects nothing (never silently degrades)
    expect(await rpc(ws.client, ws.workspaceId, { p_assignment: "staff" })).toEqual([]);
  });

  it("handling filter maps AI-active vs human-attention onto authoritative state", async () => {
    const ai = await rpc(ws.client, ws.workspaceId, { p_handling: "ai_active", p_limit: 100 });
    expect(ai.every((r) => r.ai_enabled === true && r.status !== "human_handoff")).toBe(true);
    const human = await rpc(ws.client, ws.workspaceId, { p_handling: "human_attention", p_limit: 100 });
    expect(human.every((r) => r.status === "human_handoff" || r.ai_enabled === false)).toBe(true);
  });

  it("an unrecognised filter value is treated as no filter (not an error)", async () => {
    const rows = await rpc(ws.client, ws.workspaceId, { p_priority: "super-urgent", p_inbox_status: "bogus" });
    expect(rows).toHaveLength(PAGE);
  });

  it("p_limit is clamped to [1,100]", async () => {
    expect(await rpc(ws.client, ws.workspaceId, { p_limit: 0 })).toHaveLength(1);
    expect((await rpc(ws.client, ws.workspaceId, { p_limit: 99999 })).length).toBe(100);
  });

  // --- permissions / tenancy -------------------------------------
  it("owner and a support member (inbox.view) both get rows; a marketing member (no inbox.view) gets none", async () => {
    expect((await rpc(ws.client, ws.workspaceId)).length).toBe(PAGE);

    const support = await createTestUser("inbox-search-support");
    await seedMembership(ws.workspaceId, support.userId, "support");
    expect((await rpc(support.client, ws.workspaceId)).length).toBe(PAGE);

    const marketing = await createTestUser("inbox-search-marketing");
    await seedMembership(ws.workspaceId, marketing.userId, "marketing");
    expect(await rpc(marketing.client, ws.workspaceId)).toEqual([]);
  });

  it("cross-workspace: workspace A caller cannot list / search / filter workspace B", async () => {
    expect(await rpc(ws.client, other.workspaceId)).toEqual([]);
    expect(await rpc(ws.client, other.workspaceId, { p_search: "Person 0000", p_inbox_status: "unassigned" })).toEqual([]);
  });

  // --- read-state privacy --------------------------------------
  it("is_unread is per-caller - one staff marking read does not clear another staff's unread", async () => {
    const a = await createTestUser("inbox-unread-a");
    const b = await createTestUser("inbox-unread-b");
    await seedMembership(ws.workspaceId, a.userId, "support");
    await seedMembership(ws.workspaceId, b.userId, "support");
    const convId = (await rpc(a.client, ws.workspaceId))[0].id;

    // A marks it read (own row only, per the reads-table RLS)
    const { error } = await a.client.from("inbox_conversation_reads").upsert({ conversation_id: convId, staff_id: a.userId, last_read_at: new Date().toISOString() });
    expect(error).toBeNull();

    const aRow = (await rpc(a.client, ws.workspaceId)).find((r) => r.id === convId)!;
    const bRow = (await rpc(b.client, ws.workspaceId)).find((r) => r.id === convId)!;
    expect(aRow.is_unread).toBe(false);
    expect(bRow.is_unread).toBe(true);
  });
});
