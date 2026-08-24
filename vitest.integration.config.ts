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
  },
});
