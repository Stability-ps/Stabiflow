// Bounded crawl of ONE website: the home page, robots.txt, then up to
// `maxPages - 1` of the most informative same-site pages. Every request
// goes through safeFetch (SSRF policy re-checked per hop), the crawl has a
// total time budget, and nothing outside the starting site is fetched.
import { extractPage, isAllowedByRobots, parseRobots, sameSite, selectPagesToCrawl, type ExtractedPage } from "./htmlExtract.ts";
import { DEFAULT_POLICY, safeFetch, UnsafeUrlError, type FetchImpl, type Resolver } from "./safeFetch.ts";

export type CrawlResult = {
  finalUrl: string;
  pages: (ExtractedPage & { status: number })[];
  skippedByRobots: number;
  errors: string[];
};

export type CrawlOptions = { maxPages?: number; totalBudgetMs?: number; fetchImpl?: FetchImpl; resolve?: Resolver; now?: () => number };

export async function crawlSite(start: URL, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = Math.min(opts.maxPages ?? 8, 12);
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + (opts.totalBudgetMs ?? 45_000);
  const fetchOpts = { policy: DEFAULT_POLICY, fetchImpl: opts.fetchImpl, resolve: opts.resolve };
  const errors: string[] = [];

  // Home page failures are fatal (UnsafeUrlError message is customer-safe).
  const home = await safeFetch(start, fetchOpts);
  if (home.status >= 400) throw new UnsafeUrlError(`The website returned an error (${home.status})`);
  if (!home.body) throw new UnsafeUrlError("The website did not return a readable page");
  // A redirect to a different site is followed for the home page only
  // (e.g. acme.com -> acme.co.za); the crawl then stays on that site.
  const finalUrl = new URL(home.url);

  const pages: (ExtractedPage & { status: number })[] = [{ ...extractPage(home.body, home.url), status: home.status }];

  let disallow: string[] = [];
  try {
    const robots = await safeFetch(new URL("/robots.txt", finalUrl), { ...fetchOpts, accept: "text" });
    if (robots.status < 400 && robots.body) disallow = parseRobots(robots.body.slice(0, 50_000));
  } catch {
    // No robots.txt is fine.
  }

  const candidates = selectPagesToCrawl(finalUrl, pages[0].links, maxPages * 2);
  let skippedByRobots = 0;
  for (const url of candidates) {
    if (pages.length >= maxPages || now() > deadline) break;
    if (!isAllowedByRobots(url.pathname, disallow)) {
      skippedByRobots++;
      continue;
    }
    try {
      const page = await safeFetch(url, fetchOpts);
      if (page.status >= 400 || !page.body) continue;
      if (!sameSite(new URL(page.url), finalUrl)) continue; // redirected off-site
      pages.push({ ...extractPage(page.body, page.url), status: page.status });
    } catch (e) {
      errors.push(`${url.pathname}: ${e instanceof Error ? e.message : "error"}`.slice(0, 200));
    }
  }
  return { finalUrl: finalUrl.toString(), pages, skippedByRobots, errors };
}
