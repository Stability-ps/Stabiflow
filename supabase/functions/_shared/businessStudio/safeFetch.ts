// SSRF-safe website fetching for Business Studio.
//
// Website URLs come from customers (untrusted). Defences, all enforced on
// EVERY hop including redirects:
//  * http/https only, default ports only, no credentials in the URL.
//  * Hostnames that are local by convention (localhost, *.local,
//    *.internal, *.localhost, bare single-label names) are refused.
//  * The hostname is resolved first and EVERY A/AAAA answer must be a
//    public unicast address - loopback, RFC1918, CGNAT, link-local (incl.
//    169.254.169.254 cloud metadata), multicast, reserved, documentation,
//    IPv4-mapped/NAT64-embedded private v4, ULA and v6 link-local are all
//    refused. An IP-literal host is checked the same way.
//  * Redirects are followed manually (max 4), each target re-validated.
//  * Response size is capped while streaming (never buffered unbounded),
//    only HTML/XHTML/plain text is accepted, and every request has a hard
//    timeout.
//
// Residual risk (documented): DNS can change between our resolve and the
// runtime's own connect (rebinding). The window is milliseconds and the
// platform's edge runtime has no private network of its own to reach, but
// this is why the resolver check is defence in depth, not the only line.

export type FetchPolicy = {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  userAgent: string;
};

export const DEFAULT_POLICY: FetchPolicy = {
  timeoutMs: 10_000,
  maxBytes: 1_500_000,
  maxRedirects: 4,
  userAgent: "StabiFlowBot/1.0 (+https://stabiflow.com/bot; business profile builder)",
};

export class UnsafeUrlError extends Error {}

// -- IP classification -----------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

export function isPublicIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  for (const [base, bits] of V4_BLOCKED) {
    const b = ipv4ToInt(base)!;
    const size = 2 ** (32 - bits);
    if (n >= b && n < b + size) return false;
  }
  return true;
}

function expandIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  if (addr.startsWith("[") && addr.endsWith("]")) addr = addr.slice(1, -1);
  const zone = addr.indexOf("%");
  if (zone >= 0) return null; // zone ids only make sense for link-local
  // Trailing embedded IPv4 (e.g. ::ffff:10.0.0.1)
  let tailV4: number[] = [];
  const lastColon = addr.lastIndexOf(":");
  if (addr.includes(".") && lastColon >= 0) {
    const v4 = ipv4ToInt(addr.slice(lastColon + 1));
    if (v4 === null) return null;
    tailV4 = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    addr = addr.slice(0, lastColon) + ":0:0";
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  if (nums.some((x) => Number.isNaN(x))) return null;
  if (tailV4.length) {
    nums[6] = tailV4[0];
    nums[7] = tailV4[1];
  }
  return nums;
}

export function isPublicIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return false;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d -> judge the v4
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPublicIPv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  // NAT64 64:ff9b::/96 embeds a v4 address
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPublicIPv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2002) {
    // 6to4 embeds a v4 address in groups 1-2
    return isPublicIPv4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`);
  }
  // Only global unicast 2000::/3 is acceptable.
  return (g[0] & 0xe000) === 0x2000;
}

export function isPublicIp(ip: string): boolean {
  return ip.includes(":") ? isPublicIPv6(ip) : isPublicIPv4(ip);
}

// -- URL policy ---------------------------------------------------------------------

const LOCAL_SUFFIXES = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".localdomain"];

/** Normalises what a customer typed ("acme.co.za", "http://acme.co.za/") into a URL, or throws. */
export function normalizeWebsiteInput(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) throw new UnsafeUrlError("Please enter your website address");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a website address");
  }
  assertUrlShapeAllowed(url);
  url.hash = "";
  return url;
}

export function assertUrlShapeAllowed(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only http and https websites can be scanned");
  if (url.username || url.password) throw new UnsafeUrlError("Website addresses with credentials are not allowed");
  if (url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))) {
    throw new UnsafeUrlError("Only websites on standard ports can be scanned");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("Missing website host");
  const isV6Literal = host.startsWith("[");
  const isV4Literal = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (isV6Literal || isV4Literal) {
    if (!isPublicIp(host)) throw new UnsafeUrlError("That address is not a public website");
    return;
  }
  if (host === "localhost" || !host.includes(".") || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError("That address is not a public website");
  }
  // Decimal/hex/octal integer hosts ("2130706433", "0x7f.1") are refused.
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+))*$/i.test(host)) throw new UnsafeUrlError("That address is not a public website");
}

export type Resolver = (host: string) => Promise<string[]>;

export const denoResolver: Resolver = async (host) => {
  const results: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    try {
      results.push(...(await Deno.resolveDns(host, type)));
    } catch {
      // NXDOMAIN / no records of this type
    }
  }
  return results;
};

export async function assertHostResolvesPublic(url: URL, resolve: Resolver): Promise<void> {
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return; // literal already checked
  const addrs = await resolve(host);
  if (addrs.length === 0) throw new UnsafeUrlError("We couldn't find that website");
  if (addrs.some((a) => !isPublicIp(a))) throw new UnsafeUrlError("That address is not a public website");
}

// -- Fetch ---------------------------------------------------------------------------

export type FetchedPage = { url: string; status: number; contentType: string; body: string; truncated: boolean };

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.slice(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged), truncated };
}

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export async function safeFetch(
  start: URL,
  opts: { policy?: FetchPolicy; resolve?: Resolver; fetchImpl?: FetchImpl; accept?: "html" | "text" } = {},
): Promise<FetchedPage> {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const resolve = opts.resolve ?? denoResolver;
  const doFetch = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  let current = new URL(start.toString());

  for (let hop = 0; hop <= policy.maxRedirects; hop++) {
    assertUrlShapeAllowed(current);
    await assertHostResolvesPublic(current, resolve);

    const res = await doFetch(current.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": policy.userAgent, Accept: opts.accept === "text" ? "text/plain,*/*;q=0.1" : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      signal: AbortSignal.timeout(policy.timeoutMs),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location) throw new UnsafeUrlError("The website redirected without a destination");
      current = new URL(location, current);
      continue;
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const okType = opts.accept === "text" ? contentType.startsWith("text/") : /^(text\/html|application\/xhtml\+xml|text\/plain)/.test(contentType);
    if (!okType) {
      await res.body?.cancel().catch(() => {});
      return { url: current.toString(), status: res.status, contentType, body: "", truncated: false };
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > policy.maxBytes * 4) {
      await res.body?.cancel().catch(() => {});
      throw new UnsafeUrlError("That page is too large to scan");
    }
    const { text, truncated } = await readCapped(res, policy.maxBytes);
    return { url: current.toString(), status: res.status, contentType, body: text, truncated };
  }
  throw new UnsafeUrlError("The website redirected too many times");
}
