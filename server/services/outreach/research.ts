// Web research for a prospect: Brave finds links, Trivio opens the best pages itself through the
// SSRF-safe fetcher, and the user's AI reads them. Nothing here saves anything.
import type { SearchResult } from "./search";
import { isLinkedInHost } from "./website";

export const MAX_PAGES = 6;
export const MAX_PAGE_CHARS = 3000;
export const MIN_PAGE_CHARS = 200;
export const MAX_NOTE = 600;
const PER_HOST = 2;
const FILE = /\.(pdf|docx?|xlsx?|pptx?|zip)$/i;

const clean = (s: string) => s.replace(/"/g, "").replace(/\s+/g, " ").trim();

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
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^<>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}
