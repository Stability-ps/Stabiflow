// Isolated from index.ts (which calls Deno.serve() at module load) so this
// pure redirect-building logic can be unit-tested without starting a server.
//
// Must match the authenticated app's actual Integrations route
// (src/App.tsx: "/app/integrations", nested under RequireAuth +
// RequireWorkspace) - NOT the bare "/integrations" path, which no longer
// exists after the frontend routing cleanup and has no catch-all route to
// fall back to, so it rendered a blank page (production regression fix).
export function redirectToApp(appOrigin: string, params: Record<string, string | undefined>): Response {
  const url = new URL("/app/integrations", appOrigin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}
