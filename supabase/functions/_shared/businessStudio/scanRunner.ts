// One website scan, end to end, shared by the interactive Business Studio
// scan and the monitoring tick:
//   crawl (SSRF-safe) -> store pages -> deterministic + verified-AI facts
//   -> de-duplicate against the current Business Identity -> proposals.
// Nothing is ever applied to the identity here.
import type { AnySupabaseClient } from "../contentAuth.ts";
import { crawlSite } from "./crawl.ts";
import { extractPage } from "./htmlExtract.ts";
import { dedupeProposals, deterministicProposals, verifyAiFacts, type CurrentFacts, type Proposal } from "./factExtraction.ts";
import { extractFacts, type AiCredential } from "./ai.ts";
import { UnsafeUrlError } from "./safeFetch.ts";

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadCurrentFacts(sb: AnySupabaseClient, workspaceId: string): Promise<CurrentFacts> {
  const [identity, contacts, social, offerings, team, projects, certs, identifiers, locations] = await Promise.all([
    sb.from("business_identities").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    sb.from("business_contacts").select("kind, value").eq("workspace_id", workspaceId),
    sb.from("business_social_links").select("url").eq("workspace_id", workspaceId),
    sb.from("business_offerings").select("name").eq("workspace_id", workspaceId),
    sb.from("business_team_members").select("full_name").eq("workspace_id", workspaceId),
    sb.from("business_projects").select("title").eq("workspace_id", workspaceId),
    sb.from("business_certifications").select("name").eq("workspace_id", workspaceId),
    sb.from("business_identifiers").select("scheme, value").eq("workspace_id", workspaceId),
    sb.from("business_locations").select("address_line1").eq("workspace_id", workspaceId),
  ]);
  return {
    identity: (identity.data ?? {}) as Record<string, unknown>,
    contacts: (contacts.data ?? []) as { kind: string; value: string }[],
    socialUrls: ((social.data ?? []) as { url: string }[]).map((r) => r.url),
    offeringNames: ((offerings.data ?? []) as { name: string }[]).map((r) => r.name),
    teamNames: ((team.data ?? []) as { full_name: string }[]).map((r) => r.full_name),
    projectTitles: ((projects.data ?? []) as { title: string }[]).map((r) => r.title),
    certificationNames: ((certs.data ?? []) as { name: string }[]).map((r) => r.name),
    identifierSchemes: Object.fromEntries(((identifiers.data ?? []) as { scheme: string; value: string }[]).map((r) => [r.scheme, r.value])),
    addressLines: ((locations.data ?? []) as { address_line1: string | null }[]).map((r) => r.address_line1 ?? "").filter(Boolean),
  };
}

export type ScanOutcome = {
  scanId: string;
  status: "completed" | "failed" | "blocked";
  error: string | null;
  finalUrl: string | null;
  pagesFetched: number;
  proposalsCreated: number;
  aiDropped: number;
  changedPages: number;
  summary: { name: string | null; description: string | null; website: string | null };
};

