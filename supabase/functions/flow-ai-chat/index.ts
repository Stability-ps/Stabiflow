// Flow AI Gateway (Phase I, V1 = READ + RECOMMEND only). One endpoint,
// streaming Server-Sent-Events response - same "one dispatcher, one
// permission check, real audit trail" posture as every other module's
// edge function (leads-actions, inbox-actions, ad-campaigns-*), adapted
// for a streaming chat shape instead of a single JSON action.
//
// Workspace identity is NEVER accepted from the model, and is only
// accepted from the client for the one call that creates a brand-new
// conversation (verified against the caller's own membership before the
// row is created). Every subsequent message on that conversation resolves
// workspace_id from the ALREADY-STORED ai_conversations row, never from a
// client-supplied value again - so neither a compromised client nor a
// manipulated model turn can redirect an existing thread to another
// workspace.
import {
  bearerToken, corsHeaders, createCallerClient, createServiceClient, envVar, getCallerUserId, hasWorkspacePermission,
} from "../_shared/contentAuth.ts";
import { FLOW_AI_TOOLS, ToolArgumentError, dispatchTool, isKnownTool } from "../_shared/flowAi/tools.ts";
import { buildFlowAiSystemPrompt } from "../_shared/flowAi/systemPrompt.ts";
import {
  MAX_LOOP_ITERATIONS, MAX_USER_MESSAGE_CHARS, ToolCallGuard, quarantineToolResult, stableStringify, truncateHistory, validateToolArgs,
} from "../_shared/flowAi/guardrails.ts";
import { type FlowAiInputItem, streamFlowAiResponse } from "../_shared/flowAi/openaiClient.ts";
import {
  checkPlatformCeiling, checkWorkspaceQuota, getPlatformTokenUsageSince, getWorkspaceTokenUsageSince, recordUsageEvent,
} from "../_shared/flowAi/usage.ts";

const DEFAULT_WORKSPACE_MONTHLY_TOKEN_LIMIT_FALLBACK = 500_000;

type StoredMessage = { role: "user" | "assistant" | "tool"; content: string | null; tool_name: string | null; tool_call_id: string | null; tool_args: Record<string, unknown> | null };

function startOfMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function startOfDayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function toInputItems(messages: StoredMessage[]): FlowAiInputItem[] {
  const items: FlowAiInputItem[] = [];
  for (const m of messages) {
    if (m.role === "user" && m.content) {
      items.push({ role: "user", content: [{ type: "input_text", text: m.content }] });
    } else if (m.role === "assistant" && m.tool_call_id && m.tool_name) {
      items.push({ type: "function_call", call_id: m.tool_call_id, name: m.tool_name, arguments: JSON.stringify(m.tool_args ?? {}) });
    } else if (m.role === "assistant" && m.content) {
      items.push({ role: "assistant", content: [{ type: "output_text", text: m.content }] });
    } else if (m.role === "tool" && m.tool_call_id) {
      items.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content ?? "" });
    }
  }
  return items;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders(req) });

  const token = bearerToken(req);
  if (!token) return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });

  const callerClient = createCallerClient(token);
  const serviceClient = createServiceClient();
  const userId = await getCallerUserId(callerClient);
  if (!userId) return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });

  let body: { conversationId?: string; workspaceId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_USER_MESSAGE_CHARS) {
    return new Response(JSON.stringify({ error: `message must be 1-${MAX_USER_MESSAGE_CHARS} characters` }), { status: 400, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
  }

  // --- Resolve (or create) the conversation, and with it, the ONLY
  // workspace_id this request will ever use. ---------------------------------
  let conversationId: string;
  let workspaceId: string;
  let isNewConversation = false;

  if (body.conversationId) {
    const { data: existing, error } = await callerClient.from("ai_conversations").select("id, workspace_id").eq("id", body.conversationId).maybeSingle();
    if (error || !existing) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), { status: 404, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
    }
    conversationId = existing.id;
    workspaceId = existing.workspace_id;
  } else {
    if (!body.workspaceId) {
      return new Response(JSON.stringify({ error: "workspaceId is required to start a new conversation" }), { status: 400, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
    }
    workspaceId = body.workspaceId;
    const { data: created, error } = await callerClient
      .from("ai_conversations")
      .insert({ workspace_id: workspaceId, created_by: userId, title: message.slice(0, 60) })
      .select("id")
      .single();
    if (error || !created) {
      return new Response(JSON.stringify({ error: "Not authorized to start a Flow AI conversation in this workspace" }), { status: 403, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
    }
    conversationId = created.id;
    isNewConversation = true;
  }

  // Re-checked on every message, not just at conversation creation - a
  // permission revoked mid-thread must take effect immediately.
  if (!(await hasWorkspacePermission(callerClient, workspaceId, "flow_ai.use"))) {
    return new Response(JSON.stringify({ error: "Not authorized to use Flow AI in this workspace" }), { status: 403, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
  }

  const model = envVar("OPENAI_FLOW_AI_MODEL");
  const apiKey = envVar("OPENAI_API_KEY");

  // --- Quota checks (workspace, then platform-wide emergency ceiling) -------
  const { data: billing } = await serviceClient.from("workspace_billing").select("limits").eq("workspace_id", workspaceId).maybeSingle();
  const workspaceLimit = Number((billing?.limits as Record<string, unknown> | null)?.flow_ai_monthly_token_limit)
    || Number(Deno.env.get("FLOW_AI_DEFAULT_WORKSPACE_MONTHLY_TOKEN_LIMIT")?.trim())
    || DEFAULT_WORKSPACE_MONTHLY_TOKEN_LIMIT_FALLBACK;
  const workspaceUsed = await getWorkspaceTokenUsageSince(serviceClient, workspaceId, startOfMonthIso());
  const workspaceQuota = checkWorkspaceQuota(workspaceUsed, workspaceLimit);
  if (!workspaceQuota.allowed) {
    await recordUsageEvent(serviceClient, { workspaceId, conversationId, userId, model, inputTokens: 0, outputTokens: 0, latencyMs: 0, status: "blocked_quota" });
    return new Response(JSON.stringify({ error: workspaceQuota.reason, conversationId }), { status: 429, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
  }

  const platformCeiling = Number(Deno.env.get("FLOW_AI_PLATFORM_DAILY_TOKEN_CEILING")?.trim());
  if (Number.isFinite(platformCeiling) && platformCeiling > 0) {
    const platformUsed = await getPlatformTokenUsageSince(serviceClient, startOfDayIso());
    const platformCheck = checkPlatformCeiling(platformUsed, platformCeiling);
    if (!platformCheck.allowed) {
      await recordUsageEvent(serviceClient, { workspaceId, conversationId, userId, model, inputTokens: 0, outputTokens: 0, latencyMs: 0, status: "blocked_quota" });
      // Deliberately the SAME generic message regardless of workspace - never
      // leaks platform-wide usage numbers to a tenant.
      return new Response(JSON.stringify({ error: platformCheck.reason, conversationId }), { status: 503, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
    }
  }

  // --- Load workspace name (for the system prompt) and prior history --------
  const { data: workspace } = await serviceClient.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
  const { data: priorRows } = await serviceClient
    .from("ai_messages")
    .select("role, content, tool_name, tool_call_id, tool_args")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  await serviceClient.from("ai_messages").insert({ workspace_id: workspaceId, conversation_id: conversationId, role: "user", content: message });

  const history = truncateHistory((priorRows ?? []) as StoredMessage[]);
  const inputItems: FlowAiInputItem[] = [...toInputItems(history), { role: "user", content: [{ type: "input_text", text: message }] }];
  const instructions = buildFlowAiSystemPrompt(workspace?.name ?? "your workspace", new Date());

  const abortController = new AbortController();
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      send({ type: "conversation_id", id: conversationId, isNew: isNewConversation });

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let finalText = "";
      let status: "success" | "error" | "aborted" = "success";
      const guard = new ToolCallGuard();

      try {
        for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
          let completed: Awaited<ReturnType<typeof runOneTurn>> | null = null;
          try {
            completed = await runOneTurn({ apiKey, model, instructions, inputItems, tools: FLOW_AI_TOOLS, signal: abortController.signal, onTextDelta: (t) => send({ type: "text_delta", text: t }) });
          } catch (err) {
            send({ type: "error", message: "Flow AI encountered an error. Please try again." });
            console.error("flow-ai-chat: stream error", err instanceof Error ? err.message : String(err));
            status = "error";
            break;
          }
          totalInputTokens += completed.inputTokens;
          totalOutputTokens += completed.outputTokens;

          if (completed.functionCalls.length === 0) {
            finalText = completed.text;
            await serviceClient.from("ai_messages").insert({ workspace_id: workspaceId, conversation_id: conversationId, role: "assistant", content: finalText });
            break;
          }

          for (const call of completed.functionCalls) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
            } catch {
              parsedArgs = {};
            }

            const toolDef = FLOW_AI_TOOLS.find((t) => t.name === call.name);
            let output: string;
            if (!isKnownTool(call.name) || !toolDef) {
              output = quarantineToolResult({ error: `Unknown tool: ${call.name}` });
            } else {
              const guardResult = guard.check(call.name, parsedArgs);
              if (!guardResult.allowed) {
                output = quarantineToolResult({ error: guardResult.reason });
              } else {
                const validation = validateToolArgs(toolDef.parameters, parsedArgs);
                if (!validation.valid) {
                  output = quarantineToolResult({ error: `Invalid arguments: ${validation.errors.join("; ")}` });
                } else {
                  try {
                    const result = await dispatchTool(callerClient, workspaceId, call.name, validation.value);
                    output = quarantineToolResult(result);
                  } catch (err) {
                    const safeMessage = err instanceof ToolArgumentError ? err.message : "This tool is temporarily unavailable.";
                    output = quarantineToolResult({ error: safeMessage });
                    console.error("flow-ai-chat: tool dispatch failed", call.name, err instanceof Error ? err.message : String(err));
                  }
                }
              }
            }

            inputItems.push({ type: "function_call", call_id: call.callId, name: call.name, arguments: stableStringify(parsedArgs) });
            inputItems.push({ type: "function_call_output", call_id: call.callId, output });
            await serviceClient.from("ai_messages").insert([
              { workspace_id: workspaceId, conversation_id: conversationId, role: "assistant", content: null, tool_name: call.name, tool_call_id: call.callId, tool_args: parsedArgs },
              { workspace_id: workspaceId, conversation_id: conversationId, role: "tool", content: output, tool_call_id: call.callId },
            ]);
          }

          if (iteration === MAX_LOOP_ITERATIONS - 1) {
            finalText = "I wasn't able to finish that within the allowed number of steps - please try a more specific question.";
            send({ type: "text_delta", text: finalText });
            await serviceClient.from("ai_messages").insert({ workspace_id: workspaceId, conversation_id: conversationId, role: "assistant", content: finalText });
            status = "error";
          }
        }
      } catch (err) {
        status = abortController.signal.aborted ? "aborted" : "error";
        console.error("flow-ai-chat: unexpected failure", err instanceof Error ? err.message : String(err));
      }

      await recordUsageEvent(serviceClient, {
        workspaceId, conversationId, userId, model, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, latencyMs: Date.now() - startedAt, status,
      });
      send({ type: "done" });
      controller.close();
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders(req), "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" },
  });
});

async function runOneTurn(opts: {
  apiKey: string; model: string; instructions: string; inputItems: FlowAiInputItem[]; tools: typeof FLOW_AI_TOOLS; signal: AbortSignal; onTextDelta: (text: string) => void;
}) {
  let finalResult: { text: string; functionCalls: { callId: string; name: string; arguments: string }[]; inputTokens: number; outputTokens: number } | null = null;
  for await (const event of streamFlowAiResponse({ apiKey: opts.apiKey, model: opts.model, instructions: opts.instructions, input: opts.inputItems, tools: opts.tools, signal: opts.signal })) {
    if (event.type === "text_delta") opts.onTextDelta(event.text);
    else if (event.type === "completed") finalResult = event.result;
    else if (event.type === "error") throw new Error(event.message);
  }
  if (!finalResult) throw new Error("OpenAI stream ended without a completed response");
  return finalResult;
}
