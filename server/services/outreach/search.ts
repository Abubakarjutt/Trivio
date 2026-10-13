// Web search for prospect research. Brave only for now; the interface leaves room for others.
// Brave receives only the query text (a name and a company), never the pasted profile.
export type SearchResult = { title: string; url: string; snippet: string };

export interface SearchProvider {
  search(query: string, opts?: { count?: number }): Promise<SearchResult[]>;
}

export type SearchErrorKind = "bad_key" | "quota" | "unreachable";

export class SearchError extends Error {
  constructor(
    public kind: SearchErrorKind,
    message: string
  ) {
    super(message);
    this.name = "SearchError";
  }
}

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const TIMEOUT_MS = 10_000;
const MESSAGE: Record<SearchErrorKind, string> = {
  bad_key: "Brave rejected this key. Check it and try again.",
  quota: "Brave quota reached. Try again later, or check your Brave plan.",
  unreachable: "Couldn't reach Brave. Check your internet connection and try again.",
};
const fail = (kind: SearchErrorKind) => new SearchError(kind, MESSAGE[kind]);
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
  return {
    async search(query, opts = {}) {
      const url = new URL(ENDPOINT);
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
      if (res.status === 429) throw fail("quota");
      if ((res.status === 400 || res.status === 422) && (await isAuthRejection(res)))
        throw fail("bad_key");
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