export async function runScan(
  sb: AnySupabaseClient,
  input: { workspaceId: string; url: URL; purpose: "onboarding" | "manual" | "monitoring"; userId: string | null; ai: AiCredential | null; previousScanId?: string | null },
): Promise<ScanOutcome> {
  const { data: scan, error: scanErr } = await sb
    .from("website_scans")
    .insert({ workspace_id: input.workspaceId, requested_url: input.url.toString().slice(0, 500), purpose: input.purpose, status: "running", created_by: input.userId })
    .select("id")
    .single();
  if (scanErr) throw new Error(`scan insert: ${scanErr.message}`);
  const scanId = scan.id as string;

  const finish = async (patch: Record<string, unknown>) => {
    await sb.from("website_scans").update({ ...patch, completed_at: new Date().toISOString() }).eq("id", scanId);
  };

  let crawl;
  try {
    crawl = await crawlSite(input.url);
  } catch (e) {
    const blocked = e instanceof UnsafeUrlError;
    const message = blocked ? e.message : "We couldn't reach that website right now. Please check the address and try again.";
    await finish({ status: blocked ? "blocked" : "failed", error: message.slice(0, 500) });
    return { scanId, status: blocked ? "blocked" : "failed", error: message, finalUrl: null, pagesFetched: 0, proposalsCreated: 0, aiDropped: 0, changedPages: 0, summary: { name: null, description: null, website: null } };
  }

  // Store pages (plain text only) and detect changes vs the previous scan.
  const pageRows = [];
  for (const p of crawl.pages) pageRows.push({ scan_id: scanId, workspace_id: input.workspaceId, url: p.url.slice(0, 2000), http_status: p.status, title: p.title?.slice(0, 300) ?? null, content_hash: await sha256(p.text), text_excerpt: p.text.slice(0, 20000) });
  await sb.from("website_scan_pages").insert(pageRows);

  let changedPages = 0;
  if (input.previousScanId) {
    const { data: prev } = await sb.from("website_scan_pages").select("url, content_hash").eq("scan_id", input.previousScanId);
    const prevHash = new Map(((prev ?? []) as { url: string; content_hash: string }[]).map((r) => [r.url, r.content_hash]));
    changedPages = pageRows.filter((r) => prevHash.has(r.url) && prevHash.get(r.url) !== r.content_hash).length;
  }

  const proposals: Proposal[] = deterministicProposals(crawl.pages);
  let aiDropped = 0;
  if (input.ai && crawl.pages.some((p) => p.text.length > 200)) {
    try {
      const started = Date.now();
      const { parsed, usage } = await extractFacts(input.ai, crawl.pages);
      const verified = verifyAiFacts(parsed, crawl.pages);
      proposals.push(...verified.proposals);
      aiDropped = verified.dropped;
      await sb.from("ai_usage_events").insert({
        workspace_id: input.workspaceId, user_id: input.userId, feature: input.purpose === "monitoring" ? "business_studio_monitor" : "business_studio_scan",
        provider: "openai", model: input.ai.model, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, latency_ms: Date.now() - started, status: "success",
      });
    } catch (e) {
      // Deterministic facts still stand; the AI pass is best-effort.
      console.error("business studio AI extraction failed", e instanceof Error ? e.message : e);
      await sb.from("ai_usage_events").insert({
        workspace_id: input.workspaceId, user_id: input.userId, feature: "business_studio_scan", provider: "openai", model: input.ai.model, input_tokens: 0, output_tokens: 0, status: "error",
      });
    }
  }

  const current = await loadCurrentFacts(sb, input.workspaceId);
  if (!current.identity.website) {
    proposals.push({ target: "identity_field", field: "website", proposed: { value: crawl.finalUrl.replace(/\/$/, "") }, evidence: `Scanned website: ${crawl.finalUrl}`, evidence_url: crawl.finalUrl, extraction_method: "structured_data" });
  }
  const deduped = dedupeProposals(proposals, current);

  // Monitoring: a fresh set of proposals supersedes this workspace's older
  // PENDING monitoring proposals (never touches accepted/rejected ones).
  if (input.purpose === "monitoring" && deduped.length) {
    await sb.from("business_fact_proposals").update({ status: "superseded", reviewed_at: new Date().toISOString() }).eq("workspace_id", input.workspaceId).eq("origin", "monitoring").eq("status", "pending");
  }

  if (deduped.length) {
    const { error } = await sb.from("business_fact_proposals").insert(
      deduped.map((p) => ({
        workspace_id: input.workspaceId,
        scan_id: scanId,
        origin: input.purpose === "monitoring" ? "monitoring" : "website_scan",
        target: p.target,
        field: p.field ?? null,
        proposed: p.proposed,
        current_value: p.current_value ?? null,
        evidence: p.evidence?.slice(0, 600) ?? null,
        evidence_url: p.evidence_url?.slice(0, 2000) ?? null,
        extraction_method: p.extraction_method,
      })),
    );
    if (error) console.error("proposal insert failed", error.message);
  }

  const pick = (field: string) => (proposals.find((p) => p.target === "identity_field" && p.field === field)?.proposed.value as string | undefined) ?? null;
  const summary = { name: pick("trading_name") ?? pick("legal_name"), description: pick("short_description"), website: crawl.finalUrl };
  await finish({ status: "completed", final_url: crawl.finalUrl.slice(0, 2000), pages_fetched: crawl.pages.length, summary: { ...summary, proposals: deduped.length, ai_dropped: aiDropped, changed_pages: changedPages } });

  return { scanId, status: "completed", error: null, finalUrl: crawl.finalUrl, pagesFetched: crawl.pages.length, proposalsCreated: deduped.length, aiDropped, changedPages, summary };
}

/**
 * "Upload existing profile": text the customer pastes from their current
 * company profile is treated exactly like a scanned page - the same
 * verified-AI extraction (every fact must be quoted verbatim from the text)
 * and the same review-before-apply proposals, origin 'document_upload'.
 */
export async function runTextExtraction(
  sb: AnySupabaseClient,
  input: { workspaceId: string; text: string; userId: string; ai: AiCredential },
): Promise<{ proposalsCreated: number; aiDropped: number }> {
  const text = input.text.replace(/\r\n/g, "\n").slice(0, 20_000);
  const page = {
    url: "https://upload.stabiflow.invalid/existing-profile", title: "Uploaded profile", metaDescription: null, siteName: null, text,
    headings: [], links: [], jsonLd: [], emails: [], phones: [], whatsapp: [], social: [],
  };
  // Contact details in plain text are picked up by the same patterns.
  const patterned = extractPage(`<body>${text.replace(/</g, " ").replace(/\n/g, "<br>")}</body>`, page.url);
  const started = Date.now();
  const { parsed, usage } = await extractFacts(input.ai, [page]);
  const verified = verifyAiFacts(parsed, [page]);
  await sb.from("ai_usage_events").insert({
    workspace_id: input.workspaceId, user_id: input.userId, feature: "business_studio_upload", provider: "openai", model: input.ai.model,
    input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, latency_ms: Date.now() - started, status: "success",
  });
  const proposals: Proposal[] = [
    ...verified.proposals,
    ...patterned.emails.map((e) => ({ target: "contact" as const, proposed: { kind: "email", value: e }, evidence: e, evidence_url: null, extraction_method: "pattern" as const })),
    ...patterned.phones.map((p) => ({ target: "contact" as const, proposed: { kind: "phone", value: p }, evidence: p, evidence_url: null, extraction_method: "pattern" as const })),
  ].map((p) => ({ ...p, evidence_url: null }));
  const deduped = dedupeProposals(proposals, await loadCurrentFacts(sb, input.workspaceId));
  if (deduped.length) {
    await sb.from("business_fact_proposals").insert(deduped.map((p) => ({
      workspace_id: input.workspaceId, origin: "document_upload", target: p.target, field: p.field ?? null, proposed: p.proposed,
      current_value: p.current_value ?? null, evidence: p.evidence?.slice(0, 600) ?? null, evidence_url: null, extraction_method: p.extraction_method,
    })));
  }
  return { proposalsCreated: deduped.length, aiDropped: verified.dropped };
}
