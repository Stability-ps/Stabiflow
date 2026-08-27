// How an automation's deterministic action calls the SAME dispatcher
// edge functions (leads-actions, etc.) the UI already uses, with NO new
// privileged parallel write path.
//
// An automation run has no live user session to reuse. Rather than invent
// a service-role bypass inside those dispatchers (exactly what durable
// rule #9 forbids), this mints a REAL, short-lived access token for the
// automation's recorded creator, using ONLY the Admin API's
// generateLink()+the anon client's verifyOtp() - a documented Supabase
// pattern, not a custom auth mechanism. The resulting token is
// indistinguishable from one obtained through a normal sign-in: every
// downstream RLS policy and has_workspace_permission() check evaluates
// that person's CURRENT membership/role, faithfully, with zero
// special-casing. If they've been removed from the workspace or demoted
// since the automation was created, the very same dispatcher calls that
// would reject a browser request reject this one too.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { envVar, type AnySupabaseClient } from "../contentAuth.ts";

export async function mintUserAccessToken(adminClient: AnySupabaseClient, userId: string): Promise<string | null> {
  const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (userError || !email) {
    console.error("mintUserAccessToken: could not resolve email for user", userId, userError?.message);
    return null;
  }

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({ type: "magiclink", email });
  const hashedToken = linkData?.properties?.hashed_token;
  if (linkError || !hashedToken) {
    console.error("mintUserAccessToken: generateLink failed", linkError?.message);
    return null;
  }

  const anon = createClient(envVar("SUPABASE_URL"), envVar("SUPABASE_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sessionData, error: sessionError } = await anon.auth.verifyOtp({ token_hash: hashedToken, type: "magiclink" });
  if (sessionError || !sessionData?.session?.access_token) {
    console.error("mintUserAccessToken: verifyOtp failed", sessionError?.message);
    return null;
  }
  return sessionData.session.access_token;
}
