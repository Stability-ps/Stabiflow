// Launch readiness - durable Privacy/Terms acceptance tracking.
//
// Proves, against LOCAL Supabase with REAL RLS/grants:
//   * legal_document_versions is seeded with the versions currently live
//     on the legal pages, and is not directly readable by any client role
//   * accept_current_legal_terms() records the CALLING user (never a
//     client-supplied id) against the CURRENT versions (never client-
//     supplied - the RPC takes no arguments at all) with a server
//     timestamp, atomically for both documents, idempotently on replay
//   * legal_acceptances is otherwise append-only: no client role can
//     INSERT/UPDATE/DELETE it directly, and RLS SELECT is own-rows-only
//   * a workspace_id an acceptance row happens to carry is set NULL (not
//     cascaded away) when that workspace is deleted - deleting a
//     workspace must never delete a user's acceptance evidence
// No real WhatsApp/Meta/OpenAI call - this feature makes none.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, ANON_KEY, createTestTenant, createTestUser, cleanupTenant, SUPABASE_URL, type TestTenant } from "./helpers";

type Acceptance = { id: string; user_id: string; workspace_id: string | null; document_type: string; document_version: string; accepted_at: string; source: string };

async function ownRows(userId: string) {
  const { data, error } = await admin.from("legal_acceptances").select("*").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Acceptance[];
}

describe("legal_document_versions", () => {
  it("is seeded with the versions currently live on the legal pages, and is not directly readable by any client role", async () => {
    const { data, error } = await admin.from("legal_document_versions").select("document_type, current_version").order("document_type");
    if (error) throw new Error(error.message);
    expect(data).toEqual([
      { document_type: "privacy_policy", current_version: "2026-09-04" },
      { document_type: "terms_of_service", current_version: "2026-08-28" },
    ]);

    const { userId, client } = await createTestUser("legal-doc-versions");
    const direct = await client.from("legal_document_versions").select("*");
    expect(direct.error).toBeTruthy();
    void userId;
  });
});

describe("accept_current_legal_terms()", () => {
  it("records exactly one row per document for the calling user, matching current versions, with a server timestamp", async () => {
    const { userId, client } = await createTestUser("legal-accept-basic");
    const before = Date.now();
    const { data, error } = await client.rpc("accept_current_legal_terms");
    if (error) throw new Error(error.message);
    expect(data).toHaveLength(2);

    const rows = await ownRows(userId);
    const privacy = rows.find((r) => r.document_type === "privacy_policy");
    const terms = rows.find((r) => r.document_type === "terms_of_service");
    expect(privacy?.document_version).toBe("2026-09-04");
    expect(terms?.document_version).toBe("2026-08-28");
    expect(privacy?.source).toBe("signup");
    expect(new Date(privacy!.accepted_at).getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(new Date(privacy!.accepted_at).getTime()).toBeLessThanOrEqual(Date.now() + 5000);
  });

  it("is idempotent on replay - still exactly one row per document, no duplicates", async () => {
    const { userId, client } = await createTestUser("legal-accept-replay");
    await client.rpc("accept_current_legal_terms");
    await client.rpc("accept_current_legal_terms");
    const { error } = await client.rpc("accept_current_legal_terms");
    if (error) throw new Error(error.message);

    const rows = await ownRows(userId);
    expect(rows.filter((r) => r.document_type === "privacy_policy")).toHaveLength(1);
    expect(rows.filter((r) => r.document_type === "terms_of_service")).toHaveLength(1);
  });

  it("records both documents atomically (a single successful call always yields both)", async () => {
    const { userId, client } = await createTestUser("legal-accept-atomic");
    const { error } = await client.rpc("accept_current_legal_terms");
    if (error) throw new Error(error.message);
    const rows = await ownRows(userId);
    expect(rows.map((r) => r.document_type).sort()).toEqual(["privacy_policy", "terms_of_service"]);
  });

  it("rejects an unauthenticated caller", async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error } = await anon.rpc("accept_current_legal_terms");
    expect(error).toBeTruthy();
  });

  it("takes no arguments - a caller cannot supply/forge a version or another user's id", async () => {
    const { client } = await createTestUser("legal-accept-noargs");
    // @ts-expect-error - deliberately calling with args the RPC does not accept, to prove PostgREST rejects it.
    const { error } = await client.rpc("accept_current_legal_terms", { p_privacy_version: "forged", p_user_id: "00000000-0000-0000-0000-000000000000" });
    expect(error).toBeTruthy();
  });
});

