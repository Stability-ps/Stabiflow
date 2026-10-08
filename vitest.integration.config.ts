import { defineConfig } from "vitest/config";

// Real network calls against the live StabiFlow Supabase project (never
// Acapolite's). Requires .env.test.local (gitignored - see
// .env.test.local.example) with SUPABASE_URL/SUPABASE_ANON_KEY/
// SUPABASE_SERVICE_ROLE_KEY for the StabiFlow project. Not part of the
// default `npm test` run - invoke explicitly with `npm run test:integration`.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["supabase/tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Every test file shares ONE process-wide pool of reusable test
    // identities (helpers.ts) built via a module-level round-robin cursor.
    // fileParallelism:false alone only orders file execution sequentially -
    // vitest still spins up a separate worker (fresh module state, so a
    // fresh copy of the pool) PER FILE by default, which multiplies real
    // Auth signins back up to POOL_SIZE x fileCount. singleFork:true pins
    // every file to the SAME worker process, so helpers.ts's module-level
    // pool/cursor state is genuinely shared across the whole suite and the
    // pool is built exactly once, regardless of file count.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // singleFork alone pins every file to one process, but vitest still
    // resets the module registry BETWEEN files by default (test.isolate)
    // specifically to prevent cross-file state leakage - which is exactly
    // what the identity pool needs here (helpers.ts's module-level
    // poolPromise/poolCursor must survive across files, or every file
    // rebuilds its own copy of the pool and we're back to
    // POOL_SIZE x fileCount signins). Deliberately disabling isolation is
    // safe for this suite: no test relies on a clean global/module state
    // per file, and cleanupTenant()'s workspace-scoped deletes are what
    // actually keep tests independent, not module isolation.
    isolate: false,
  },
});
