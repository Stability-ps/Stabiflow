// Flow AI usage/cost tracking (Phase I). Matches the shape already speced
// in docs/architecture/ai-architecture.md: token counts and metadata only,
// never raw prompt/response content, never the API key.
import type { AnySupabaseClient } from "../contentAuth.ts";

// Best-effort estimate only ("where reliably available" per the
// architecture doc) - never treated as billing-grade. A model missing
// from this table simply gets a null estimated_cost rather than a guess.
// Prices are USD per 1,000,000 tokens.
const MODEL_PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = MODEL_PRICING_PER_MILLION_TOKENS[model];
  if (!pricing) return null;
  return Number((((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1_000_000).toFixed(6));
}

export type QuotaCheckResult = { allowed: true } | { allowed: false; reason: string };

// Pure - given usage numbers already fetched, decides whether a new
// request may proceed. Never called with numbers the caller invented; see
// getWorkspaceTokenUsageSince/getPlatformTokenUsageSince below for how
// they're actually obtained.
export function checkWorkspaceQuota(usedTokensThisPeriod: number, limitTokens: number): QuotaCheckResult {
  if (usedTokensThisPeriod >= limitTokens) {
    return { allowed: false, reason: "This workspace has reached its Flow AI usage limit for this period. Please try again later or contact your workspace owner." };
  }
  return { allowed: true };
}

// The platform-wide emergency ceiling exists to stop a bug/loop/abusive
// workspace from creating uncontrolled OpenAI spend - it must never leak
// platform-wide usage numbers to a tenant, so the denial reason is
// deliberately generic and identical regardless of how close to the
// ceiling the platform actually is.
export function checkPlatformCeiling(usedTokensTodayPlatformWide: number, ceilingTokens: number): QuotaCheckResult {
  if (usedTokensTodayPlatformWide >= ceilingTokens) {
    return { allowed: false, reason: "Flow AI is temporarily unavailable. Please try again shortly." };
  }
  return { allowed: true };
}

export async function getWorkspaceTokenUsageSince(serviceClient: AnySupabaseClient, workspaceId: string, since: string): Promise<number> {
  const { data, error } = await serviceClient
    .from("ai_usage_events")
    .select("total_tokens")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since);
  if (error) throw new Error(`Failed to read workspace AI usage: ${error.message}`);
  return (data ?? []).reduce((sum: number, row: { total_tokens: number }) => sum + (row.total_tokens ?? 0), 0);
}

export async function getPlatformTokenUsageSince(serviceClient: AnySupabaseClient, since: string): Promise<number> {
  const { data, error } = await serviceClient
    .from("ai_usage_events")
    .select("total_tokens")
    .gte("created_at", since);
  if (error) throw new Error(`Failed to read platform AI usage: ${error.message}`);
  return (data ?? []).reduce((sum: number, row: { total_tokens: number }) => sum + (row.total_tokens ?? 0), 0);
}

export type UsageEventInput = {
  workspaceId: string;
  conversationId: string | null;
  userId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: "success" | "error" | "aborted" | "blocked_quota";
};

export async function recordUsageEvent(serviceClient: AnySupabaseClient, event: UsageEventInput): Promise<void> {
  const estimatedCost = estimateCost(event.model, event.inputTokens, event.outputTokens);
  const { error } = await serviceClient.from("ai_usage_events").insert({
    workspace_id: event.workspaceId,
    conversation_id: event.conversationId,
    user_id: event.userId,
    feature: "flow_ai_chat",
    provider: "openai",
    model: event.model,
    input_tokens: event.inputTokens,
    output_tokens: event.outputTokens,
    estimated_cost: estimatedCost,
    latency_ms: event.latencyMs,
    status: event.status,
  });
  // Usage logging must never fail the user's actual request - log and move on.
  if (error) console.error("flow-ai-chat: failed to record usage event", error.message);
}
