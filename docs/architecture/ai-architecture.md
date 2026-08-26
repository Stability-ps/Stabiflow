# AI architecture

This is durable architectural direction, recorded before any of Flow AI or
the Automation Engine is built (both remain unimplemented - see
[`automation-architecture.md`](automation-architecture.md) for the
automation side). It exists so future phases build AI features consistent
with this shape rather than scattering ad-hoc OpenAI calls through the
app.

## The OPENAI_API_KEY credential

`OPENAI_API_KEY` is a StabiFlow **platform-level** AI provider credential,
configured in Supabase secrets (server-side edge function environment).
It must remain:

- server-side only - read via `Deno.env.get("OPENAI_API_KEY")` inside an
  edge function, never in any client-shipped code
- never exposed through a `VITE_*` env var (those get bundled into the
  browser build)
- never returned in any API response to a client
- never logged
- never committed to the repository
- never stored in an ordinary database row (secrets belonging to a
  *workspace's own* provider connections go through Vault, same pattern as
  Meta/WhatsApp tokens - see `docs/architecture/multi-tenancy.md`; this key
  is StabiFlow's own platform credential, not a workspace's, and lives only
  in edge function secrets)

The same variable name (`OPENAI_API_KEY`) is used in both development and
production, with different secret values per environment - never a
hardcoded key, never a per-workspace key for this credential.

## WhatsApp AI vs Flow AI - two separate logical systems

Both exist to answer different questions, and Flow AI's arrival must never
cause the WhatsApp AI state machine to be replaced "because we now have
`OPENAI_API_KEY`." They may eventually share a low-level OpenAI/provider
client, but keep separate prompts, schemas, guardrails, feature logic,
authorization, and state management.

**WhatsApp AI** (built in Phase D, ported from Acapolite - see
`acapolite-reuse-strategy.md`) is responsible for:

- conversation replies and conversation context
- intent handling and missing-information handling
- the AI/Human Control state machine - Take Over / Return to AI
- chat-specific guardrails (false-action-claim detection, invented-identity
  detection, human-handoff-phrase detection)
- conversation-specific structured output (extracted name/email/interest/
  urgency)
- staff-assisted reply drafting

This is a proven, narrow, conversation-scoped system. Preserve it as-is
when Flow AI is introduced.

**Flow AI** (not yet built) will be a future system-wide intelligence
layer responsible for things WhatsApp AI was never meant to do:

- content generation and content variations
- campaign copy
- creative analysis, campaign analysis
- lead summaries, qualification assistance, opportunity summaries
- attribution analysis, performance recommendations
- automation AI actions (see `automation-architecture.md`)
- cross-platform intelligence

## Future central AI control plane

When Flow AI is implemented, route it through one centralized server-side
service rather than scattering OpenAI calls across features:

```
StabiFlow Feature -> Flow AI Gateway -> AI Provider
```

Potential future Flow AI "features" (gateway request types) - **do not
implement all of these now**, this is the shape to grow into:

- `content_caption`, `content_variation`
- `campaign_copy`
- `creative_analysis`, `campaign_analysis`
- `lead_summary`, `lead_qualification`
- `opportunity_summary`
- `attribution_analysis`
- `flow_ai_recommendation`
- `automation_ai_action`

## AI usage and cost tracking (future)

Flow AI must support workspace-level usage tracking from day one of its
own implementation, so quotas/billing/abuse-prevention aren't bolted on
later. Plan toward a table conceptually shaped like:

```
ai_usage_events
  workspace_id
  feature            -- one of the Flow AI Gateway feature names above
  provider            -- e.g. "openai"
  model
  request_id
  prompt_version
  input_tokens / output_tokens / total_tokens
  estimated_cost      -- where reliably available
  latency
  status
  created_at
```

This is intended to eventually support workspace AI quotas,
subscription-plan limits, usage reporting, cost monitoring, and abuse
prevention. Never store API keys or unnecessary customer content in usage
telemetry - token counts and metadata, not the raw prompt/response bodies.

## AI safety - the non-negotiable boundary

AI must never become an uncontrolled business-action layer. Raw AI output
must **never directly**:

- increase or decrease advertising budgets
- publish a paid campaign
- delete records
- modify workspace permissions
- disconnect integrations
- send unrestricted messages
- move a critical CRM stage (e.g. mark an opportunity won/lost) on its own
- execute arbitrary database operations

The pattern is: **AI produces structured recommendations/proposed
actions. Deterministic server-side code authorizes, validates, enforces
limits, and executes the approved action** - the same shape WhatsApp AI
already uses (guardrails sanitize/reject AI output before it's ever sent,
and the reply itself, not an arbitrary side effect, is the only thing AI
output can produce).
