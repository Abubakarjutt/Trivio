// Web research for a prospect: the search service (Tavily or Brave) finds links, Trivio opens the best pages itself through the
// SSRF-safe fetcher, and the user's AI reads them. Nothing here saves anything.
import { FORMAT_ERROR, OutreachAiError, type Llm } from "./llm";
import { researchPrompt, type ResearchPage } from "./prompts";
import { WebResearchSchema } from "./schemas";
import {
  SearchError,
  type SearchErrorKind,
  type SearchProvider,
  type SearchResult,
} from "./search";
import type { Signal } from "./types";
import { isLinkedInHost, type FetchPage } from "./website";

export const MAX_PAGES = 6;
export const MAX_PAGE_CHARS = 3000;
export const MIN_PAGE_CHARS = 200;
export const MAX_NOTE = 600;
const PER_HOST = 2;
/** Pause before retrying a rate-limited search. */
export const SEARCH_GAP_MS = 1100;
/** Cleaning text is regex work; a huge or hostile page must not stall the server. */
const MAX_HTML_CHARS = 100_000;
/** Longer links can't be stored as a signal's source (SignalSchema caps it at 2000). */
const MAX_URL = 2000;
const FILE = /\.(pdf|docx?|xlsx?|pptx?|zip)$/i;

const MAX_QUERY_PART = 120;
const clean = (s: string) =>
  s.replace(/"/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_PART).trim();

/** Up to four searches. Without a company there is nothing to search for. */
export function buildQueries(name: string, company: string): string[] {
  const c = clean(company);
  const n = clean(name);
  if (!c) return [];
  return [
    `"${c}" funding OR raised OR investment`,
    `"${c}" hiring OR careers`,
    `"${c}" news`,
    ...(n ? [`"${n}" "${c}"`] : []),
  ];
}

/** The pages worth opening, in query order then rank order. */
export function pickPages(results: SearchResult[], max = MAX_PAGES): string[] {
  const seen = new Set<string>();
  const perHost = new Map<string, number>();
  const out: string[] = [];
  for (const r of results) {
    let u: URL;
    try {
      u = new URL(r.url);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (isLinkedInHost(u.hostname) || FILE.test(u.pathname)) continue;
    u.hash = "";
    for (const k of [...u.searchParams.keys()])
      if (k.toLowerCase().startsWith("utm_")) u.searchParams.delete(k);
    const href = u.toString();
    if (href.length > MAX_URL) continue;
    const host = u.hostname.replace(/^www\./, "");
    const count = perHost.get(host) ?? 0;
    if (seen.has(href) || count >= PER_HOST) continue;
    seen.add(href);
    perHost.set(host, count + 1);
    out.push(href);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The visible text of an HTML page. &lt; and &gt; are left encoded on purpose: decoding them
 * would let a page write a literal </page> and step outside its wrapper in the prompt.
 */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*$/i, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^<>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export const RESEARCH_MESSAGES = {
  noKey: "Add a free Tavily key (or a Brave Search key) in Outreach settings to research the web.",
  nothing: "Web research found nothing about this company.",
  aiFormat: "Web research skipped: the AI's answer didn't match the expected format.",
} as const;
const failureReason = (kind: SearchErrorKind, service: string) =>
  ({
    bad_key: `the ${service} key was rejected`,
    rate_limited: `${service} is busy, try again in a minute`,
    quota: `${service} quota reached`,
    refused: `${service} refused the search`,
    unreachable: `couldn't reach ${service}`,
  })[kind];
/** The one-line skip message for failed searches, naming each service that was tried. */
export const searchSkipMessage = (failures: [SearchErrorKind, string][]) =>
  `Web research skipped: ${failures.map(([kind, service]) => failureReason(kind, service)).join("; ")}.`;

export type ResearchResult = {
  status: "done" | "skipped";
  message: string | null;
  signals: Signal[];
  note: string;
  sources: string[];
};
export type ResearchInput = { name: string; company: string; website: string | null };
export type ResearchDeps = {
  search: SearchProvider;
  /** Tried when every search on `search` fails (a rejected key, a used-up plan). */
  fallback?: SearchProvider;
  fetchPage: FetchPage;
  llm: Llm;
  sellerProfile: string;
  /** Pause between searches; tests pass a no-op. */
  wait?: (ms: number) => Promise<void>;
};
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export const skipped = (message: string): ResearchResult => ({
  status: "skipped",
  message,
  signals: [],
  note: "",
  sources: [],
});

/** Run fn over items with at most `limit` in flight, keeping input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

type Searched = { results: SearchResult[] } | { error: unknown };

async function searchAll(
  queries: string[],
  provider: SearchProvider,
  wait: (ms: number) => Promise<void>
): Promise<Searched[]> {
  const searchOnce = async (q: string, retry: boolean): Promise<Searched> => {
    try {
      return { results: await provider.search(q, { count: 8 }) };
    } catch (error) {
      if (!retry || !(error instanceof SearchError) || error.kind !== "rate_limited")
        return { error };
      await wait(SEARCH_GAP_MS);
      return searchOnce(q, false);
    }
  };
  const searched: Searched[] = [];
  for (const [i, q] of queries.entries()) {
    if (i > 0 && provider.gapMs > 0) await wait(provider.gapMs);
    searched.push(await searchOnce(q, true));
  }
  return searched;
}

export async function researchProspect(
  input: ResearchInput,
  deps: ResearchDeps
): Promise<ResearchResult> {
  const queries = buildQueries(input.name, input.company);
  if (queries.length === 0) return skipped(RESEARCH_MESSAGES.nothing);

  // 1. Search, one at a time, paced to the service (Brave allows one a second on its lowest
  // plan). A rate-limited query is retried once after a pause. One failing query doesn't
  // stop the others. If every query fails, the fallback service gets the same queries.
  const wait = deps.wait ?? sleep;
  const failures: [SearchErrorKind, string][] = [];
  let searched: Searched[] = [];
  for (const provider of [deps.search, deps.fallback]) {
    if (!provider) continue;
    searched = await searchAll(queries, provider, wait);
    if (!searched.every((s) => "error" in s)) break;
    const first = (searched[0] as { error: unknown }).error;
    if (!(first instanceof SearchError)) throw first;
    failures.push([first.kind, provider.service]);
  }
  if (searched.every((s) => "error" in s)) return skipped(searchSkipMessage(failures));
  const found = searched.flatMap((s) => ("results" in s ? s.results : []));

  // 2. Open the best pages through the safe fetcher.
  const opened = await mapLimit(pickPages(found), 3, async (url): Promise<ResearchPage | null> => {
    try {
      const page = await deps.fetchPage(url);
      if (page.status < 200 || page.status >= 300) return null;
      const text = pageText(page.body.slice(0, MAX_HTML_CHARS)).slice(0, MAX_PAGE_CHARS);
      return text.length >= MIN_PAGE_CHARS ? { url, text } : null;
    } catch {
      return null;
    }
  });
  const pages = opened.filter((p): p is ResearchPage => p !== null);
  if (pages.length === 0) return skipped(RESEARCH_MESSAGES.nothing);

  // 3. One read by the user's AI.
  let answer;
  try {
    answer = await deps.llm.generateJson(
      WebResearchSchema,
      researchPrompt(input, pages, deps.sellerProfile)
    );
  } catch (e) {
    if (e instanceof OutreachAiError)
      return skipped(
        e.message === FORMAT_ERROR
          ? RESEARCH_MESSAGES.aiFormat
          : `Web research skipped: ${e.message}`
      );
    throw e;
  }

  // 4. Check: only pages we sent, one signal per name.
  const signals: Signal[] = [];
  for (const s of answer.signals) {
    const page = pages[s.pageId - 1];
    const evidence = s.evidence.trim().slice(0, 500);
    if (!page || !evidence || signals.some((o) => o.name === s.name)) continue;
    signals.push({ name: s.name, evidence, source: page.url });
  }
  const note = answer.note.trim().slice(0, MAX_NOTE);
  if (signals.length === 0 && !note) return skipped(RESEARCH_MESSAGES.nothing);
  return { status: "done", message: null, signals, note, sources: pages.map((p) => p.url) };
}
