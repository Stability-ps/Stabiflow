#!/usr/bin/env node
// Runs DB-only integration suites against LOCAL Supabase.
//
// `npm run test:integration` reads .env.test.local, which points at the
// linked REMOTE project - correct for suites that exercise deployed Edge
// Functions, wrong for read-model suites whose migration is intentionally
// not pushed to remote (e.g. the Phase 1 revenue-ops read models). This
// wrapper reads the local stack's URL + keys from `supabase status` and
// injects them via process.env, which supabase/tests/helpers.ts prefers
// over the file. Nothing is written to disk; .env.test.local is untouched.
//
// Usage:
//   node scripts/test-integration-local.mjs                # default files
//   node scripts/test-integration-local.mjs supabase/tests/foo.test.ts ...
//
// Suites that call the integration Edge Functions locally (e.g.
// integrations-whatsapp-webhook.test.ts) additionally need a gitignored
// `supabase/functions/.env` so the local Edge runtime has the non-Supabase
// config those functions read. Minimum for the WhatsApp webhook-
// subscription suite (mock mode, no real Meta calls):
//
//   INTEGRATIONS_META_MOCK_MODE=true
//   INTEGRATIONS_TEST_HARNESS_SECRET=<same value as in .env.test.local>
//   INTEGRATIONS_META_GRAPH_API_VERSION=v21.0
//   INTEGRATIONS_META_APP_ID=local-test-app-id
//
// After creating/changing it: `npx supabase stop && npx supabase start`
// (or `docker restart supabase_edge_runtime_<project>`).
import { execFileSync, spawnSync } from "node:child_process";

const DEFAULT_FILES = [
  "supabase/tests/campaign-journey.test.ts",
  "supabase/tests/revenue-breakdown.test.ts",
  "supabase/tests/integrations-whatsapp-webhook.test.ts",
];

function localEnvFromSupabase() {
  let out;
  try {
    out = execFileSync("npx", ["--no-install", "supabase", "status", "-o", "env"], { encoding: "utf8" });
  } catch {
    console.error(
      "Could not read `supabase status`. Start the local stack first:\n" +
      "  npx supabase start   (or: npx supabase db reset)",
    );
    process.exit(1);
  }
  const map = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) map[m[1]] = m[2];
  }
  const trio = {
    SUPABASE_URL: map.API_URL,
    SUPABASE_ANON_KEY: map.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: map.SERVICE_ROLE_KEY,
  };
  if (!trio.SUPABASE_URL || !trio.SUPABASE_ANON_KEY || !trio.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("`supabase status` did not report API_URL/ANON_KEY/SERVICE_ROLE_KEY - is the local stack running?");
    process.exit(1);
  }
  return trio;
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;
const local = localEnvFromSupabase();
console.error(`[test:integration:local] ${files.length} file(s) -> LOCAL Supabase at ${local.SUPABASE_URL}`);

const res = spawnSync(
  "npx",
  ["--no-install", "vitest", "run", "--config", "vitest.integration.config.ts", ...files],
  { stdio: "inherit", env: { ...process.env, ...local } },
);
process.exit(res.status ?? 1);
