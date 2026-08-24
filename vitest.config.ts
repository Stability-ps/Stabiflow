import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Unit/component tests only. Cross-tenant RLS proof lives in
// supabase/tests/ under vitest.integration.config.ts - it hits a real
// Supabase project over the network and doesn't belong in the same
// jsdom-based, offline-friendly run as everything here.
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://test.supabase.co"),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("test-anon-key"),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
