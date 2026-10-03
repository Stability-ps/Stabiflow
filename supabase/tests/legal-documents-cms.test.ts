// Pages & Legal - versioned legal documents, publishing and re-consent.
// LOCAL-Supabase integration tests (real RLS + functions).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, ANON_KEY, cleanupTenant, createTestTenant, SUPABASE_URL, type TestTenant } from "./helpers";

const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const stamp = Date.now();

async function draft(type: string, version: string, body = "## Terms\nThese are the terms of the service for testing.") {
  const { data, error } = await admin
    .from("legal_documents")
    .insert({ document_type: type, version, title: "Test document", body, effective_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}

describe("Legal documents - drafts, publishing, history, re-consent", () => {
  let U: TestTenant;
  let originalTerms: { current_version: string; effective_at: string } | null = null;

  beforeAll(async () => {
    U = await createTestTenant("legal-cms");
    const { data } = await admin.from("legal_document_versions").select("current_version, effective_at").eq("document_type", "terms_of_service").single();
    originalTerms = data;
  });

  afterAll(async () => {
    await admin.from("legal_documents").delete().like("version", `t${stamp}%`);
    if (originalTerms) await admin.from("legal_document_versions").update(originalTerms).eq("document_type", "terms_of_service");
    await admin.from("legal_acceptances").delete().eq("user_id", U.userId);
    await cleanupTenant(U);
  });

  it("drafts are invisible to the public; clients cannot write documents or publish", async () => {
    const id = await draft("refund_policy", `t${stamp}-r1`);
    const { data } = await anon.from("legal_documents").select("id").eq("id", id);
    expect(data).toEqual([]);
    const { error: ins } = await U.client.from("legal_documents").insert({ document_type: "refund_policy", version: "x", title: "x", body: "x".repeat(30), effective_at: new Date().toISOString() });
    expect(ins).not.toBeNull();
    const { error: pub } = await U.client.rpc("publish_legal_document", { p_document_id: id, p_operator_id: U.userId });
    expect(pub).not.toBeNull();
    const { error: stats } = await U.client.rpc("legal_acceptance_stats");
    expect(stats).not.toBeNull();
  });

  it("publishing makes a version public, supersedes the previous one and freezes its text", async () => {
    const v1 = await draft("refund_policy", `t${stamp}-r2`);
    expect((await admin.rpc("publish_legal_document", { p_document_id: v1, p_operator_id: null })).data).toBe("published");
    const v2 = await draft("refund_policy", `t${stamp}-r3`);
    expect((await admin.rpc("publish_legal_document", { p_document_id: v2, p_operator_id: null })).data).toBe("published");

    const { data: pub } = await anon.from("legal_documents").select("version, status").eq("document_type", "refund_policy").in("status", ["published", "superseded"]).like("version", `t${stamp}%`).order("version");
    expect(pub).toEqual([
      { version: `t${stamp}-r2`, status: "superseded" },
      { version: `t${stamp}-r3`, status: "published" },
    ]);
    const { error } = await admin.from("legal_documents").update({ body: "changed after publishing".repeat(2) }).eq("id", v2);
    expect(error).not.toBeNull();
    expect((await admin.rpc("publish_legal_document", { p_document_id: v2, p_operator_id: null })).data).toBe("already_published");
  });

  it("publishing new Terms moves the acceptance pointer and asks earlier acceptors to re-consent", async () => {
    // User accepted the current (original) versions at signup.
    await U.client.rpc("accept_current_legal_terms");
    expect((await U.client.rpc("my_legal_acceptance_status")).data).toBe("current");

    const t = await draft("terms_of_service", `t${stamp}-terms`);
    await admin.rpc("publish_legal_document", { p_document_id: t, p_operator_id: null });
    const { data: cur } = await anon.rpc("current_legal_versions");
    expect((cur as { document_type: string; current_version: string }[]).find((r) => r.document_type === "terms_of_service")?.current_version).toBe(`t${stamp}-terms`);

    expect((await U.client.rpc("my_legal_acceptance_status")).data).toBe("outdated");
    expect((await U.client.rpc("reaccept_current_legal_terms")).data).toBe("accepted");
    expect((await U.client.rpc("my_legal_acceptance_status")).data).toBe("current");
    const { data: rows } = await U.client.from("legal_acceptances").select("document_version, source").eq("document_type", "terms_of_service").order("accepted_at");
    expect(rows?.at(-1)).toEqual({ document_version: `t${stamp}-terms`, source: "reconsent" });
  });

  it("anonymous users cannot call re-consent", async () => {
    const { error } = await anon.rpc("reaccept_current_legal_terms");
    expect(error).not.toBeNull();
  });
});
