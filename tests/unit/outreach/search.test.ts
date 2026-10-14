import { describe, expect, it, vi } from "vitest";
import {
  createBraveSearch,
  createSearch,
  createTavilySearch,
  SearchError,
} from "@/server/services/outreach/search";
import { pickSearch } from "@/server/services/outreach/config";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createBraveSearch", () => {
  it("sends the query, count and key, and maps results", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, {
        web: {
          results: [
            { title: "Acme raises", url: "https://news.example.com/a", description: "Seed round" },
            { title: "No url" },
          ],
        },
      })
    );
    const out = await createBraveSearch("k-123", fetchImpl as unknown as typeof fetch).search(
      '"Acme" news',
      { count: 8 }
    );
    expect(out).toEqual([
      { title: "Acme raises", url: "https://news.example.com/a", snippet: "Seed round" },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(u.searchParams.get("q")).toBe('"Acme" news');
    expect(u.searchParams.get("count")).toBe("8");
    expect((init.headers as Record<string, string>)["X-Subscription-Token"]).toBe("k-123");
    expect((init.headers as Record<string, string>).Accept).toBe("application/json");
  });

  it("returns nothing when Brave has no web section", async () => {
    const s = createBraveSearch("k", (async () => json(200, {})) as unknown as typeof fetch);
    expect(await s.search("x")).toEqual([]);
  });

  it.each([
    [401, "bad_key"],
    [403, "bad_key"],
    [429, "quota"],
    [500, "unreachable"],
    [503, "unreachable"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    const s = createBraveSearch("k", (async () => json(status, {})) as unknown as typeof fetch);
    await expect(s.search("x")).rejects.toMatchObject({ kind });
  });

  const rejected = (status: number, error: unknown) =>
    createBraveSearch("k", (async () =>
      json(status, { type: "ErrorResponse", error })) as unknown as typeof fetch);

  it("maps Brave's rejected-key 422 to bad_key", async () => {
    const s = rejected(422, { code: "SUBSCRIPTION_TOKEN_INVALID", status: 422 });
    await expect(s.search("x")).rejects.toMatchObject({ kind: "bad_key" });
  });

  it("maps an authentication-component 400 to bad_key", async () => {
    const s = rejected(400, { code: "OTHER", meta: { component: "authentication" } });
    await expect(s.search("x")).rejects.toMatchObject({ kind: "bad_key" });
  });

  it("maps an authentication-component 422 with another code to bad_key", async () => {
    const s = rejected(422, { code: "OTHER", meta: { component: "authentication" } });
    await expect(s.search("x")).rejects.toMatchObject({ kind: "bad_key" });
  });

  it("keeps other 422s unreachable", async () => {
    await expect(rejected(422, { code: "VALIDATION" }).search("x")).rejects.toMatchObject({
      kind: "unreachable",
    });
  });

  it("keeps a 422 with a non-JSON body unreachable", async () => {
    const s = createBraveSearch(
      "k",
      (async () => new Response("nope", { status: 422 })) as unknown as typeof fetch
    );
    await expect(s.search("x")).rejects.toMatchObject({ kind: "unreachable" });
  });

  it("maps a network error to unreachable", async () => {
    const s = createBraveSearch("k", (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    const err = await s.search("x").catch((e) => e);
    expect(err).toBeInstanceOf(SearchError);
    expect(err.kind).toBe("unreachable");
  });
});

describe("createTavilySearch", () => {
  it("POSTs the query with a Bearer key and maps content to the snippet", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, {
        query: '"Acme" news',
        results: [
          {
            title: "Acme raises",
            url: "https://news.example.com/a",
            content: "Seed round",
            score: 0.9,
          },
          { title: "No url", content: "x" },
          null,
        ],
      })
    );
    const out = await createTavilySearch("tvly-123", fetchImpl as unknown as typeof fetch).search(
      '"Acme" news',
      { count: 8 }
    );
    expect(out).toEqual([
      { title: "Acme raises", url: "https://news.example.com/a", snippet: "Seed round" },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tvly-123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      query: '"Acme" news',
      max_results: 8,
      search_depth: "basic",
    });
  });

  it("returns nothing when Tavily has no results list", async () => {
    const s = createTavilySearch("k", (async () => json(200, {})) as unknown as typeof fetch);
    expect(await s.search("x")).toEqual([]);
  });

  it.each([
    [401, "bad_key"],
    [403, "bad_key"],
    [429, "quota"],
    [432, "quota"],
    [433, "quota"],
    [400, "unreachable"],
    [500, "unreachable"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    const s = createTavilySearch("k", (async () => json(status, {})) as unknown as typeof fetch);
    await expect(s.search("x")).rejects.toMatchObject({ kind });
  });

  it("names Tavily in its messages", async () => {
    const s = createTavilySearch("k", (async () => json(401, {})) as unknown as typeof fetch);
    await expect(s.search("x")).rejects.toThrow(
      "Tavily rejected this key. Check it and try again."
    );
  });

  it("maps a network error or a non-JSON body to unreachable", async () => {
    const down = createTavilySearch("k", (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    const err = await down.search("x").catch((e) => e);
    expect(err).toBeInstanceOf(SearchError);
    expect(err.kind).toBe("unreachable");
    const garbled = createTavilySearch(
      "k",
      (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch
    );
    await expect(garbled.search("x")).rejects.toMatchObject({ kind: "unreachable" });
  });
});

describe("createSearch", () => {
  it("picks the provider for the engine; only Brave is paced", () => {
    expect(createSearch("tavily", "k")).toMatchObject({ service: "Tavily", gapMs: 0 });
    expect(createSearch("brave", "k")).toMatchObject({ service: "Brave", gapMs: 1100 });
  });
});

describe("pickSearch", () => {
  it("prefers Tavily, falls back to Brave, and needs at least one key", () => {
    expect(pickSearch({ tavily: "t", brave: "b" })).toEqual({ engine: "tavily", apiKey: "t" });
    expect(pickSearch({ tavily: null, brave: "b" })).toEqual({ engine: "brave", apiKey: "b" });
    expect(pickSearch({ tavily: null, brave: null })).toBeNull();
  });
});
