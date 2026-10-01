// Runs the real public/sw.js inside a simulated ServiceWorkerGlobalScope
// (in-memory Cache Storage + controllable network) and checks its caching
// rules: per-deploy asset generations with pruning (review finding 7), never
// caching HTML under /assets/ (finding 8), no stale path exclusions
// (finding 12), and that API/auth/dynamic traffic is never intercepted.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const ORIGIN = "https://app.stabiflow.test";
const SW_SOURCE = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");

const abs = (u: string | Request) => new URL(typeof u === "string" ? u : u.url, ORIGIN).toString();

class FakeCache {
  entries = new Map<string, Response>();
  async match(req: string | Request) {
    const r = this.entries.get(abs(req));
    return r ? r.clone() : undefined;
  }
  async put(req: string | Request, res: Response) {
    this.entries.set(abs(req), res.clone());
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}

type Handler = (event: unknown) => void;
type Net = (req: Request) => Promise<Response>;

function loadWorker(network: Net) {
  const handlers: Record<string, Handler> = {};
  const caches = new FakeCacheStorage();
  const fetchLog: string[] = [];
  const fetchImpl = async (input: Request | string) => {
    const req = typeof input === "string" ? new Request(abs(input)) : input;
    fetchLog.push(`${req.method} ${req.url}`);
    return network(req);
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  class ScopedRequest extends Request {
    constructor(input: string | Request, init?: RequestInit) {
      super(typeof input === "string" ? abs(input) : input, init);
    }
  }
  new Function("self", "caches", "fetch", "Request", SW_SOURCE)(self, caches, fetchImpl, ScopedRequest);

  async function lifecycle(type: "install" | "activate") {
    const pending: Promise<unknown>[] = [];
    handlers[type]({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  }

  /** Dispatch a fetch event; returns undefined when the worker does not intercept. */
  async function request(url: string, init: { method?: string; mode?: string } = {}) {
    const req = { url: abs(url), method: init.method ?? "GET", mode: init.mode ?? "cors", clone() { return this; } } as unknown as Request;
    let responded: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    handlers.fetch({ request: req, respondWith: (p: Promise<Response>) => { responded = p; }, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    if (!responded) return undefined;
    const res = await responded;
    await Promise.all(pending);
    return res;
  }

  return { caches, fetchLog, lifecycle, request };
}

const html = (body: string) => new Response(`<!doctype html><html><body>${body}</body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const js = (body = "console.log(1)") => new Response(body, { status: 200, headers: { "content-type": "application/javascript" } });

let deploy = "deploy-1";
const site: Net = async (req) => {
  const { pathname } = new URL(req.url);
  if (pathname === "/index.html" || !pathname.startsWith("/assets/")) return html(deploy);
  if (pathname.endsWith(".js") && pathname.includes(deploy)) return js();
  if (pathname.endsWith(".css") && pathname.includes(deploy)) return new Response("a{}", { status: 200, headers: { "content-type": "text/css" } });
  // Missing hashed file: the SPA rewrite answers 200 with index.html.
  return html(deploy);
};

const assetCaches = (w: ReturnType<typeof loadWorker>) => [...w.caches.stores.keys()].filter((k) => k.includes("-assets-"));

beforeEach(() => { deploy = "deploy-1"; });

describe("service worker cache lifecycle", () => {

  it("install stores the static shell and the current generation marker", async () => {
    const w = loadWorker(site);
    await w.lifecycle("install");
    const shell = w.caches.stores.get("sf-shell-v2")!;
    expect(await (await shell.match("/index.html"))!.text()).toContain("deploy-1");
    expect((await (await shell.match("/__sf_generation"))!.text()).length).toBe(16);
  });

  it("activate removes obsolete caches from earlier worker versions and generations, leaving other apps' caches alone", async () => {
    const w = loadWorker(site);
    for (const k of ["sf-shell-v1", "sf-assets-v1", "sf-assets-v2-0000000000000000", "some-other-app"]) await w.caches.open(k);
    await w.lifecycle("install");
    await w.lifecycle("activate");
    const keys = [...w.caches.stores.keys()];
    expect(keys).toContain("sf-shell-v2");
    expect(keys).toContain("some-other-app");
    for (const gone of ["sf-shell-v1", "sf-assets-v1", "sf-assets-v2-0000000000000000"]) expect(keys).not.toContain(gone);
  });

  it("caches a valid static asset once and serves it from cache afterwards", async () => {
    const w = loadWorker(site);
    await w.lifecycle("install");
    const first = await w.request("/assets/index-deploy-1.js");
    expect(first!.headers.get("content-type")).toBe("application/javascript");
    const before = w.fetchLog.length;
    const second = await w.request("/assets/index-deploy-1.js");
    expect(await second!.text()).toBe("console.log(1)");
    expect(w.fetchLog.length).toBe(before); // no network
  });

  it("never stores the SPA's HTML fallback under an /assets/ URL", async () => {
    const w = loadWorker(site);
    await w.lifecycle("install");
    const res = await w.request("/assets/index-OLD-deploy.js");
    expect(res!.headers.get("content-type")).toContain("text/html"); // passed through untouched
    for (const k of assetCaches(w)) expect([...w.caches.stores.get(k)!.entries.keys()].some((u) => u.includes("OLD"))).toBe(false);
  });

  it("rejects an asset whose content type doesn't match its extension", async () => {
    const w = loadWorker(async () => new Response("a{}", { status: 200, headers: { "content-type": "text/css" } }));
    await w.lifecycle("install");
    await w.request("/assets/wrong-type.js");
    for (const k of assetCaches(w)) expect(w.caches.stores.get(k)!.entries.size).toBe(0);
  });

  it("does not cache failed asset responses", async () => {
    const w = loadWorker(async (req) => (new URL(req.url).pathname === "/index.html" ? html("x") : new Response("nope", { status: 404, headers: { "content-type": "application/javascript" } })));
    await w.lifecycle("install");
    await w.request("/assets/missing.js");
    for (const k of assetCaches(w)) expect(w.caches.stores.get(k)!.entries.size).toBe(0);
  });

  it("a new deploy starts a new asset generation and prunes the old one", async () => {
    const w = loadWorker(site);
    await w.lifecycle("install");
    await w.request("/assets/index-deploy-1.js");
    const [oldGen] = assetCaches(w);
    deploy = "deploy-2";
    await w.request("/app", { mode: "navigate" }); // network-first sees the new index.html
    await w.request("/assets/index-deploy-2.js");
    const gens = assetCaches(w);
    expect(gens).toHaveLength(1);
    expect(gens[0]).not.toBe(oldGen);
    expect([...w.caches.stores.get(gens[0])!.entries.keys()].some((u) => u.includes("deploy-2"))).toBe(true);
  });
});

describe("service worker routing", () => {
  it("navigations are network first and fall back to the cached shell only when offline", async () => {
    let online = true;
    const w = loadWorker(async (req) => {
      if (!online) throw new TypeError("offline");
      return site(req);
    });
    await w.lifecycle("install");
    const live = await w.request("/app/leads", { mode: "navigate" });
    expect(await live!.text()).toContain("deploy-1");
    expect(w.fetchLog.at(-1)).toBe(`GET ${ORIGIN}/app/leads`);
    online = false;
    const offline = await w.request("/app/leads", { mode: "navigate" });
    expect(await offline!.text()).toContain("deploy-1");
  });

  it.each([
    ["Supabase REST", "https://abc.supabase.co/rest/v1/business_identities?select=*", "GET"],
    ["Supabase auth", "https://abc.supabase.co/auth/v1/token?grant_type=password", "POST"],
    ["Edge Function", "https://abc.supabase.co/functions/v1/business-studio", "POST"],
    ["same-origin POST", "/assets/index-deploy-1.js", "POST"],
    ["same-origin PATCH", "/app/business", "PATCH"],
    ["same-origin DELETE", "/app/business", "DELETE"],
    ["non-asset same-origin GET", "/manifest.webmanifest", "GET"],
  ])("does not intercept %s", async (_label, url, method) => {
    const w = loadWorker(site);
    await w.lifecycle("install");
    const before = [...w.caches.stores.values()].reduce((n, c) => n + c.entries.size, 0);
    expect(await w.request(url, { method })).toBeUndefined();
    expect([...w.caches.stores.values()].reduce((n, c) => n + c.entries.size, 0)).toBe(before);
  });

  it("has no stale path exclusions from the abandoned architecture", () => {
    expect(SW_SOURCE).not.toMatch(/["'`]\/business\//);
    expect(SW_SOURCE).not.toMatch(/["'`]\/api\//);
  });

  it("public profiles (/b/:slug) are ordinary network-first navigations", async () => {
    const w = loadWorker(site);
    await w.lifecycle("install");
    const res = await w.request("/b/acme", { mode: "navigate" });
    expect(res).toBeDefined();
    expect(w.fetchLog.at(-1)).toBe(`GET ${ORIGIN}/b/acme`);
  });
});
