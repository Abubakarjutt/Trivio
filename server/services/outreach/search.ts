// Web search for prospect research: Tavily (free plan, no card) or Brave (paid).
// The search service receives only the query text (a name and a company), never the pasted profile.
/** `content` is the page's main text when the service sends it (Tavily does), so Trivio needn't open it. */
export type SearchResult = { title: string; url: string; snippet: string; content?: string };

export type SearchEngine = "tavily" | "brave";
export const SEARCH_ENGINES = ["tavily", "brave"] as const;
export const SEARCH_SERVICE: Record<SearchEngine, string> = { tavily: "Tavily", brave: "Brave" };

export interface SearchProvider {
  /** The service's name, for messages ("Tavily", "Brave"). */
  readonly service: string;
  /** Pause between searches; Brave's lowest plan allows one a second. */
  readonly gapMs: number;
  search(query: string, opts?: { count?: number }): Promise<SearchResult[]>;
}

/** rate_limited is worth one retry; quota means the plan's searches are used up. */
export type SearchErrorKind = "bad_key" | "rate_limited" | "quota" | "refused" | "unreachable";

export class SearchError extends Error {
  constructor(
    public kind: SearchErrorKind,
    message: string
  ) {
    super(message);
    this.name = "SearchError";
  }
}

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const TIMEOUT_MS = 10_000;
const BRAVE_GAP_MS = 1100;
const message = (kind: SearchErrorKind, service: string) =>
  ({
    bad_key: `${service} rejected this key. Check it and try again.`,
    rate_limited: `${service} is getting too many searches. Try again in a minute.`,
    refused: `${service} refused the search. Try again later.`,
    quota: `${service} quota reached. Try again later, or check your ${service} plan.`,
    unreachable: `Couldn't reach ${service}. Check your internet connection and try again.`,
  })[kind];
const failer = (service: string) => (kind: SearchErrorKind) =>
  new SearchError(kind, message(kind, service));
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Brave answers a bad or unsubscribed key with 422 (sometimes 400) and a JSON error body. */
async function isAuthRejection(res: Response): Promise<boolean> {
  try {
    const err = ((await res.json()) as { error?: Record<string, unknown> } | null)?.error;
    const meta = err?.meta as { component?: unknown } | null | undefined;
    return (
      /SUBSCRIPTION_TOKEN|TOKEN_INVALID/i.test(str(err?.code)) ||
      meta?.component === "authentication"
    );
  } catch {
    return false;
  }
}

export function createBraveSearch(apiKey: string, fetchImpl: typeof fetch = fetch): SearchProvider {
  const fail = failer(SEARCH_SERVICE.brave);
  return {
    service: SEARCH_SERVICE.brave,
    gapMs: BRAVE_GAP_MS,
    async search(query, opts = {}) {
      const url = new URL(BRAVE_ENDPOINT);
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(opts.count ?? 8));
      let res: Response;
      try {
        res = await fetchImpl(url.toString(), {
          headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw fail("unreachable");
      }
      if (res.status === 401 || res.status === 403) throw fail("bad_key");
      if (res.status === 429) throw fail("rate_limited");
      if ((res.status === 400 || res.status === 422) && (await isAuthRejection(res)))
        throw fail("bad_key");
      if (res.status >= 400 && res.status < 500) throw fail("refused");
      if (!res.ok) throw fail("unreachable");
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw fail("unreachable");
      }
      const results = (body as { web?: { results?: unknown } } | null)?.web?.results;
      if (!Array.isArray(results)) return [];
      return results.flatMap((r: Record<string, unknown> | null) =>
        r && typeof r.url === "string"
          ? [{ title: str(r.title), url: r.url, snippet: str(r.description) }]
          : []
      );
    },
  };
}

/** Tavily: POST with a Bearer key. 432/433 mean the plan's or spending limit's searches are used up. */
export function createTavilySearch(
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): SearchProvider {
  const fail = failer(SEARCH_SERVICE.tavily);
  return {
    service: SEARCH_SERVICE.tavily,
    gapMs: 0,
    async search(query, opts = {}) {
      let res: Response;
      try {
        res = await fetchImpl(TAVILY_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query,
            max_results: opts.count ?? 8,
            search_depth: "basic",
            // The cleaned page, at no extra credit: blocked or script-drawn pages still have text.
            include_raw_content: "markdown",
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw fail("unreachable");
      }
      if (res.status === 401 || res.status === 403) throw fail("bad_key");
      if (res.status === 429) throw fail("rate_limited");
      if (res.status === 432 || res.status === 433) throw fail("quota");
      if (res.status >= 400 && res.status < 500) throw fail("refused");
      if (!res.ok) throw fail("unreachable");
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw fail("unreachable");
      }
      const results = (body as { results?: unknown } | null)?.results;
      if (!Array.isArray(results)) return [];
      return results.flatMap((r: Record<string, unknown> | null) =>
        r && typeof r.url === "string"
          ? [
              {
                title: str(r.title),
                url: r.url,
                snippet: str(r.content),
                content: str(r.raw_content),
              },
            ]
          : []
      );
    },
  };
}

/** The provider for an engine and key. Router code goes through this so QA can replace it. */
export function createSearch(engine: SearchEngine, apiKey: string): SearchProvider {
  return engine === "tavily" ? createTavilySearch(apiKey) : createBraveSearch(apiKey);
}
