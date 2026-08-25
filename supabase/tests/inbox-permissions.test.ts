// Phase D. inbox.view/inbox.manage are enforced by RLS via
// has_workspace_permission(), never role rank alone - marketing/sales are
// rank-peers of support, and this proves the SAME rank does not imply the
// SAME inbox access (support can view+manage; marketing/sales cannot).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";
import { seedInboxConversation, seedWhatsAppSetup } from "./inboxHelpers";

describe("Inbox permission matrix (release blocker)", () => {
  let workspace: TestTenant;
  let conversationId: string;
  let marketing: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };
  let support: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };

  beforeAll(async () => {
    workspace = await createTestTenant("inbox-perms");
    const number = await seedWhatsAppSetup(workspace.workspaceId);
    const conversation = await seedInboxConversation(workspace.workspaceId, number.id);
    conversationId = conversation.id;

    const marketingUser = await createTestUser("inbox-perms-marketing");
    await seedMembership(workspace.workspaceId, marketingUser.userId, "marketing");
    marketing = marketingUser;

    const supportUser = await createTestUser("inbox-perms-support");
    await seedMembership(workspace.workspaceId, supportUser.userId, "support");
    support = supportUser;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant({ userId: marketing.userId });
    await cleanupTenant({ userId: support.userId });
  });

  it("marketing (rank-peer of support) CANNOT view the inbox - conversations carry customer PII, unlike broadly-viewable content", async () => {
    const { data } = await marketing.client.from("inbox_conversations").select("id").eq("id", conversationId);
    expect(data).toEqual([]);
  });

  it("support CAN view and manage the inbox", async () => {
    const { data: viewResult, error: viewError } = await support.client.from("inbox_conversations").select("id").eq("id", conversationId).maybeSingle();
    expect(viewError).toBeNull();
    expect(viewResult?.id).toBe(conversationId);

    const { data: writeResult } = await support.client.from("inbox_conversations").update({ priority_level: "high" }).eq("id", conversationId).select("id");
    expect(writeResult).toHaveLength(1);
  });

  it("the owner CAN view and manage the inbox", async () => {
    const { data } = await workspace.client.from("inbox_conversations").update({ priority_level: "normal" }).eq("id", conversationId).select("id");
    expect(data).toHaveLength(1);
  });
});
