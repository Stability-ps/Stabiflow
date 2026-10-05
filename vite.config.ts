import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  envPrefix: ["VITE_"],
  define: {
    // Shown in the admin footer so operators know which build is live.
    __APP_COMMIT__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7)),
    __APP_ENV__: JSON.stringify(process.env.VERCEL_ENV ?? "development"),
  },
  server: {
    host: "::",
    port: 8081,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