describe("legal_acceptances - RLS and write protection", () => {
  it("a user can read their own acceptance rows via the client but not another user's", async () => {
    const a = await createTestUser("legal-rls-a");
    const b = await createTestUser("legal-rls-b");
    await a.client.rpc("accept_current_legal_terms");

    const mine = await a.client.from("legal_acceptances").select("*");
    expect(mine.error).toBeNull();
    expect((mine.data ?? []).length).toBeGreaterThanOrEqual(2);
    expect((mine.data ?? []).every((r) => r.user_id === a.userId)).toBe(true);

    const theirs = await b.client.from("legal_acceptances").select("*").eq("user_id", a.userId);
    expect(theirs.error).toBeNull();
    expect(theirs.data).toEqual([]);
  });

  it("direct insert is denied - only accept_current_legal_terms() may write", async () => {
    const { client, userId } = await createTestUser("legal-rls-insert");
    const { error } = await client.from("legal_acceptances").insert({
      user_id: userId,
      document_type: "privacy_policy",
      document_version: "2026-09-04",
    });
    expect(error).toBeTruthy();
  });

  it("direct update is denied", async () => {
    const { client, userId } = await createTestUser("legal-rls-update");
    await client.rpc("accept_current_legal_terms");
    const { error } = await client
      .from("legal_acceptances")
      .update({ document_version: "9999-01-01" })
      .eq("user_id", userId)
      .eq("document_type", "privacy_policy");
    expect(error).toBeTruthy();
    const rows = await ownRows(userId);
    expect(rows.find((r) => r.document_type === "privacy_policy")?.document_version).toBe("2026-09-04");
  });

  it("direct delete is denied", async () => {
    const { client, userId } = await createTestUser("legal-rls-delete");
    await client.rpc("accept_current_legal_terms");
    const { error } = await client.from("legal_acceptances").delete().eq("user_id", userId);
    expect(error).toBeTruthy();
    const rows = await ownRows(userId);
    expect(rows).toHaveLength(2);
  });
});

describe("legal_acceptances vs. workspace/user lifecycle", () => {
  let ws: TestTenant;

  beforeAll(async () => {
    ws = await createTestTenant("legal-lifecycle");
  });
  afterAll(async () => {
    await cleanupTenant(ws);
  });

  it("deleting a workspace sets workspace_id NULL on any acceptance row that referenced it - never deletes the row", async () => {
    const { data: inserted, error: insertError } = await admin
      .from("legal_acceptances")
      .insert({ user_id: ws.userId, workspace_id: ws.workspaceId, document_type: "privacy_policy", document_version: "2026-09-04", source: "admin_import" })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);

    await admin.from("workspaces").delete().eq("id", ws.workspaceId);

    const { data: after, error } = await admin.from("legal_acceptances").select("id, workspace_id").eq("id", inserted!.id).maybeSingle();
    if (error) throw new Error(error.message);
    expect(after).toBeTruthy();
    expect(after!.workspace_id).toBeNull();
  });

  // legal_acceptances.user_id -> auth.users(id) ON DELETE CASCADE is
  // declared in the migration and is standard Postgres FK behaviour;
  // deliberately NOT exercised here by deleting a real auth user, since
  // every test identity in this suite is a shared pooled fixture (see
  // helpers.ts) reused across the whole run - deleting one would break
  // every other test that draws from the pool.
});
